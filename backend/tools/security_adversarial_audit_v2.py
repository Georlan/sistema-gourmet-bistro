from __future__ import annotations

import asyncio
import json
import os
import statistics
import time
from pathlib import Path

import bcrypt
import httpx
import jwt
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings
from app.database import engine as runtime_engine
from app.main import app
from app.models import CaixaTurno, Comanda, Mesa, Restaurante, Usuario
from app.security import create_access_token
from app.smartpos_models import RestauranteCapability, SmartPosPaymentIntent, SmartPosPaymentIntentEvent

TENANTS = (5101, 5102, 5103, 5104, 5105)
OPEN_PER_TENANT = 20
REQUESTS_PER_TENANT = 60
ADMIN_URL = os.environ["AUDIT_ADMIN_DATABASE_URL"]
REPORT_PATH = Path(os.getenv("KOMA_SECURITY_AUDIT_REPORT", "security-audit-report.json"))
PASSWORD = "AuditPassword!123"
PASSWORD_HASH = bcrypt.hashpw(PASSWORD.encode(), bcrypt.gensalt(rounds=4)).decode()
SHARED_EMAIL = "shared-security-audit@koma.test"
SHARED_A = bcrypt.hashpw(b"Shared-A-123", bcrypt.gensalt(rounds=4)).decode()
SHARED_B = bcrypt.hashpw(b"Shared-B-456", bcrypt.gensalt(rounds=4)).decode()

findings: list[dict] = []
metrics: dict = {}


def add(code: str, severity: str, title: str, evidence: str, *, once: bool = True) -> None:
    if once and any(row["code"] == code for row in findings):
        return
    row = {"code": code, "severity": severity, "title": title, "evidence": evidence}
    findings.append(row)
    print(f"[{severity}] {code}: {title} :: {evidence}")


def admin_engine():
    return create_engine(ADMIN_URL, pool_pre_ping=True)


def seed() -> dict[int, int]:
    eng = admin_engine()
    Db = sessionmaker(bind=eng, class_=Session, expire_on_commit=False)
    db = Db()
    turnos: dict[int, int] = {}
    try:
        for rid in TENANTS:
            db.add(Restaurante(id=rid, nome=f"Audit Restaurant {rid}", plano="pocket"))
            db.add(Usuario(
                id=f"audit-user-{rid}", restaurante_id=rid, nome=f"Audit Operator {rid}",
                email=f"operator-{rid}@koma.test", usuario=f"operator-{rid}", senha_hash=PASSWORD_HASH,
                role="garcom", cargo="garcom", status="ativo",
            ))
        db.flush()
        db.add(Usuario(id="audit-shared-a", restaurante_id=5101, nome="Shared A", email=SHARED_EMAIL,
                       senha_hash=SHARED_A, role="garcom", cargo="garcom", status="ativo"))
        db.add(Usuario(id="audit-shared-b", restaurante_id=5102, nome="Shared B", email=SHARED_EMAIL,
                       senha_hash=SHARED_B, role="garcom", cargo="garcom", status="ativo"))
        db.flush()
        for rid in TENANTS:
            db.add(RestauranteCapability(restaurante_id=rid, capability="smartpos", enabled=True, source="beta"))
            for mesa in range(1, OPEN_PER_TENANT + 1):
                db.add(Mesa(id=mesa, restaurante_id=rid, capacidade=4, nome=f"Mesa {mesa}"))
            db.flush()
            turno = CaixaTurno(restaurante_id=rid, aberto_por_id=f"audit-user-{rid}", saldo_inicial=0, status="aberto")
            db.add(turno)
            db.flush()
            turnos[rid] = turno.id
            for mesa in range(1, OPEN_PER_TENANT + 1):
                db.add(Comanda(id=f"audit-t{rid}-cmd-{mesa:02d}", restaurante_id=rid, mesa_id=mesa,
                               garcom_id=f"audit-user-{rid}", tipo="Consumo no Local",
                               numero_pedido=rid * 100 + mesa, valor_pago=0, fechada=False))
            intent = SmartPosPaymentIntent(
                id=f"audit-intent-{rid}", restaurante_id=rid, turno_id=turno.id, mesa_id=1,
                operador_id=f"audit-user-{rid}", valor=10, metodo="credito", captura="provider_integrado",
                escopo="valor", idempotency_key=f"audit-idempotency-{rid}", status="pendente", origem="smartpos",
            )
            db.add(intent)
            db.flush()
            db.add(SmartPosPaymentIntentEvent(
                id=f"audit-event-{rid}", restaurante_id=rid, intent_id=intent.id,
                from_status="criada", to_status="pendente", actor_id=f"audit-user-{rid}",
                transition_key=f"audit-transition-{rid}", motivo="security audit seed",
            ))
        db.commit()
    finally:
        db.close()
        eng.dispose()
    return turnos


def schema_audit() -> list[str]:
    eng = admin_engine()
    tenant_tables: list[str] = []
    try:
        with eng.connect() as conn:
            rows = conn.execute(text("""
                SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
                FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname='public' AND c.relkind='r'
                  AND EXISTS (
                    SELECT 1 FROM information_schema.columns col
                    WHERE col.table_schema='public' AND col.table_name=c.relname
                      AND col.column_name='restaurante_id'
                  )
                ORDER BY c.relname
            """)).all()
            tenant_tables = [r[0] for r in rows]
            for table, rls, force in rows:
                if not rls:
                    add("RLS_DISABLED_" + table.upper(), "CRITICAL", "Tenant table has RLS disabled", table)
                elif not force:
                    add("RLS_NOT_FORCED_" + table.upper(), "MEDIUM", "Tenant table does not FORCE ROW LEVEL SECURITY", table)

            grants = conn.execute(text("""
                SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type)
                FROM information_schema.role_table_grants
                WHERE table_schema='public' AND grantee IN ('PUBLIC','anon','authenticated')
                GROUP BY table_name, grantee ORDER BY table_name, grantee
            """)).all()
            for table, grantee, privs in grants:
                if table in tenant_tables and "TRUNCATE" in privs:
                    add("PUBLIC_TRUNCATE_" + table.upper(), "CRITICAL",
                        "A browser/public role inherits TRUNCATE on a tenant table; RLS does not filter TRUNCATE",
                        f"{grantee} => {table}: {privs}")
                elif table in tenant_tables and grantee == "PUBLIC" and any(p in privs for p in ("INSERT", "UPDATE", "DELETE")):
                    add("PUBLIC_DML_" + table.upper(), "HIGH",
                        "Tenant table has broad PUBLIC DML grants", f"{table}: {privs}")

            bad_policies = conn.execute(text("""
                SELECT c.relname, p.polname, pg_get_expr(p.polqual,p.polrelid)
                FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname='public' AND pg_get_expr(p.polqual,p.polrelid) LIKE '%current_setting%'
            """)).all()
            for table, policy, expr in bad_policies:
                if "NULLIF" not in (expr or ""):
                    add("RLS_GUC_EMPTY_ERROR_" + table.upper(), "MEDIUM",
                        "RLS policy casts current_setting directly and can error instead of failing closed when tenant is absent",
                        f"{table}.{policy}: {expr}")
    finally:
        eng.dispose()
    return tenant_tables


def runtime_db_audit(tenant_tables: list[str], turnos: dict[int, int]) -> None:
    with runtime_engine.connect() as conn:
        role = conn.execute(text("SELECT current_user")).scalar_one()
        flags = conn.execute(text("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).one()
        metrics["runtime_role"] = {"name": role, "superuser": bool(flags[0]), "bypassrls": bool(flags[1])}
        if flags[0] or flags[1]:
            add("RUNTIME_ROLE_BYPASSES_RLS", "CRITICAL", "Runtime DB identity can bypass RLS", str(metrics["runtime_role"]))
        conn.rollback()

        readable = []
        for table in tenant_tables:
            try:
                if conn.execute(text("SELECT has_table_privilege(current_user,:t,'SELECT')"), {"t": f"public.{table}"}).scalar_one():
                    readable.append(table)
            finally:
                conn.rollback()

        for rid in TENANTS:
            for table in readable:
                tx = conn.begin()
                try:
                    conn.execute(text("SELECT set_config('app.current_restaurante_id',:rid,true)"), {"rid": str(rid)})
                    try:
                        seen = [int(v) for v in conn.execute(text(f"SELECT DISTINCT restaurante_id FROM public.{table} ORDER BY 1")).scalars().all()]
                    except DBAPIError as exc:
                        add("RLS_QUERY_ERROR_" + table.upper(), "HIGH", "Tenant-scoped SELECT raises a database error", f"tenant={rid}; {type(exc.orig).__name__}: {exc.orig}")
                        continue
                    foreign = [v for v in seen if v != rid]
                    if foreign:
                        add("CROSS_TENANT_READ_" + table.upper(), "CRITICAL", "Runtime tenant can read another tenant at DB level", f"tenant={rid}, seen={seen}")
                finally:
                    tx.rollback()

        for table in readable:
            tx = conn.begin()
            try:
                conn.execute(text("SELECT set_config('app.current_restaurante_id','',true)"))
                try:
                    count = conn.execute(text(f"SELECT count(*) FROM public.{table}")).scalar_one()
                    if count:
                        add("NO_TENANT_FAIL_OPEN_" + table.upper(), "CRITICAL", "Query without tenant returned rows", f"{table}: {count}")
                except DBAPIError as exc:
                    add("NO_TENANT_DB_ERROR_" + table.upper(), "MEDIUM", "Missing tenant causes SQL error rather than a clean fail-closed result", f"{type(exc.orig).__name__}: {exc.orig}")
            finally:
                tx.rollback()

        tx = conn.begin()
        try:
            conn.execute(text("SELECT set_config('app.current_restaurante_id','5101',true)"))
            before = conn.execute(text("SELECT count(*) FROM usuarios")).scalar_one()
            conn.execute(text("SELECT set_config('app.current_restaurante_id','5102',true)"))
            after = conn.execute(text("SELECT count(*) FROM usuarios")).scalar_one()
            if before and after:
                add("RUNTIME_CAN_SWITCH_TENANT_GUC", "MEDIUM",
                    "Runtime SQL role can change the tenant GUC inside its own transaction",
                    "arbitrary SQL execution could switch app.current_restaurante_id from 5101 to 5102")
        finally:
            tx.rollback()

        tx = conn.begin()
        try:
            conn.execute(text("SELECT set_config('app.current_restaurante_id','5101',true)"))
            sp = conn.begin_nested()
            accepted = False
            try:
                conn.execute(text("INSERT INTO activity_logs(restaurante_id,garcom_id,action,details) VALUES(5101,'audit-user-5102','AUDIT','cross tenant parent')"))
                accepted = True
            except DBAPIError:
                pass
            finally:
                sp.rollback()
            if accepted:
                add("CROSS_TENANT_FK_ACTIVITY_LOG", "HIGH", "FK permits a tenant-5101 row to reference a tenant-5102 user", "activity_logs.garcom_id is not tenant-composite")

            sp = conn.begin_nested()
            accepted = False
            try:
                conn.execute(text("""
                    INSERT INTO smartpos_payment_intents
                    (id,restaurante_id,turno_id,mesa_id,operador_id,valor,metodo,captura,escopo,idempotency_key,status,status_em,origem,criado_em)
                    VALUES ('audit-cross-intent',5101,:turno,1,'audit-user-5102',1,'credito','provider_integrado','valor','audit-cross-key','pendente',now(),'smartpos',now())
                """), {"turno": turnos[5101]})
                accepted = True
            except DBAPIError:
                pass
            finally:
                sp.rollback()
            if accepted:
                add("CROSS_TENANT_FK_SMARTPOS_OPERATOR", "HIGH", "SmartPOS intent can reference an operator from another tenant", "operador_id FK is not tenant-composite")
        finally:
            tx.rollback()


async def http_audit() -> None:
    tokens = {rid: create_access_token(subject=f"audit-user-{rid}", restaurante_id=rid, role="garcom") for rid in TENANTS}
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://audit.koma", timeout=30) as client:
        async def hit(rid: int, i: int) -> float:
            path = ("/auth/smartpos/contexto", "/mesas/", "/comandas/detalhes/todos?fechada=false")[i % 3]
            start = time.perf_counter()
            try:
                response = await client.get(path, headers={"Authorization": f"Bearer {tokens[rid]}"})
            except Exception as exc:
                add("BUSY_DAY_EXCEPTION", "HIGH", "Concurrent request failed with exception", f"tenant={rid} {path}: {type(exc).__name__}: {exc}")
                return (time.perf_counter() - start) * 1000
            ms = (time.perf_counter() - start) * 1000
            if response.status_code != 200:
                add("BUSY_DAY_HTTP_FAILURE", "HIGH", "Concurrent traffic returned non-200", f"tenant={rid} {path}: HTTP {response.status_code}")
                return ms
            data = response.json()
            if path.endswith("contexto") and data["restaurante"]["id"] != rid:
                add("HTTP_TENANT_LEAK", "CRITICAL", "Context endpoint returned another restaurant", f"wanted={rid}, got={data['restaurante']['id']}")
            if path == "/mesas/" and len(data) != OPEN_PER_TENANT:
                add("HTTP_TENANT_LEAK", "CRITICAL", "Mesa count crossed tenant boundary", f"tenant={rid}, count={len(data)}")
            if path.startswith("/comandas") and (len(data) != OPEN_PER_TENANT or any(not str(row["id"]).startswith(f"audit-t{rid}-") for row in data)):
                add("HTTP_TENANT_LEAK", "CRITICAL", "Comanda response crossed tenant boundary", f"tenant={rid}, count={len(data)}")
            return ms

        durations = await asyncio.gather(*[hit(rid, i) for rid in TENANTS for i in range(REQUESTS_PER_TENANT)])
        ordered = sorted(durations)
        metrics["busy_day"] = {
            "restaurants": 5, "open_comandas": 100, "requests": len(ordered),
            "p50_ms": round(statistics.median(ordered), 2),
            "p95_ms": round(ordered[max(0, int(len(ordered)*0.95)-1)], 2),
            "max_ms": round(max(ordered), 2),
        }

        mismatch = create_access_token(subject="audit-user-5101", restaurante_id=5102, role="garcom")
        if (await client.get("/auth/smartpos/contexto", headers={"Authorization": f"Bearer {mismatch}"})).status_code != 401:
            add("JWT_TENANT_MISMATCH_ACCEPTED", "CRITICAL", "JWT with user/tenant mismatch was accepted", "subject tenant 5101, claim tenant 5102")

        forged_role = create_access_token(subject="audit-user-5101", restaurante_id=5101, role="admin")
        privileged = await client.get("/auth/usuarios", headers={"Authorization": f"Bearer {forged_role}"})
        if privileged.status_code != 403:
            add("JWT_ROLE_CLAIM_ESCALATION", "CRITICAL", "Forged JWT role claim granted admin access", f"HTTP {privileged.status_code}")

        sql_injection = await client.post("/auth/login", json={"username": "' OR 1=1 --", "password": "x"})
        if sql_injection.status_code != 401:
            add("LOGIN_SQL_INJECTION", "CRITICAL", "SQL-injection-shaped identifier changed authentication result", f"HTTP {sql_injection.status_code}")

        a = await client.post("/auth/login", json={"username": SHARED_EMAIL, "password": "Shared-A-123"})
        b = await client.post("/auth/login", json={"username": SHARED_EMAIL, "password": "Shared-B-456"})
        if not (a.status_code == 200 and a.json()["usuario"]["restaurante_id"] == 5101 and b.status_code == 200 and b.json()["usuario"]["restaurante_id"] == 5102):
            add("DUPLICATE_EMAIL_TENANT_LOGIN_CONFUSION", "CRITICAL", "Same email with different tenant passwords resolved incorrectly", f"A={a.status_code}, B={b.status_code}")

        bad_statuses = []
        for _ in range(25):
            r = await client.post("/auth/login", json={"username": "operator-5101@koma.test", "password": "wrong-password"})
            bad_statuses.append(r.status_code)
        if 429 not in bad_statuses:
            add("STAFF_LOGIN_NO_RATE_LIMIT", "HIGH", "Staff login has no effective brute-force throttle", f"25 bad passwords; statuses={sorted(set(bad_statuses))}")

        old_token = tokens[5101]
        eng = admin_engine()
        try:
            with eng.begin() as conn:
                new_hash = bcrypt.hashpw(b"RotatedPassword-999", bcrypt.gensalt(rounds=4)).decode()
                conn.execute(text("UPDATE usuarios SET senha_hash=:h WHERE id='audit-user-5101'"), {"h": new_hash})
        finally:
            eng.dispose()
        old = await client.get("/auth/smartpos/contexto", headers={"Authorization": f"Bearer {old_token}"})
        if old.status_code == 200:
            add("PASSWORD_CHANGE_DOES_NOT_REVOKE_JWT", "MEDIUM", "Changing a password does not revoke existing bearer tokens", f"old token remained valid; configured TTL={settings.ACCESS_TOKEN_EXPIRE_MINUTES} minutes")


def write_report() -> None:
    severity_order = {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1, "INFO": 0}
    findings.sort(key=lambda x: (-severity_order.get(x["severity"], -1), x["code"]))
    counts = {s: sum(1 for f in findings if f["severity"] == s) for s in severity_order}
    report = {"status": "completed", "tenants": list(TENANTS), "metrics": metrics, "counts": counts, "findings": findings}
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


def main() -> None:
    try:
        if runtime_engine.dialect.name != "postgresql":
            raise RuntimeError("audit requires PostgreSQL")
        turnos = seed()
        tenant_tables = schema_audit()
        runtime_db_audit(tenant_tables, turnos)
        asyncio.run(http_audit())
    except Exception as exc:
        add("AUDIT_HARNESS_EXCEPTION", "HIGH", "Audit harness hit an unexpected exception but produced a partial report", f"{type(exc).__name__}: {exc}")
    finally:
        write_report()

    if any(f["severity"] in {"CRITICAL", "HIGH"} for f in findings):
        raise SystemExit(1)


if __name__ == "__main__":
    main()

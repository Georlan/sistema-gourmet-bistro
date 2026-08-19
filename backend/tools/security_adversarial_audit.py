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
from app.smartpos_models import (
    RestauranteCapability,
    SmartPosPaymentIntent,
    SmartPosPaymentIntentEvent,
)

TENANT_IDS = (5101, 5102, 5103, 5104, 5105)
OPEN_COMMANDAS_PER_TENANT = 20
BUSY_REQUESTS_PER_TENANT = 60
REPORT_PATH = Path(os.getenv("KOMA_SECURITY_AUDIT_REPORT", "security-audit-report.json"))
ADMIN_URL = os.environ["AUDIT_ADMIN_DATABASE_URL"]
PASSWORD = "AuditPassword!123"
PASSWORD_HASH = bcrypt.hashpw(PASSWORD.encode(), bcrypt.gensalt(rounds=4)).decode()
SHARED_EMAIL = "shared-security-audit@koma.test"
SHARED_HASH_A = bcrypt.hashpw(b"Shared-A-123", bcrypt.gensalt(rounds=4)).decode()
SHARED_HASH_B = bcrypt.hashpw(b"Shared-B-456", bcrypt.gensalt(rounds=4)).decode()
findings: list[dict] = []
metrics: dict = {}


def finding(code: str, severity: str, title: str, evidence: str, *, once: bool = False) -> None:
    if once and any(item["code"] == code for item in findings):
        return
    findings.append({"code": code, "severity": severity, "title": title, "evidence": evidence})
    print(f"[{severity}] {code}: {title} :: {evidence}")


def write_report(status: str) -> None:
    report = {"status": status, "tenants": list(TENANT_IDS), "metrics": metrics, "findings": findings}
    REPORT_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print("\n=== SECURITY AUDIT REPORT ===")
    print(json.dumps(report, indent=2, ensure_ascii=False))


def seed_five_tenants() -> dict[int, int]:
    admin_engine = create_engine(ADMIN_URL, pool_pre_ping=True)
    AdminSession = sessionmaker(bind=admin_engine, class_=Session, expire_on_commit=False)
    turno_ids: dict[int, int] = {}
    db = AdminSession()
    try:
        for rid in TENANT_IDS:
            db.add(Restaurante(id=rid, nome=f"Audit Restaurant {rid}", plano="pocket"))
            db.add(Usuario(id=f"audit-user-{rid}", restaurante_id=rid, nome=f"Audit Operator {rid}", email=f"operator-{rid}@koma.test", usuario=f"operator-{rid}", senha_hash=PASSWORD_HASH, role="garcom", cargo="garcom", status="ativo"))
        db.flush()
        db.add(Usuario(id="audit-shared-5101", restaurante_id=5101, nome="Shared Tenant 5101", email=SHARED_EMAIL, senha_hash=SHARED_HASH_A, role="garcom", cargo="garcom", status="ativo"))
        db.add(Usuario(id="audit-shared-5102", restaurante_id=5102, nome="Shared Tenant 5102", email=SHARED_EMAIL, senha_hash=SHARED_HASH_B, role="garcom", cargo="garcom", status="ativo"))
        db.flush()
        for rid in TENANT_IDS:
            db.add(RestauranteCapability(restaurante_id=rid, capability="smartpos", enabled=True, source="beta"))
            for mesa_id in range(1, OPEN_COMMANDAS_PER_TENANT + 1):
                db.add(Mesa(id=mesa_id, restaurante_id=rid, capacidade=4, nome=f"Mesa {mesa_id}"))
            db.flush()
            turno = CaixaTurno(restaurante_id=rid, aberto_por_id=f"audit-user-{rid}", saldo_inicial=0, status="aberto")
            db.add(turno)
            db.flush()
            turno_ids[rid] = turno.id
            for mesa_id in range(1, OPEN_COMMANDAS_PER_TENANT + 1):
                db.add(Comanda(id=f"audit-t{rid}-cmd-{mesa_id:02d}", restaurante_id=rid, mesa_id=mesa_id, garcom_id=f"audit-user-{rid}", tipo="Consumo no Local", numero_pedido=(rid * 100) + mesa_id, valor_pago=0, fechada=False))
            intent = SmartPosPaymentIntent(id=f"audit-intent-{rid}", restaurante_id=rid, turno_id=turno.id, mesa_id=1, operador_id=f"audit-user-{rid}", valor=10, metodo="credito", captura="provider_integrado", escopo="valor", idempotency_key=f"audit-idempotency-{rid}", status="pendente", origem="smartpos")
            db.add(intent)
            db.flush()
            db.add(SmartPosPaymentIntentEvent(id=f"audit-event-{rid}", restaurante_id=rid, intent_id=intent.id, from_status="criada", to_status="pendente", actor_id=f"audit-user-{rid}", transition_key=f"audit-transition-{rid}", motivo="security audit seed"))
        db.commit()
    finally:
        db.close()
        admin_engine.dispose()
    return turno_ids


def _tenant_array(conn, table: str) -> list[int]:
    return [int(value) for value in conn.execute(text(f"SELECT DISTINCT restaurante_id FROM public.{table} ORDER BY restaurante_id")).scalars().all()]


def audit_runtime_rls(turno_ids: dict[int, int]) -> None:
    protected = ("usuarios", "mesas", "comandas", "smartpos_payment_intents")
    with runtime_engine.connect() as conn:
        runtime_role = conn.execute(text("SELECT current_user")).scalar_one()
        metrics["runtime_role"] = runtime_role
        for table in ("comandas", "clientes"):
            can_truncate = conn.execute(text("SELECT has_table_privilege(current_user, :table, 'TRUNCATE')"), {"table": f"public.{table}"}).scalar_one()
            if can_truncate:
                finding("RUNTIME_GLOBAL_TRUNCATE_PRIVILEGE", "CRITICAL", "Runtime role can TRUNCATE a tenant table and TRUNCATE is not filtered by RLS", f"current_user={runtime_role} inherits TRUNCATE on public.{table}; no TRUNCATE was executed")

        conn.rollback()

        for rid in TENANT_IDS:
            tx = conn.begin()
            try:
                conn.execute(text("SELECT set_config('app.current_restaurante_id', :rid, true)"), {"rid": str(rid)})
                for table in protected:
                    seen = _tenant_array(conn, table)
                    assert seen == [rid], f"RLS leak on {table}: tenant={rid}, seen={seen}"
                restaurant_ids = conn.execute(text("SELECT id FROM restaurantes ORDER BY id")).scalars().all()
                assert [int(v) for v in restaurant_ids] == [rid]
                event_seen = _tenant_array(conn, "smartpos_payment_intent_events")
                if event_seen != [rid]:
                    finding("SMARTPOS_EVENT_RLS_MISSING", "CRITICAL", "SmartPOS payment event history crosses tenant boundaries at DB role level", f"tenant {rid} saw event restaurante_id values {event_seen}", once=True)
            finally:
                tx.rollback()

        tx = conn.begin()
        try:
            conn.execute(text("SELECT set_config('app.current_restaurante_id', '0', true)"))
            for table in protected:
                count = conn.execute(text(f"SELECT count(*) FROM public.{table}")).scalar_one()
                assert count == 0, f"fail-closed tenant=0 failed on {table}: {count}"
        finally:
            tx.rollback()

        tx = conn.begin()
        try:
            conn.execute(text("SELECT set_config('app.current_restaurante_id', '5101', true)"))
            changed = conn.execute(text("UPDATE usuarios SET nome = nome WHERE restaurante_id = 5102")).rowcount
            assert changed == 0, f"cross-tenant UPDATE changed {changed} rows"
        finally:
            tx.rollback()

        tx = conn.begin()
        try:
            conn.execute(text("SELECT set_config('app.current_restaurante_id', '5101', true)"))
            nested = conn.begin_nested()
            try:
                conn.execute(text("INSERT INTO usuarios (id,nome,email,senha_hash,role,restaurante_id,cargo,status) VALUES ('audit-illegal-user','Illegal','illegal@koma.test','x','garcom',5102,'garcom','ativo')"))
            except DBAPIError:
                nested.rollback()
            else:
                nested.rollback()
                raise AssertionError("RLS allowed insert with restaurante_id from another tenant")
        finally:
            tx.rollback()

        tx = conn.begin()
        try:
            conn.execute(text("SELECT set_config('app.current_restaurante_id', '5101', true)"))
            nested = conn.begin_nested()
            cross_activity = False
            try:
                conn.execute(text("INSERT INTO activity_logs (restaurante_id,garcom_id,action,details) VALUES (5101,'audit-user-5102','SECURITY_AUDIT','cross tenant FK probe')"))
                cross_activity = True
            except DBAPIError:
                pass
            finally:
                nested.rollback()
            if cross_activity:
                finding("CROSS_TENANT_FK_ACTIVITY_LOG", "HIGH", "Child row can reference a user from another tenant through a non-composite FK", "activity_logs(restaurante_id=5101, garcom_id=user from 5102) was accepted by PostgreSQL")

            nested = conn.begin_nested()
            cross_intent = False
            try:
                conn.execute(text("""INSERT INTO smartpos_payment_intents (id,restaurante_id,turno_id,mesa_id,operador_id,valor,metodo,captura,escopo,idempotency_key,status,status_em,origem,criado_em) VALUES ('audit-cross-intent',5101,:turno,1,'audit-user-5102',1.00,'credito','provider_integrado','valor','audit-cross-intent-key','pendente',now(),'smartpos',now())"""), {"turno": turno_ids[5101]})
                cross_intent = True
            except DBAPIError:
                pass
            finally:
                nested.rollback()
            if cross_intent:
                finding("CROSS_TENANT_FK_SMARTPOS_OPERATOR", "HIGH", "SmartPOS intent can reference an operator from another tenant through raw SQL", "intent tenant 5101 with operador_id from tenant 5102 passed FK validation")
        finally:
            tx.rollback()

        tx = conn.begin()
        try:
            conn.execute(text("SELECT set_config('app.current_restaurante_id', '5101', true)"))
            before = _tenant_array(conn, "usuarios")
            conn.execute(text("SELECT set_config('app.current_restaurante_id', '5102', true)"))
            after = _tenant_array(conn, "usuarios")
            if before == [5101] and after == [5102]:
                finding("RLS_GUC_MUTABLE_BY_RUNTIME", "MEDIUM", "Tenant GUC is mutable by the runtime SQL role", "a connection with arbitrary SQL execution can change app.current_restaurante_id from 5101 to 5102")
        finally:
            tx.rollback()

        tx = conn.begin()
        try:
            conn.execute(text("SELECT set_config('app.current_restaurante_id', '5101 OR 1=1', true)"))
            nested = conn.begin_nested()
            try:
                conn.execute(text("SELECT count(*) FROM usuarios")).scalar_one()
            except DBAPIError:
                nested.rollback()
            else:
                nested.rollback()
                raise AssertionError("malformed tenant GUC unexpectedly produced a valid query")
        finally:
            tx.rollback()


async def audit_http_and_busy_day() -> None:
    tokens = {rid: create_access_token(subject=f"audit-user-{rid}", restaurante_id=rid, role="garcom") for rid in TENANT_IDS}
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://koma-security.test", timeout=30.0) as client:
        async def check_one(rid: int, index: int) -> float:
            path = "/auth/smartpos/contexto" if index % 3 == 0 else "/mesas/" if index % 3 == 1 else "/comandas/detalhes/todos?fechada=false"
            started = time.perf_counter()
            response = await client.get(path, headers={"Authorization": f"Bearer {tokens[rid]}"})
            elapsed = (time.perf_counter() - started) * 1000
            if response.status_code != 200:
      finding(
          "BUSY_DAY_CAPACITY_FAILURE",
          "HIGH",
          "Concurrent restaurant traffic exhausted backend database capacity",
          f"tenant={rid} path={path} returned HTTP {response.status_code}: {response.text[:160]}",
          once=True,
      )
      return elapsed
            data = response.json()
            if path.endswith("contexto"):
                assert data["restaurante"]["id"] == rid
                assert data["operador"]["restaurante_id"] == rid
            elif path == "/mesas/":
                assert len(data) == OPEN_COMMANDAS_PER_TENANT
            else:
                assert len(data) == OPEN_COMMANDAS_PER_TENANT
                assert all(str(row["id"]).startswith(f"audit-t{rid}-") for row in data)
            return elapsed

        durations = await asyncio.gather(*[check_one(rid, index) for rid in TENANT_IDS for index in range(BUSY_REQUESTS_PER_TENANT)])
        ordered = sorted(durations)
        metrics["busy_day"] = {"restaurants": len(TENANT_IDS), "open_comandas": len(TENANT_IDS) * OPEN_COMMANDAS_PER_TENANT, "http_requests": len(durations), "latency_ms_p50": round(statistics.median(ordered), 2), "latency_ms_p95": round(ordered[int(len(ordered) * 0.95) - 1], 2), "latency_ms_max": round(max(ordered), 2)}

        mismatch = create_access_token(subject="audit-user-5101", restaurante_id=5102, role="garcom")
        assert (await client.get("/auth/smartpos/contexto", headers={"Authorization": f"Bearer {mismatch}"})).status_code == 401
        expired = jwt.encode({"sub": "audit-user-5101", "restaurante_id": 5101, "exp": 1}, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
        assert (await client.get("/auth/smartpos/contexto", headers={"Authorization": f"Bearer {expired}"})).status_code == 401
        assert (await client.get("/auth/smartpos/contexto", headers={"Authorization": "Basic not-a-bearer"})).status_code == 401
        assert (await client.post("/auth/login", json={"username": "' OR 1=1 --", "password": "anything"})).status_code == 401
        malformed = await client.post("/auth/login", json={"username": "operator-5101@koma.test", "password": PASSWORD, "restaurante_id": "5101 OR 1=1"})
        assert malformed.status_code == 422
        shared_a = await client.post("/auth/login", json={"username": SHARED_EMAIL, "password": "Shared-A-123"})
        shared_b = await client.post("/auth/login", json={"username": SHARED_EMAIL, "password": "Shared-B-456"})
        assert shared_a.status_code == 200 and shared_a.json()["usuario"]["restaurante_id"] == 5101
        assert shared_b.status_code == 200 and shared_b.json()["usuario"]["restaurante_id"] == 5102

        statuses = []
        for _ in range(20):
            attempt = await client.post("/auth/login", json={"username": "operator-5101@koma.test", "password": "definitely-wrong"})
            statuses.append(attempt.status_code)
        if 429 not in statuses:
            finding("STAFF_LOGIN_NO_RATE_LIMIT", "HIGH", "Staff login accepts repeated password attempts without throttling", f"20 consecutive bad attempts returned statuses {sorted(set(statuses))}; no HTTP 429")


def main() -> None:
    status = "completed"
    try:
        assert runtime_engine.dialect.name == "postgresql", runtime_engine.url
        turno_ids = seed_five_tenants()
        audit_runtime_rls(turno_ids)
        asyncio.run(audit_http_and_busy_day())
    except Exception as exc:
        status = "failed"
        finding("AUDIT_ABORTED", "ERROR", "The audit harness stopped on an unexpected invariant or runtime error", f"{type(exc).__name__}: {exc}")
        write_report(status)
        raise
    else:
        write_report(status)


if __name__ == "__main__":
    main()

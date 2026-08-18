#!/usr/bin/env python3
"""Stress isolado da fundação SmartPOS usando PostgreSQL real.

Este script NUNCA deve apontar para produção. O workflow dedicado sobe um
PostgreSQL efêmero, aplica todas as migrations e executa o runtime com uma role
sem SUPERUSER/BYPASSRLS e membro de ``koma_app``.
"""

from __future__ import annotations

import asyncio
from collections import Counter
from decimal import Decimal
import os
import sys
from pathlib import Path

import bcrypt
import httpx
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


EXPECTED_DB_NAME = os.getenv("KOMA_STRESS_DB_NAME", "koma_stress")
raw_url = os.getenv("DATABASE_URL", "")
if EXPECTED_DB_NAME not in raw_url or "localhost" not in raw_url:
    raise RuntimeError(
        "Stress PostgreSQL bloqueado: DATABASE_URL precisa apontar para o banco "
        f"efêmero local {EXPECTED_DB_NAME!r}."
    )

from app.config import settings  # noqa: E402
from app.database import (  # noqa: E402
    SessionLocal,
    TenantScopeError,
    current_restaurante_id,
    engine,
    validate_postgres_runtime_role,
)
from app.main import app  # noqa: E402
from app.models import CaixaTurno, Restaurante, Usuario  # noqa: E402
from app.security import create_access_token  # noqa: E402
from app.smartpos_models import RestauranteCapability  # noqa: E402


PASSWORD = "postgres-stress-smartpos"
PASSWORD_HASH = bcrypt.hashpw(
    PASSWORD.encode("utf-8"), bcrypt.gensalt(rounds=4)
).decode("utf-8")

TENANTS = (
    {
        "id": 9811,
        "name": "Postgres Stress A",
        "user_id": "pg-stress-a",
        "email": "pg-stress-a@koma.test",
        "role": "garcom",
        "capability": True,
        "turno": True,
    },
    {
        "id": 9822,
        "name": "Postgres Stress B",
        "user_id": "pg-stress-b",
        "email": "pg-stress-b@koma.test",
        "role": "garcom",
        "capability": False,
        "turno": True,
    },
    {
        "id": 9833,
        "name": "Postgres Stress C",
        "user_id": "pg-stress-c",
        "email": "pg-stress-c@koma.test",
        "role": "garcom",
        "capability": True,
        "turno": False,
    },
)
TURN_STRESS = {
    "id": 9844,
    "name": "Postgres Turn Stress",
    "user_id": "pg-stress-caixa",
    "email": "pg-stress-caixa@koma.test",
    "role": "caixa",
    "capability": True,
    "turno": False,
}


def tenant_session(restaurante_id: int):
    token = current_restaurante_id.set(restaurante_id)
    db = SessionLocal(restaurante_id=restaurante_id)
    return token, db


def seed_spec(spec: dict) -> None:
    ctx, db = tenant_session(spec["id"])
    try:
        db.query(CaixaTurno).filter(
            CaixaTurno.restaurante_id == spec["id"]
        ).delete()
        db.query(RestauranteCapability).filter(
            RestauranteCapability.restaurante_id == spec["id"]
        ).delete()
        db.query(Usuario).filter(Usuario.id == spec["user_id"]).delete()

        restaurante = db.query(Restaurante).filter(
            Restaurante.id == spec["id"]
        ).first()
        if restaurante is None:
            db.add(Restaurante(
                id=spec["id"],
                nome=spec["name"],
                plano="pocket",
            ))
            db.flush()
        else:
            restaurante.nome = spec["name"]
            restaurante.plano = "pocket"

        db.add(Usuario(
            id=spec["user_id"],
            restaurante_id=spec["id"],
            nome=f"Operador {spec['id']}",
            email=spec["email"],
            senha_hash=PASSWORD_HASH,
            cargo=spec["role"],
            status="ativo",
        ))
        db.add(RestauranteCapability(
            restaurante_id=spec["id"],
            capability="smartpos",
            enabled=spec["capability"],
            source="beta",
        ))
        if spec["turno"]:
            db.add(CaixaTurno(
                restaurante_id=spec["id"],
                aberto_por_id=spec["user_id"],
                saldo_inicial=Decimal("0.00"),
                status="aberto",
            ))
        db.commit()
    finally:
        db.close()
        current_restaurante_id.reset(ctx)


def token_for(spec: dict) -> str:
    return create_access_token(
        subject=spec["user_id"],
        restaurante_id=spec["id"],
        role=spec["role"],
    )


def assert_runtime_role_and_rls() -> None:
    validate_postgres_runtime_role()
    if engine.dialect.name != "postgresql":
        raise AssertionError("O stress dedicado precisa executar em PostgreSQL.")

    with engine.begin() as conn:
        role = conn.execute(text("""
            SELECT current_user,
                   rol.rolsuper,
                   rol.rolbypassrls,
                   pg_has_role(current_user, 'koma_app', 'member')
            FROM pg_roles rol
            WHERE rol.rolname = current_user
        """)).one()
        assert role[1] is False
        assert role[2] is False
        assert role[3] is True

        forced = conn.execute(text("""
            SELECT relname, relrowsecurity, relforcerowsecurity
            FROM pg_class
            WHERE relname IN (
                'restaurantes', 'usuarios', 'caixa_turnos',
                'restaurante_capabilities', 'smartpos_payment_intents'
            )
            ORDER BY relname
        """)).all()
        assert forced
        assert all(row[1] and row[2] for row in forced), forced


def assert_raw_rls_isolation() -> None:
    for spec in TENANTS:
        with engine.begin() as conn:
            conn.execute(
                text("SELECT set_config('app.current_restaurante_id', :rid, true)"),
                {"rid": str(spec["id"])},
            )
            restaurant_ids = [
                row[0]
                for row in conn.execute(
                    text("SELECT id FROM restaurantes ORDER BY id")
                ).all()
            ]
            user_tenants = {
                row[0]
                for row in conn.execute(
                    text("SELECT restaurante_id FROM usuarios")
                ).all()
            }
            capability_tenants = {
                row[0]
                for row in conn.execute(
                    text("SELECT restaurante_id FROM restaurante_capabilities")
                ).all()
            }

            assert restaurant_ids == [spec["id"]], restaurant_ids
            assert user_tenants == {spec["id"]}
            assert capability_tenants == {spec["id"]}

    # O banco, não só o ORM, precisa recusar uma escrita cross-tenant.
    with engine.begin() as conn:
        conn.execute(
            text("SELECT set_config('app.current_restaurante_id', :rid, true)"),
            {"rid": str(TENANTS[0]["id"])},
        )
        try:
            conn.execute(text("""
                INSERT INTO restaurante_capabilities
                    (restaurante_id, capability, enabled, source, created_at, updated_at)
                VALUES
                    (:other_tenant, 'stress-cross-tenant', true, 'beta', now(), now())
            """), {"other_tenant": TENANTS[1]["id"]})
        except DBAPIError:
            pass
        else:
            raise AssertionError("RLS aceitou escrita cross-tenant via SQL bruto.")


def assert_orm_write_guard() -> None:
    ctx, db = tenant_session(TENANTS[0]["id"])
    try:
        db.add(RestauranteCapability(
            restaurante_id=TENANTS[1]["id"],
            capability="stress-orm-cross-tenant",
            enabled=True,
            source="beta",
        ))
        try:
            db.flush()
        except TenantScopeError:
            db.rollback()
        else:
            raise AssertionError("Guard ORM aceitou escrita para outro tenant.")
    finally:
        db.close()
        current_restaurante_id.reset(ctx)


async def stress_context_requests() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://koma-stress.local",
        timeout=20.0,
    ) as client:
        async def request(spec: dict):
            response = await client.get(
                "/auth/smartpos/contexto",
                headers={"Authorization": f"Bearer {token_for(spec)}"},
            )
            return spec, response

        results = await asyncio.gather(*[
            request(TENANTS[index % len(TENANTS)])
            for index in range(96)
        ])

    for spec, response in results:
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["restaurante"]["id"] == spec["id"]
        assert data["restaurante"]["nome"] == spec["name"]
        assert data["operador"]["id"] == spec["user_id"]
        assert data["operador"]["restaurante_id"] == spec["id"]
        assert data["smartpos_enabled"] is spec["capability"]
        assert data["turno_aberto"] is spec["turno"]
        assert data["mesas_disponiveis"] is (
            spec["capability"] and spec["turno"]
        )


async def stress_login_requests() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://koma-stress.local",
        timeout=20.0,
    ) as client:
        async def request(spec: dict):
            response = await client.post(
                "/auth/login",
                json={"username": spec["email"], "password": PASSWORD},
            )
            return spec, response

        results = await asyncio.gather(*[
            request(TENANTS[index % len(TENANTS)])
            for index in range(45)
        ])

    for spec, response in results:
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["usuario"]["id"] == spec["user_id"]
        assert data["usuario"]["restaurante_id"] == spec["id"]


async def stress_single_open_turn_constraint() -> None:
    spec = TURN_STRESS
    token = token_for(spec)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://koma-stress.local",
        timeout=20.0,
    ) as client:
        async def open_turn(index: int):
            return await client.post(
                "/caixa/turno/abrir",
                headers={"Authorization": f"Bearer {token}"},
                json={"saldo_inicial": f"{index % 5}.00"},
            )

        responses = await asyncio.gather(*[open_turn(i) for i in range(24)])

    codes = Counter(response.status_code for response in responses)
    assert codes[201] == 1, codes
    assert set(codes).issubset({201, 400, 409}), codes

    ctx, db = tenant_session(spec["id"])
    try:
        open_turns = db.query(CaixaTurno).filter(
            CaixaTurno.restaurante_id == spec["id"],
            CaixaTurno.status == "aberto",
        ).all()
        assert len(open_turns) == 1
    finally:
        db.close()
        current_restaurante_id.reset(ctx)


def assert_pool_is_released() -> None:
    checked_out = getattr(engine.pool, "checkedout", None)
    if callable(checked_out):
        assert checked_out() == 0, engine.pool.status()


def main() -> None:
    print("[STRESS] Validando role runtime e FORCE RLS...")
    assert_runtime_role_and_rls()

    print("[STRESS] Preparando tenants isolados...")
    for spec in (*TENANTS, TURN_STRESS):
        seed_spec(spec)

    print("[STRESS] SQL bruto contra RLS...")
    assert_raw_rls_isolation()
    assert_orm_write_guard()

    print("[STRESS] 96 contextos SmartPOS concorrentes...")
    asyncio.run(stress_context_requests())

    print("[STRESS] 45 logins concorrentes pré-tenant...")
    asyncio.run(stress_login_requests())

    print("[STRESS] 24 tentativas simultâneas de abrir o mesmo turno...")
    asyncio.run(stress_single_open_turn_constraint())

    assert_pool_is_released()
    print("[STRESS] PASS — RLS, tenant, pool, login e turno permaneceram consistentes.")


if __name__ == "__main__":
    main()

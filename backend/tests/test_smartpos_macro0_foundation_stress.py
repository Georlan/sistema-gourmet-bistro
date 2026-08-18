import asyncio
from datetime import timedelta
from unittest.mock import AsyncMock

import bcrypt
import httpx
import jwt
import pytest
from fastapi import HTTPException

from app.config import settings
from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.main import app
from app.models import CaixaTurno, Restaurante, Usuario
from app.routes.websocket import _validated_internal_websocket_identity
from app.security import create_access_token
from app.smartpos_models import RestauranteCapability
from app.websocket_manager import ConnectionManager


PASSWORD = "stress-smartpos"
PASSWORD_HASH = bcrypt.hashpw(
    PASSWORD.encode("utf-8"), bcrypt.gensalt(rounds=4)
).decode("utf-8")

TENANTS = (
    {
        "id": 9711,
        "name": "Stress Tenant A",
        "user_id": "stress-smartpos-a",
        "email": "stress-a@koma.test",
        "capability": True,
        "turno": True,
    },
    {
        "id": 9722,
        "name": "Stress Tenant B",
        "user_id": "stress-smartpos-b",
        "email": "stress-b@koma.test",
        "capability": False,
        "turno": True,
    },
    {
        "id": 9733,
        "name": "Stress Tenant C",
        "user_id": "stress-smartpos-c",
        "email": "stress-c@koma.test",
        "capability": True,
        "turno": False,
    },
)


@pytest.fixture(autouse=True)
def setup_smartpos_macro0_stress():
    Base.metadata.create_all(bind=engine)

    for spec in TENANTS:
        tenant_token = current_restaurante_id.set(spec["id"])
        db = SessionLocal()
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
                cargo="garcom",
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
                    saldo_inicial=0,
                    status="aberto",
                ))
            db.commit()
        finally:
            db.close()
            current_restaurante_id.reset(tenant_token)

    yield


def _token_for(spec: dict) -> str:
    return create_access_token(
        subject=spec["user_id"],
        restaurante_id=spec["id"],
        role="garcom",
    )


def test_72_context_requests_concurrent_do_not_leak_tenant_or_capability():
    async def exercise():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://koma.test",
            timeout=20.0,
        ) as client:
            async def one_request(spec: dict):
                response = await client.get(
                    "/auth/smartpos/contexto",
                    headers={"Authorization": f"Bearer {_token_for(spec)}"},
                )
                return spec, response

            requests = [
                one_request(TENANTS[index % len(TENANTS)])
                for index in range(72)
            ]
            return await asyncio.gather(*requests)

    results = asyncio.run(exercise())
    assert len(results) == 72

    for spec, response in results:
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["restaurante"] == {
            "id": spec["id"],
            "nome": spec["name"],
        }
        assert data["operador"]["id"] == spec["user_id"]
        assert data["operador"]["restaurante_id"] == spec["id"]
        assert data["smartpos_enabled"] is spec["capability"]
        assert data["turno_aberto"] is spec["turno"]
        assert data["mesas_disponiveis"] is (
            spec["capability"] and spec["turno"]
        )
        assert data["pedidos_disponiveis"] is (
            spec["capability"] and spec["turno"]
        )


def test_36_logins_concurrent_return_the_correct_tenant_every_time():
    async def exercise():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://koma.test",
            timeout=20.0,
        ) as client:
            async def login(spec: dict):
                response = await client.post(
                    "/auth/login",
                    json={
                        "username": spec["email"],
                        "password": PASSWORD,
                    },
                )
                return spec, response

            return await asyncio.gather(*[
                login(TENANTS[index % len(TENANTS)])
                for index in range(36)
            ])

    for spec, response in asyncio.run(exercise()):
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["usuario"]["id"] == spec["user_id"]
        assert body["usuario"]["restaurante_id"] == spec["id"]

        payload = jwt.decode(
            body["access_token"],
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
        )
        assert payload["sub"] == spec["user_id"]
        assert payload["restaurante_id"] == spec["id"]


def test_mixed_invalid_tokens_fail_closed_under_concurrency():
    valid_a = _token_for(TENANTS[0])
    mismatched_tenant = create_access_token(
        subject=TENANTS[0]["user_id"],
        restaurante_id=TENANTS[1]["id"],
        role="garcom",
    )
    expired = create_access_token(
        subject=TENANTS[0]["user_id"],
        restaurante_id=TENANTS[0]["id"],
        role="garcom",
        expires_delta=timedelta(seconds=-1),
    )
    bool_tenant = jwt.encode(
        {
            "sub": TENANTS[0]["user_id"],
            "restaurante_id": True,
        },
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )
    garbage = "not-a-jwt"

    cases = (
        (valid_a, 200),
        (mismatched_tenant, 401),
        (expired, 401),
        (bool_tenant, 401),
        (garbage, 401),
    )

    async def exercise():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://koma.test",
            timeout=20.0,
        ) as client:
            async def request(token: str, expected: int):
                response = await client.get(
                    "/auth/smartpos/contexto",
                    headers={"Authorization": f"Bearer {token}"},
                )
                return expected, response.status_code

            return await asyncio.gather(*[
                request(*cases[index % len(cases)])
                for index in range(50)
            ])

    results = asyncio.run(exercise())
    assert results == [
        (cases[index % len(cases)][1], cases[index % len(cases)][1])
        for index in range(50)
    ]


def test_internal_websocket_identity_cannot_be_impersonated_and_rechecks_account():
    spec = TENANTS[0]
    token = _token_for(spec)

    restaurante_id, user_id, user_name = _validated_internal_websocket_identity(
        token,
        spec["user_id"],
    )
    assert restaurante_id == spec["id"]
    assert user_id == spec["user_id"]
    assert user_name == f"Operador {spec['id']}"

    with pytest.raises(ValueError):
        _validated_internal_websocket_identity(token, "outro-operador")

    tenant_token = current_restaurante_id.set(spec["id"])
    db = SessionLocal()
    try:
        user = db.query(Usuario).filter(Usuario.id == spec["user_id"]).one()
        user.status = "inativo"
        db.commit()
    finally:
        db.close()
        current_restaurante_id.reset(tenant_token)

    with pytest.raises(HTTPException) as exc:
        _validated_internal_websocket_identity(token, spec["user_id"])
    assert exc.value.status_code == 403


def test_websocket_fanout_48_peers_stays_tenant_and_audience_scoped():
    async def exercise():
        manager = ConnectionManager()
        tenant_a_internal = [AsyncMock() for _ in range(24)]
        tenant_a_clients = [AsyncMock() for _ in range(8)]
        tenant_b_internal = [AsyncMock() for _ in range(16)]

        for socket in tenant_a_internal:
            await manager.connect(socket, TENANTS[0]["id"], client_type="internal")
        for socket in tenant_a_clients:
            await manager.connect(socket, TENANTS[0]["id"], client_type="client")
        for socket in tenant_b_internal:
            await manager.connect(socket, TENANTS[1]["id"], client_type="internal")

        operational_event = {"event": "cash_updated", "detail": {"type": "stress"}}
        await manager.broadcast(
            operational_event,
            TENANTS[0]["id"],
            target_audience="internal",
        )

        for socket in tenant_a_internal:
            socket.send_json.assert_called_once_with(operational_event)
        for socket in tenant_a_clients + tenant_b_internal:
            socket.send_json.assert_not_called()

        public_event = {"event": "config_updated", "data": {"id": TENANTS[0]["id"]}}
        await manager.broadcast(public_event, TENANTS[0]["id"])

        for socket in tenant_a_internal:
            assert socket.send_json.call_count == 2
            socket.send_json.assert_called_with(public_event)
        for socket in tenant_a_clients:
            socket.send_json.assert_called_once_with(public_event)
        for socket in tenant_b_internal:
            socket.send_json.assert_not_called()

        assert len(manager.active_connections[TENANTS[0]["id"]]["internal"]) == 24
        assert len(manager.active_connections[TENANTS[0]["id"]]["client"]) == 8
        assert len(manager.active_connections[TENANTS[1]["id"]]["internal"]) == 16

    asyncio.run(exercise())

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from unittest.mock import AsyncMock
from app.database import (
    TenantSession,
    _set_postgres_tenant_for_transaction,
    bind_session_to_tenant,
    current_restaurante_id,
    get_tenant_id_str,
)
from app.security import create_access_token
from app.websocket_manager import ConnectionManager
from app.main import app


# Modelos deliberadamente globais da plataforma. Qualquer nova tabela sem
# restaurante_id precisa ser adicionada aqui de forma explícita para não escapar
# silenciosamente das garantias multi-tenant.
GLOBAL_MODEL_TABLES = {"restaurantes", "fiscal_official_reference_states"}

# Tabelas tenant-owned manipuladas exclusivamente pelo control plane recebem
# restaurante_id explicitamente dentro de tenant_session_scope, em vez de depender
# de default ORM implícito. Continuam nullable=False e protegidas pelo mesmo RLS.
CONTROL_PLANE_TENANT_TABLES = {"restaurant_trials", "support_sessions"}

# Eventos recebidos da Meta podem chegar antes de o provedor permitir
# correlacioná-los a uma mensagem/tenant. A tabela continua sob RLS e linhas
# sem tenant não são visíveis ao runtime, mas a coluna é intencionalmente nula.
UNRESOLVED_PLATFORM_EVENT_TABLES = {"notificacoes_whatsapp"}


def test_all_tenant_models_declare_a_required_context_default():
    """Impede que uma tabela protegida por RLS volte a ser omitida pelo ORM."""
    from app import models  # noqa: F401
    from app.database import Base

    all_tables = dict(Base.metadata.tables)
    mapped_tables = {
        table.name: table
        for table in all_tables.values()
        if "restaurante_id" in table.c
    }

    assert set(all_tables) - set(mapped_tables) == GLOBAL_MODEL_TABLES
    for table_name, table in mapped_tables.items():
        tenant_column = table.c.restaurante_id
        if table_name in UNRESOLVED_PLATFORM_EVENT_TABLES:
            assert tenant_column.nullable is True, table_name
            continue
        assert tenant_column.nullable is False, table_name
        if table_name in CONTROL_PLANE_TENANT_TABLES:
            continue
        assert tenant_column.default is not None, table_name

def test_current_restaurante_id_default_is_none_outside_request():
    """Prova que current_restaurante_id.get() retorna None por padrão fora de uma requisição."""
    current_restaurante_id.set(None)
    assert current_restaurante_id.get() is None

def test_get_tenant_id_str_sentinel_zero():
    """Prova que tenant ausente, 0, negativo ou inválido gera o sentinela '0', nunca '' e nunca '1'."""
    assert get_tenant_id_str(None) == "0"
    assert get_tenant_id_str(0) == "0"
    assert get_tenant_id_str(-1) == "0"
    assert get_tenant_id_str("1") == "0"  # type: ignore
    assert get_tenant_id_str(True) == "0"  # type: ignore
    assert get_tenant_id_str(5) == "5"


def test_tenant_session_can_be_rebound_only_between_transactions():
    engine = create_engine("sqlite:///:memory:")
    db = TenantSession(bind=engine, restaurante_id=1)
    try:
        db.execute(text("SELECT 1"))
        assert db.in_transaction()

        bind_session_to_tenant(db, 2)

        assert not db.in_transaction()
        assert db.restaurante_id == 2
    finally:
        db.close()


def test_explicit_session_tenant_wins_when_request_context_is_empty():
    engine = create_engine("sqlite:///:memory:")
    db = TenantSession(bind=engine, restaurante_id=11)
    token = current_restaurante_id.set(None)
    try:
        from app.database import _effective_tenant_id

        assert _effective_tenant_id(db) == 11
    finally:
        current_restaurante_id.reset(token)
        db.close()


def test_explicit_session_tenant_rejects_conflicting_request_context():
    from app.database import TenantScopeError, _effective_tenant_id

    engine = create_engine("sqlite:///:memory:")
    db = TenantSession(bind=engine, restaurante_id=11)
    token = current_restaurante_id.set(22)
    try:
        with pytest.raises(TenantScopeError):
            _effective_tenant_id(db)
    finally:
        current_restaurante_id.reset(token)
        db.close()


def test_postgres_hook_sets_sentinel_zero_outside_tenant(monkeypatch):
    class _Connection:
        class _Dialect:
            name = "postgresql"

        dialect = _Dialect()

        def __init__(self):
            self.executions = []

        def execute(self, statement, params):
            self.executions.append((str(statement), params))

    engine = create_engine("sqlite:///:memory:")
    db = TenantSession(bind=engine)
    connection = _Connection()
    token = current_restaurante_id.set(None)
    try:
        _set_postgres_tenant_for_transaction(db, None, connection)
        assert connection.executions[-1][1] == {"id": "0"}
    finally:
        current_restaurante_id.reset(token)
        db.close()


@pytest.mark.asyncio
async def test_websocket_manager_revokes_user_sessions():
    manager = ConnectionManager()
    websocket = AsyncMock()
    websocket.close = AsyncMock()
    await manager.connect(websocket, "tenant:7:user:42")
    assert "tenant:7:user:42" in manager.active_connections

    await manager.revoke_user(7, 42)

    assert "tenant:7:user:42" not in manager.active_connections
    websocket.close.assert_awaited_once()


def test_revoked_access_token_is_rejected(client_and_session):
    client, db = client_and_session
    from app import models

    user = models.Usuario(
        restaurante_id=1,
        nome="Revogado",
        email="revogado@example.com",
        senha_hash="x",
        role="GARCOM",
        ativo=True,
        session_version=3,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    stale_token = create_access_token(
        data={
            "sub": user.email,
            "uid": str(user.id),
            "restaurante_id": 1,
            "role": user.role,
            "session_version": 2,
        }
    )

    response = client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {stale_token}"},
    )
    assert response.status_code == 401


def test_current_access_token_is_accepted(client_and_session):
    client, db = client_and_session
    from app import models

    user = models.Usuario(
        restaurante_id=1,
        nome="Atual",
        email="atual@example.com",
        senha_hash="x",
        role="GARCOM",
        ativo=True,
        session_version=3,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(
        data={
            "sub": user.email,
            "uid": str(user.id),
            "restaurante_id": 1,
            "role": user.role,
            "session_version": 3,
        }
    )

    response = client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200

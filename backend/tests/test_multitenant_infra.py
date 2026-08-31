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


GLOBAL_MODEL_TABLES = {"restaurantes"}

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
        engine.dispose()


@pytest.mark.parametrize("restaurante_id", [11, 22])
def test_postgres_transaction_receives_explicit_tenant(restaurante_id):
    class FakeDialect:
        name = "postgresql"

    class FakeConnection:
        dialect = FakeDialect()

        def __init__(self):
            self.calls = []

        def execute(self, statement, parameters):
            self.calls.append((str(statement), parameters))

    class FakeSession:
        pass

    session = FakeSession()
    session.restaurante_id = restaurante_id

    connection = FakeConnection()
    _set_postgres_tenant_for_transaction(session, None, connection)

    assert len(connection.calls) == 1
    sql, parameters = connection.calls[0]
    assert "set_config('app.current_restaurante_id'" in sql
    assert parameters == {"id": str(restaurante_id)}


def test_canonical_print_enqueue_keeps_explicit_tenant_for_each_job(monkeypatch):
    from app.services import printing as printing_service

    created_jobs = []

    class FakeQuery:
        def filter(self, *_args):
            return self

        def first(self):
            return None

    class FakeNested:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    class FakeDb:
        def query(self, _model):
            return FakeQuery()

        def add(self, job):
            created_jobs.append(job)

        def flush(self):
            return None

        def begin_nested(self):
            return FakeNested()

    monkeypatch.setattr(
        printing_service,
        "_printing_allowed",
        lambda _db, _restaurante_id: True,
    )

    db = FakeDb()
    original_context = current_restaurante_id.set(999)
    try:
        job_11 = printing_service.enqueue_print_job(
            db,
            restaurante_id=11,
            document_type="producao",
            destination="COZINHA",
            source_type="pedido",
            source_id="c-tenant-11",
            payload_text="tenant 11",
            idempotency_key="tenant:test:11",
        )
        job_22 = printing_service.enqueue_print_job(
            db,
            restaurante_id=22,
            document_type="producao",
            destination="COZINHA",
            source_type="pedido",
            source_id="c-tenant-22",
            payload_text="tenant 22",
            idempotency_key="tenant:test:22",
        )

        assert [job.restaurante_id for job in created_jobs] == [11, 22]
        assert job_11.restaurante_id == 11
        assert job_22.restaurante_id == 22
        assert current_restaurante_id.get() == 999
    finally:
        current_restaurante_id.reset(original_context)


def test_postgres_transaction_without_tenant_uses_blocking_sentinel():
    class FakeDialect:
        name = "postgresql"

    class FakeConnection:
        dialect = FakeDialect()

        def __init__(self):
            self.parameters = None

        def execute(self, statement, parameters):
            self.parameters = parameters

    class FakeSession:
        restaurante_id = None

    context = current_restaurante_id.set(None)
    try:
        connection = FakeConnection()
        _set_postgres_tenant_for_transaction(FakeSession(), None, connection)
        assert connection.parameters == {"id": "0"}
    finally:
        current_restaurante_id.reset(context)

def test_create_access_token_requires_valid_restaurante_id():
    """Prova que create_access_token falha se restaurante_id for ausente, zero ou inválido."""
    with pytest.raises(ValueError, match="restaurante_id é obrigatório"):
        create_access_token(subject="user1", restaurante_id=None)  # type: ignore

    with pytest.raises(ValueError, match="restaurante_id deve ser um inteiro positivo"):
        create_access_token(subject="user1", restaurante_id=0)

    with pytest.raises(ValueError, match="restaurante_id deve ser um inteiro positivo"):
        create_access_token(subject="user1", restaurante_id=-5)

    with pytest.raises(ValueError, match="restaurante_id é obrigatório"):
        create_access_token(subject="user1", restaurante_id="1")  # type: ignore

    with pytest.raises(ValueError, match="restaurante_id é obrigatório"):
        create_access_token(subject="user1", restaurante_id=True)  # type: ignore

def test_create_access_token_rejects_reserved_claims_in_extra_claims():
    """Prova que extra_claims não pode conter sub, exp, restaurante_id ou role."""
    with pytest.raises(ValueError, match="extra_claims não pode conter chaves reservadas"):
        create_access_token(subject="u1", restaurante_id=1, extra_claims={"role": "superadmin"})

    with pytest.raises(ValueError, match="extra_claims não pode conter chaves reservadas"):
        create_access_token(subject="u1", restaurante_id=1, extra_claims={"restaurante_id": 999})

    with pytest.raises(ValueError, match="extra_claims não pode conter chaves reservadas"):
        create_access_token(subject="u1", restaurante_id=1, extra_claims={"sub": "outro"})

    with pytest.raises(ValueError, match="extra_claims não pode conter chaves reservadas"):
        create_access_token(subject="u1", restaurante_id=1, extra_claims={"exp": 1234567890})

def test_create_access_token_superadmin_zero_exception():
    """Prova que restaurante_id=0 é permitido exclusivamente quando role == 'superadmin'."""
    import jwt
    from app.config import settings

    # Sucesso para superadmin com id 0
    token = create_access_token(subject="superadmin_user", restaurante_id=0, role="superadmin")
    payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    assert payload["sub"] == "superadmin_user"
    assert payload["restaurante_id"] == 0
    assert payload["role"] == "superadmin"

    # Falha de restaurante_id=0 para qualquer outro role
    with pytest.raises(ValueError, match="restaurante_id deve ser um inteiro positivo"):
        create_access_token(subject="u1", restaurante_id=0, role="garcom")

    with pytest.raises(ValueError, match="restaurante_id deve ser um inteiro positivo"):
        create_access_token(subject="u1", restaurante_id=0)

def test_create_access_token_includes_restaurante_id():
    """Prova que create_access_token inclui corretamente o restaurante_id informado no JWT."""
    import jwt
    from app.config import settings

    token = create_access_token(subject="user123", restaurante_id=42, role="garcom")
    payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])

    assert payload["sub"] == "user123"
    assert payload["restaurante_id"] == 42
    assert payload["role"] == "garcom"

@pytest.mark.anyio
async def test_connection_manager_closes_1008_on_invalid_tenant():
    """Prova que ConnectionManager encerra conexão com código 1008 se receber restaurante_id inválido."""
    cm = ConnectionManager()
    ws_mock = AsyncMock()

    await cm.connect(ws_mock, restaurante_id=0)
    ws_mock.close.assert_called_once_with(code=1008)
    assert 0 not in cm.active_connections

    ws_mock.reset_mock()
    await cm.connect(ws_mock, restaurante_id=-1)
    ws_mock.close.assert_called_once_with(code=1008)
    assert -1 not in cm.active_connections

    ws_mock.reset_mock()
    await cm.connect(ws_mock, restaurante_id=None)  # type: ignore
    ws_mock.close.assert_called_once_with(code=1008)
    assert None not in cm.active_connections

@pytest.mark.anyio
async def test_broadcast_without_tenant_does_not_send_to_restaurante_1():
    """Prova que broadcast sem tenant não envia a mensagem ao restaurante 1."""
    cm = ConnectionManager()
    ws_rest1 = AsyncMock()

    await cm.connect(ws_rest1, restaurante_id=1)
    assert 1 in cm.active_connections

    # broadcast com restaurante_id=None e ContextVar=None
    current_restaurante_id.set(None)
    await cm.broadcast({"event": "ping"}, restaurante_id=None)

    # Nenhuma mensagem enviada ao restaurante 1
    ws_rest1.send_json.assert_not_called()

@pytest.mark.anyio
async def test_broadcast_isolation_between_tenants():
    """Prova que broadcast do restaurante 2 nunca envia para conexões do restaurante 1."""
    cm = ConnectionManager()
    ws_rest1 = AsyncMock()
    ws_rest2 = AsyncMock()

    await cm.connect(ws_rest1, restaurante_id=1)
    await cm.connect(ws_rest2, restaurante_id=2)

    msg = {"event": "novo_pedido", "mesa": 5}
    await cm.broadcast(msg, restaurante_id=2)

    ws_rest2.send_json.assert_called_once_with(msg)
    ws_rest1.send_json.assert_not_called()

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


TENANT_SCOPED_MODEL_TABLES = {
    "activity_logs",
    "caixa_movimentacoes",
    "caixa_turnos",
    "categorias",
    "clientes",
    "comandas",
    "config_fidelizacao",
    "configuracoes_ia",
    "configuracoes_restaurante",
    "distribuidores",
    "entradas_estoque",
    "grupo_modificadores",
    "historico_fidelidade",
    "insumos",
    "item_modificadores",
    "itens",
    "itens_contagem_estoque",
    "itens_entrada_estoque",
    "itens_nota_entrada",
    "lancamentos",
    "mensagens_whatsapp",
    "mesas",
    "motoboys",
    "movimentacoes_estoque",
    "notas_entrada",
    "observacoes_predefinidas",
    "opcao_modificadores",
    "otp_challenges",
    "pagamentos",
    "print_agent_tokens",
    "print_jobs",
    "produto_grupo_modificadores",
    "produtos",
    "public_rate_limits",
    "rascunhos_pedidos",
    "sessoes_contagem_estoque",
    "usuarios",
}


def test_all_tenant_models_declare_a_required_context_default():
    """Impede que uma tabela protegida por RLS volte a ser omitida pelo ORM."""
    from app import models  # noqa: F401
    from app.database import Base

    mapped_tables = {
        table.name: table
        for table in Base.metadata.tables.values()
        if "restaurante_id" in table.c
    }

    assert set(mapped_tables) == TENANT_SCOPED_MODEL_TABLES
    for table_name, table in mapped_tables.items():
        tenant_column = table.c.restaurante_id
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


def test_print_background_uses_explicit_tenant_for_each_job(monkeypatch):
    from app import database
    from app.routes.orders import print_in_background

    created_sessions = []
    created_jobs = []

    class FakeDb:
        def __init__(self, restaurante_id):
            created_sessions.append(restaurante_id)

        def add(self, job):
            created_jobs.append(job)

        def commit(self):
            return None

        def close(self):
            return None

    monkeypatch.setattr(
        database,
        "SessionLocal",
        lambda *, restaurante_id: FakeDb(restaurante_id),
    )

    original_context = current_restaurante_id.set(999)
    try:
        print_in_background("cozinha", "tenant 11", restaurante_id=11)
        print_in_background("cozinha", "tenant 22", restaurante_id=22)

        assert created_sessions == [11, 22]
        assert [job.restaurante_id for job in created_jobs] == [11, 22]
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

def test_unauthenticated_request_leaves_context_var_none():
    """Prova que uma requisição sem tenant não define o ContextVar com valor implícito de 0."""
    async def tenant_debug():
        return {"tenant": current_restaurante_id.get()}

    existing_routes = []
    for route in app.routes:
        if hasattr(route, "path"):
            existing_routes.append(route.path)

    if "/tenant-debug" not in existing_routes:
        app.add_api_route("/tenant-debug", tenant_debug, methods=["GET"], include_in_schema=False)

    client = TestClient(app)
    response = client.get("/tenant-debug")

    assert response.status_code == 200
    assert response.json()["tenant"] is None


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

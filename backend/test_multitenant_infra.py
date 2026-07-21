import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock
from app.database import current_restaurante_id, get_tenant_id_str
from app.security import create_access_token
from app.websocket_manager import ConnectionManager
from app.main import app

def test_current_restaurante_id_default_is_none_outside_request():
    """Prova que current_restaurante_id.get() retorna None por padrão fora de uma requisição."""
    assert current_restaurante_id.get() is None

def test_get_tenant_id_str_sentinel_zero():
    """Prova que tenant ausente, 0, negativo ou inválido gera o sentinela '0', nunca '' e nunca '1'."""
    assert get_tenant_id_str(None) == "0"
    assert get_tenant_id_str(0) == "0"
    assert get_tenant_id_str(-1) == "0"
    assert get_tenant_id_str("1") == "0"  # type: ignore
    assert get_tenant_id_str(True) == "0"  # type: ignore
    assert get_tenant_id_str(5) == "5"

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

import pytest
from unittest.mock import AsyncMock
from app.database import current_restaurante_id
from app.security import create_access_token
from app.websocket_manager import ConnectionManager

def test_current_restaurante_id_default_is_none_outside_request():
    """Prova que current_restaurante_id.get() retorna None fora de uma requisição."""
    token_var = current_restaurante_id.set(None)
    try:
        assert current_restaurante_id.get() is None
    finally:
        current_restaurante_id.reset(token_var)


def test_create_access_token_requires_valid_restaurante_id():
    """Prova que create_access_token falha se restaurante_id for ausente, zero ou inválido."""
    # Test None
    with pytest.raises(ValueError, match="restaurante_id é obrigatório"):
        create_access_token(subject="user1", restaurante_id=None)  # type: ignore

    # Test 0 para usuário comum
    with pytest.raises(ValueError, match="restaurante_id deve ser um inteiro positivo"):
        create_access_token(subject="user1", restaurante_id=0)

    # Test negativo
    with pytest.raises(ValueError, match="restaurante_id deve ser um inteiro positivo"):
        create_access_token(subject="user1", restaurante_id=-5)

    # Test tipo inválido (string ou bool)
    with pytest.raises(ValueError, match="restaurante_id é obrigatório"):
        create_access_token(subject="user1", restaurante_id="1")  # type: ignore

    with pytest.raises(ValueError, match="restaurante_id é obrigatório"):
        create_access_token(subject="user1", restaurante_id=True)  # type: ignore

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
async def test_connection_manager_rejects_invalid_restaurante_id():
    """Prova que ConnectionManager não aceita conexão sem restaurante_id positivo."""
    cm = ConnectionManager()
    ws_mock = AsyncMock()

    # Tenta conectar com 0, None, negativo
    await cm.connect(ws_mock, restaurante_id=0)
    assert 0 not in cm.active_connections
    ws_mock.accept.assert_not_called()

    await cm.connect(ws_mock, restaurante_id=-1)
    assert -1 not in cm.active_connections

    await cm.connect(ws_mock, restaurante_id=None)  # type: ignore
    assert None not in cm.active_connections

@pytest.mark.anyio
async def test_broadcast_without_tenant_does_not_send_to_restaurante_1():
    """Prova que broadcast sem tenant não envia a mensagem ao restaurante 1."""
    cm = ConnectionManager()
    ws_rest1 = AsyncMock()

    await cm.connect(ws_rest1, restaurante_id=1)
    assert 1 in cm.active_connections
    ws_rest1.accept.assert_called_once()

    # Força ContextVar como None
    token_var = current_restaurante_id.set(None)
    try:
        await cm.broadcast({"event": "ping"}, restaurante_id=None)
    finally:
        current_restaurante_id.reset(token_var)

    # Nenhuma mensagem deve ter sido enviada para a conexão do restaurante 1
    ws_rest1.send_json.assert_not_called()

@pytest.mark.anyio
async def test_broadcast_isolation_between_tenants():
    """Prova que broadcast do restaurante 2 nunca envia para conexões do restaurante 1."""
    cm = ConnectionManager()
    ws_rest1 = AsyncMock()
    ws_rest2 = AsyncMock()

    await cm.connect(ws_rest1, restaurante_id=1)
    await cm.connect(ws_rest2, restaurante_id=2)

    # Broadcast exclusivo para restaurante 2
    msg = {"event": "novo_pedido", "mesa": 5}
    await cm.broadcast(msg, restaurante_id=2)

    # Restaurante 2 recebe, Restaurante 1 NÃO recebe
    ws_rest2.send_json.assert_called_once_with(msg)
    ws_rest1.send_json.assert_not_called()

from unittest.mock import AsyncMock

from app.routes import caixa
from tests.characterization.orders.fixtures import CHAR_RESTAURANT_ID, char_client, char_setup


def test_cashier_permission_update_is_persisted_and_broadcast_for_its_tenant(char_client, char_setup, monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(caixa.manager, 'broadcast', broadcast)
    changes = {
        'perm_garcom_editar': False,
        'perm_garcom_cancelar': False,
        'perm_garcom_transferir_mesa': False,
        'perm_garcom_transferir_item': False,
        'perm_garcom_status': False,
    }
    response = char_client.put('/caixa/configuracoes', headers=char_setup['headers'], json=changes)
    assert response.status_code == 200, response.text
    stored = char_client.get('/caixa/configuracoes', headers=char_setup['headers'])
    assert stored.status_code == 200, stored.text
    for key, expected in changes.items():
        assert response.json()[key] is expected
        assert stored.json()[key] is expected
    broadcast.assert_any_await({'event': 'config_updated'}, CHAR_RESTAURANT_ID)
    broadcast.assert_any_await({'event': 'tables_updated'}, CHAR_RESTAURANT_ID)

"""Both existing SmartPOS order routes must continue delegating to Order Core."""
from unittest.mock import patch

from app.application.orders.service import OrderApplicationService
from app.domain.orders.types import OrderChannel
from tests.characterization.orders.fixtures import char_client, char_setup


def test_smartpos_quick_sale_and_table_launch_share_the_order_core(char_client, char_setup):
    headers = char_setup["headers"]
    # Device entitlement is a fixture here; dedicated SmartPOS suites test denial.
    with patch("app.adapters.orders.pos_adapter.has_capability", return_value=True):
        with patch.object(OrderApplicationService, "create_order", wraps=OrderApplicationService.create_order) as core:
            response = char_client.post("/comandas/venda-direta", headers=headers, json={
                "tipo": "Balcão", "origem": "smartpos", "idempotency_key": "smartpos-core-sale",
                "itens": [{"produto_id": "prod-char-simples", "cliente_nome": "Balcão"}],
            })
            assert response.status_code == 201, response.text
            core.assert_called_once()
            assert core.call_args.args[1].channel == OrderChannel.POS
            assert response.json()["lancamentos"][0]["origem"] == "smartpos"

    opened = char_client.post("/comandas/", headers=headers, json={
        "mesa_id": 1, "tipo": "Consumo no Local", "garcom_id": "usr-char-admin",
    })
    assert opened.status_code == 201, opened.text
    command_id = opened.json()["id"]
    with patch.object(OrderApplicationService, "create_order", wraps=OrderApplicationService.create_order) as core:
        response = char_client.post(f"/comandas/{command_id}/lancamentos", headers=headers, json={
            "garcom_id": "usr-char-admin", "origem": "smartpos",
            "idempotency_key": "smartpos-core-table",
            "itens": [{"produto_id": "prod-char-refri", "cliente_nome": "Consumo Geral"}],
        })
        assert response.status_code == 201, response.text
        core.assert_called_once()
        command = core.call_args.args[1]
        assert command.channel == OrderChannel.WAITER
        assert command.check_id == command_id
        assert command.table_id == "1"

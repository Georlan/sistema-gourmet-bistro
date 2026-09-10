from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.adapters.orders.pos_adapter import PosAdapter


def test_pos_adapter_maps_modifier_ids_to_order_items():
    item = SimpleNamespace(
        produto_id="produto-1",
        observacao="sem cebola",
        modificador_ids=["opmod-bacon", "opmod-pao"],
    )
    venda = SimpleNamespace(
        tipo="Retirada",
        origem="smartpos",
        mesa_id=None,
        identificador="Balcão",
        delivery_telefone=None,
        delivery_endereco=None,
        delivery_taxa=0,
        idempotency_key="test-pos-modifiers-1",
        garcom_id="user-1",
        cliente_id=None,
        itens=[item],
    )

    db = MagicMock()
    current_user = SimpleNamespace(id="user-1", nome="Caixa", tenant_id=91)
    query = db.query.return_value
    query.filter.return_value.first.side_effect = [None, current_user]

    with (
        patch("app.adapters.orders.pos_adapter.require_tenant_id", return_value=91),
        patch("app.adapters.orders.pos_adapter.ensure_permission"),
        patch("app.adapters.orders.pos_adapter.has_capability", return_value=True),
        patch("app.adapters.orders.pos_adapter.require_open_cash_shift"),
        patch("app.adapters.orders.pos_adapter.OrderApplicationService.create_order") as create_order,
    ):
        create_order.side_effect = RuntimeError("stop after command capture")
        try:
            PosAdapter.handle_create_pos_order(venda, MagicMock(), db, current_user)
        except Exception:
            pass

    command = create_order.call_args.args[1]
    assert len(command.items) == 1
    assert command.items[0].product_id == "produto-1"
    assert command.items[0].quantity == Decimal("1")
    assert command.items[0].modifier_ids == ("opmod-bacon", "opmod-pao")

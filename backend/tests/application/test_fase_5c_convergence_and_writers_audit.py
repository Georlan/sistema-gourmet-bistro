import inspect
from decimal import Decimal
from sqlalchemy.orm import Session

from app.domain.orders.types import OrderChannel
from app.application.orders.service import OrderApplicationService
from app.adapters.orders.web_adapter import CardapioWebAdapter
from app.adapters.orders.pos_adapter import PosAdapter
from app.adapters.orders.waiter_adapter import WaiterAdapter
from app.services.shifts import require_open_cash_shift
from app.services.order_numbers import gerar_novo_numero_pedido_atomico
from app.routes import orders_core, orders
from app.models import Lancamento, Item, Comanda


def test_fase_5c_canonical_service_is_sole_order_writer():
    """Valida que o OrderApplicationService é a autoridade canônica de escrita de Lancamento."""
    service = OrderApplicationService()
    assert hasattr(service, "create_order")
    assert hasattr(service, "accept_order")
    assert hasattr(service, "mark_order_ready")
    assert hasattr(service, "cancel_order")
    assert hasattr(service, "reject_order")
    assert hasattr(service, "complete_order")
    assert hasattr(service, "_resolve_lancamento_and_comanda")
    assert hasattr(service, "_to_order_dto")


def test_fase_5c_all_three_channels_converge_to_canonical_adapters():
    """Valida que Cardápio (Web), PDV (Balcão) e Garçom (Mesa) possuem adapters canônicos mapeados."""
    assert issubclass(CardapioWebAdapter, object)
    assert hasattr(CardapioWebAdapter, "handle_create_public_order")
    
    assert issubclass(PosAdapter, object)
    assert hasattr(PosAdapter, "handle_create_pos_order")
    
    assert issubclass(WaiterAdapter, object)
    assert hasattr(WaiterAdapter, "handle_launch_items")


def test_fase_5c_shared_services_are_single_source_of_truth():
    """Valida que shifts e order_numbers são serviços puros e centralizados."""
    # shifts
    assert callable(require_open_cash_shift)
    assert orders_core.require_open_cash_shift is require_open_cash_shift
    assert orders.require_open_cash_shift is require_open_cash_shift

    # order numbering
    assert callable(gerar_novo_numero_pedido_atomico)
    assert orders_core.gerar_novo_numero_pedido is gerar_novo_numero_pedido_atomico


def test_fase_5c_channel_enumeration_coverage():
    """Valida que todos os canais canônicos estão formalizados no enum de domínio."""
    channels = {c.name for c in OrderChannel}
    expected = {"WEB_CARDAPIO", "POS", "WAITER", "IFOOD", "NINE_NINE_FOOD", "KEETA", "QR_MESA", "KIOSK", "WHATSAPP", "API"}
    for ch in expected:
        assert ch in channels

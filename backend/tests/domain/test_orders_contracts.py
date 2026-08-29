"""Testes unitários puros de contratos e invariantes do domínio de Pedidos."""

from decimal import Decimal
import pytest

from app.domain.orders.types import (
    OrderChannel,
    FulfillmentType,
    OrderStatus,
    DeliveryStatus,
    normalize_to_fulfillment,
    to_legacy_fulfillment,
    normalize_to_order_status,
    to_legacy_order_status,
    normalize_to_delivery_status,
    to_legacy_delivery_status,
)
from app.domain.orders.errors import (
    EmptyOrderItemsError,
    InvalidExternalReferenceError,
    InvalidFulfillmentDetailsError,
    InvalidItemQuantityError,
    InvalidOrderTransitionError,
)
from app.domain.orders.state_machine import OrderStateMachine
from app.domain.orders.quote import OrderQuote, ItemQuote, ModifierQuote
from app.domain.orders.events import (
    OrderCreated,
    OrderAccepted,
    OrderReady,
    OrderDispatched,
    OrderCompleted,
    OrderRejected,
    OrderCancelled,
)
from app.application.orders.commands import (
    ExternalOrderReference,
    OrderItemInput,
    CustomerInput,
    DeliveryInput,
    CreateOrderCommand,
    AcceptOrderCommand,
    CancelOrderCommand,
)


class TestOrderTypesAndLegacyMapping:
    def test_channels_are_well_defined(self):
        assert OrderChannel.POS == "pos"
        assert OrderChannel.IFOOD == "ifood"
        assert OrderChannel.WEB_CARDAPIO == "web_cardapio"
        assert OrderChannel.WHATSAPP == "whatsapp"

    def test_fulfillment_legacy_bidirectional_mapping(self):
        assert normalize_to_fulfillment("delivery") == FulfillmentType.DELIVERY
        assert normalize_to_fulfillment("entrega") == FulfillmentType.DELIVERY
        assert normalize_to_fulfillment("retirada") == FulfillmentType.PICKUP
        assert normalize_to_fulfillment("balcao") == FulfillmentType.PICKUP
        assert normalize_to_fulfillment("mesa") == FulfillmentType.DINE_IN
        assert normalize_to_fulfillment("salao") == FulfillmentType.DINE_IN
        assert normalize_to_fulfillment(None) == FulfillmentType.DINE_IN

        assert to_legacy_fulfillment(FulfillmentType.DELIVERY) == "delivery"
        assert to_legacy_fulfillment(FulfillmentType.PICKUP) == "retirada"
        assert to_legacy_fulfillment(FulfillmentType.DINE_IN) == "mesa"

    def test_order_status_legacy_bidirectional_mapping(self):
        assert normalize_to_order_status("pendente") == OrderStatus.PENDING
        assert normalize_to_order_status("analise") == OrderStatus.PENDING
        assert normalize_to_order_status("producao") == OrderStatus.PREPARING
        assert normalize_to_order_status("em_preparo") == OrderStatus.PREPARING
        assert normalize_to_order_status("pronto") == OrderStatus.READY
        assert normalize_to_order_status("finalizado") == OrderStatus.COMPLETED
        assert normalize_to_order_status("recusado") == OrderStatus.REJECTED
        assert normalize_to_order_status("cancelado") == OrderStatus.CANCELLED

        assert to_legacy_order_status(OrderStatus.PENDING) == "pendente"
        assert to_legacy_order_status(OrderStatus.PREPARING) == "producao"
        assert to_legacy_order_status(OrderStatus.READY) == "pronto"
        assert to_legacy_order_status(OrderStatus.COMPLETED) == "finalizado"
        assert to_legacy_order_status(OrderStatus.REJECTED) == "recusado"

    def test_delivery_status_legacy_mapping(self):
        assert normalize_to_delivery_status("pendente") == DeliveryStatus.WAITING
        assert normalize_to_delivery_status("atribuido") == DeliveryStatus.ASSIGNED
        assert normalize_to_delivery_status("saiu_entrega") == DeliveryStatus.DISPATCHED
        assert normalize_to_delivery_status("entregue") == DeliveryStatus.DELIVERED

        assert to_legacy_delivery_status(DeliveryStatus.WAITING) == "pendente"
        assert to_legacy_delivery_status(DeliveryStatus.DISPATCHED) == "transito"
        assert to_legacy_delivery_status(DeliveryStatus.DELIVERED) == "entregue"


class TestOrderStateMachine:
    def test_valid_delivery_lifecycle(self):
        # 1. Pendente -> Producao (Primeiro aceite)
        t1 = OrderStateMachine.validate_transition(
            current_status=OrderStatus.PENDING,
            target_status=OrderStatus.PREPARING,
            fulfillment=FulfillmentType.DELIVERY,
        )
        assert t1.changed is True
        assert t1.first_accept is True
        assert t1.is_terminal is False

        # 2. Producao -> Pronto
        t2 = OrderStateMachine.validate_transition(
            current_status=OrderStatus.PREPARING,
            target_status=OrderStatus.READY,
            fulfillment=FulfillmentType.DELIVERY,
        )
        assert t2.changed is True
        assert t2.first_accept is False
        assert t2.is_terminal is False

        # 3. Pronto -> Cancelado (por recusa operacional com estorno)
        t3 = OrderStateMachine.validate_transition(
            current_status=OrderStatus.READY,
            target_status=OrderStatus.REJECTED,
            fulfillment=FulfillmentType.DELIVERY,
        )
        assert t3.changed is True
        assert t3.is_terminal is True

    def test_terminal_states_cannot_transition(self):
        with pytest.raises(InvalidOrderTransitionError) as exc_info:
            OrderStateMachine.validate_transition(
                current_status=OrderStatus.COMPLETED,
                target_status=OrderStatus.PREPARING,
                fulfillment=FulfillmentType.DELIVERY,
            )
        assert "completed" in str(exc_info.value)
        assert "preparing" in str(exc_info.value)

    def test_allowed_targets(self):
        targets = OrderStateMachine.get_allowed_targets(
            current_status=OrderStatus.PENDING,
            fulfillment=FulfillmentType.DELIVERY,
        )
        assert OrderStatus.PREPARING in targets
        assert OrderStatus.REJECTED in targets


class TestOrderCommandsAndInvariants:
    def test_item_input_rejects_zero_or_negative_quantity(self):
        with pytest.raises(InvalidItemQuantityError):
            OrderItemInput(product_id=10, quantity=Decimal("0.00"))

        with pytest.raises(InvalidItemQuantityError):
            OrderItemInput(product_id=10, quantity=Decimal("-1.50"))

    def test_create_order_command_rejects_empty_items(self):
        with pytest.raises(EmptyOrderItemsError):
            CreateOrderCommand(
                restaurant_id=1,
                channel=OrderChannel.WEB_CARDAPIO,
                fulfillment=FulfillmentType.PICKUP,
                items=(),
            )

    def test_delivery_fulfillment_requires_delivery_input(self):
        item = OrderItemInput(product_id=5, quantity=Decimal("2.00"))
        with pytest.raises(InvalidFulfillmentDetailsError) as exc_info:
            CreateOrderCommand(
                restaurant_id=1,
                channel=OrderChannel.WEB_CARDAPIO,
                fulfillment=FulfillmentType.DELIVERY,
                items=(item,),
                delivery=None,
            )
        assert "DELIVERY exigem informações de entrega" in str(exc_info.value)

    def test_delivery_input_requires_non_empty_address(self):
        with pytest.raises(InvalidFulfillmentDetailsError):
            DeliveryInput(address="   ")

    def test_delivery_input_rejects_negative_fee(self):
        with pytest.raises(InvalidFulfillmentDetailsError):
            DeliveryInput(address="Rua das Flores, 123", fee=Decimal("-5.00"))

    def test_external_reference_requires_provider_and_id(self):
        with pytest.raises(InvalidExternalReferenceError):
            ExternalOrderReference(provider="", external_order_id="123")

        with pytest.raises(InvalidExternalReferenceError):
            ExternalOrderReference(provider="ifood", external_order_id="")

        ext = ExternalOrderReference(provider="ifood", external_order_id="IFOOD-982172")
        assert ext.provider == "ifood"
        assert ext.external_order_id == "IFOOD-982172"

    def test_valid_dine_in_command_structure(self):
        item = OrderItemInput(
            product_id=1,
            quantity=Decimal("1.00"),
            modifier_ids=(101, 102),
            notes="Sem cebola",
        )
        cmd = CreateOrderCommand(
            restaurant_id=1,
            channel=OrderChannel.WAITER,
            fulfillment=FulfillmentType.DINE_IN,
            table_id=7,
            items=(item,),
            operator_user_id=42,
        )
        assert cmd.table_id == 7
        assert cmd.channel == OrderChannel.WAITER
        assert cmd.fulfillment == FulfillmentType.DINE_IN
        assert len(cmd.items) == 1
        assert cmd.items[0].quantity == Decimal("1.00")
        assert isinstance(cmd.items[0].quantity, Decimal)


class TestOrderQuoteValueObjects:
    def test_quote_preserves_decimal_precision(self):
        mod1 = ModifierQuote(id=1, name="Bacon Extra", unit_price=Decimal("4.50"))
        mod2 = ModifierQuote(id=2, name="Queijo Cheddar", unit_price=Decimal("3.00"))
        item = ItemQuote(
            product_id=10,
            name="Burguer Clássico",
            quantity=Decimal("2.00"),
            unit_price=Decimal("28.00"),
            modifiers=(mod1, mod2),
            subtotal=Decimal("71.00"),
        )
        quote = OrderQuote(
            items=(item,),
            subtotal=Decimal("56.00"),
            modifiers_total=Decimal("15.00"),
            discount_total=Decimal("5.00"),
            delivery_fee=Decimal("8.00"),
            service_fee=Decimal("0.00"),
            total=Decimal("74.00"),
        )
        assert quote.total == Decimal("74.00")
        assert isinstance(quote.total, Decimal)
        assert isinstance(quote.items[0].modifiers[0].unit_price, Decimal)


class TestOrderDomainEvents:
    def test_domain_events_instantiation_and_immutability(self):
        created = OrderCreated(
            restaurant_id=1,
            order_id=501,
            channel=OrderChannel.IFOOD,
            fulfillment=FulfillmentType.DELIVERY,
            total=Decimal("89.90"),
            items_count=3,
            customer_name="Carlos Silva",
            customer_phone="11999998888",
            external_provider="ifood",
            external_order_id="IFOOD-982172",
        )
        assert created.restaurant_id == 1
        assert created.order_id == 501
        assert created.total == Decimal("89.90")
        assert created.occurred_at is not None
        assert created.event_id is not None

        # Imutabilidade estrita
        with pytest.raises(Exception):
            created.total = Decimal("100.00")

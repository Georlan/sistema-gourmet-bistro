"""Testes de ponta a ponta do OrderApplicationService com banco de dados SQLite."""

from decimal import Decimal
import pytest
from sqlalchemy.orm import Session

from app.application.orders.commands import (
    AcceptOrderCommand,
    CancelOrderCommand,
    CompleteOrderCommand,
    CreateOrderCommand,
    CustomerInput,
    DeliveryInput,
    MarkOrderReadyCommand,
    OrderItemInput,
    RejectOrderCommand,
)
from app.application.orders.service import OrderApplicationService
from app.database import SessionLocal
from app.domain.orders.errors import InvalidOrderTransitionError
from app.domain.orders.types import FulfillmentType, OrderChannel
from app.models import Comanda, Item, MovimentacaoEstoque
from tests.characterization.orders.fixtures import (
    CHAR_RESTAURANT_ID,
    char_client,
    char_setup,
)


class TestOrderApplicationService:
    def test_create_delivery_order_end_to_end(self, char_setup):
        """Cria pedido de delivery completo, verifica Comanda/Lançamento/Itens e estoque pendente."""
        db: Session = SessionLocal()
        try:
            cmd = CreateOrderCommand(
                restaurant_id=CHAR_RESTAURANT_ID,
                channel=OrderChannel.WEB_CARDAPIO,
                fulfillment=FulfillmentType.DELIVERY,
                items=(
                    OrderItemInput(
                        product_id="prod-char-simples",
                        quantity=Decimal("2.00"),
                        modifier_ids=("mod-char-bacon",),
                        notes="Sem cebola",
                    ),
                ),
                customer=CustomerInput(
                    name="João Silva",
                    phone="11999990001",
                ),
                delivery=DeliveryInput(
                    address="Rua das Acácias, 100",
                    fee=Decimal("7.00"),
                ),
                coupon_code="CHAR10",  # 10%
            )

            dto = OrderApplicationService.create_order(db, cmd)

            # Verificações no DTO
            # 2x (25.00 + 5.00) = 60.00 | Cupom 10% = 6.00 | Frete = 7.00 | Total = 61.00
            assert dto.restaurant_id == CHAR_RESTAURANT_ID
            assert dto.fulfillment == "delivery"
            assert dto.status == "pendente"
            assert dto.subtotal == Decimal("60.00")
            assert dto.discount == Decimal("6.00")
            assert dto.delivery_fee == Decimal("7.00")
            assert dto.total == Decimal("61.00")
            assert len(dto.items) == 2  # 2 unidades persistidas individualmente

            # Verificar persistência no banco
            comanda = db.query(Comanda).filter(Comanda.id == dto.order_id).first()
            assert comanda is not None
            assert comanda.delivery_status == "pendente"
            assert len(comanda.itens) == 2
            assert len(comanda.lancamentos) == 1

            # Pedido pendente NÃO deve ter consumido estoque ainda
            movs = db.query(MovimentacaoEstoque).filter(
                MovimentacaoEstoque.restaurante_id == CHAR_RESTAURANT_ID,
                MovimentacaoEstoque.referencia_id.in_([it.id for it in comanda.itens]),
            ).all()
            assert len(movs) == 0
        finally:
            db.close()

    def test_create_pickup_order_consumes_inventory_immediately(self, char_setup):
        """Retirada nasce em 'producao' e consome estoque imediatamente."""
        db: Session = SessionLocal()
        try:
            cmd = CreateOrderCommand(
                restaurant_id=CHAR_RESTAURANT_ID,
                channel=OrderChannel.WEB_CARDAPIO,
                fulfillment=FulfillmentType.PICKUP,
                items=(
                    OrderItemInput(
                        product_id="prod-char-simples",
                        quantity=Decimal("1.00"),
                    ),
                ),
                customer=CustomerInput(
                    name="Maria Santos",
                    phone="11999990002",
                ),
            )

            dto = OrderApplicationService.create_order(db, cmd)
            assert dto.status == "producao"

            comanda = db.query(Comanda).filter(Comanda.id == dto.order_id).first()
            assert comanda.delivery_status == "producao"

            # Movimentação de estoque deve existir
            movs = db.query(MovimentacaoEstoque).filter(
                MovimentacaoEstoque.restaurante_id == CHAR_RESTAURANT_ID,
                MovimentacaoEstoque.referencia_id.in_([it.id for it in comanda.itens]),
            ).all()
            assert len(movs) > 0
        finally:
            db.close()

    def test_idempotency_returns_existing_order(self, char_setup):
        """Replay com mesma chave idempotente retorna o pedido existente sem duplicar registros."""
        db: Session = SessionLocal()
        try:
            key = "idemp-key-unique-123456"
            cmd = CreateOrderCommand(
                restaurant_id=CHAR_RESTAURANT_ID,
                channel=OrderChannel.WEB_CARDAPIO,
                fulfillment=FulfillmentType.PICKUP,
                items=(
                    OrderItemInput(
                        product_id="prod-char-simples",
                        quantity=Decimal("1.00"),
                    ),
                ),
                idempotency_key=key,
            )

            dto1 = OrderApplicationService.create_order(db, cmd)
            dto2 = OrderApplicationService.create_order(db, cmd)

            assert dto1.order_id == dto2.order_id
            assert dto1.total == dto2.total

            # Apenas 1 comanda criada no banco
            count = db.query(Comanda).filter(
                Comanda.restaurante_id == CHAR_RESTAURANT_ID,
                Comanda.idempotency_key == key,
            ).count()
            assert count == 1
        finally:
            db.close()

    def test_accept_order_transitions_to_producao_and_consumes_inventory(self, char_setup):
        """Aceitar pedido pendente transiciona para producao e debita estoque."""
        db: Session = SessionLocal()
        try:
            cmd = CreateOrderCommand(
                restaurant_id=CHAR_RESTAURANT_ID,
                channel=OrderChannel.WEB_CARDAPIO,
                fulfillment=FulfillmentType.DELIVERY,
                items=(
                    OrderItemInput(
                        product_id="prod-char-simples",
                        quantity=Decimal("1.00"),
                    ),
                ),
                delivery=DeliveryInput(address="Rua A, 1"),
                customer=CustomerInput(name="Carlos Lima", phone="11999990003"),
            )
            created = OrderApplicationService.create_order(db, cmd)
            assert created.status == "pendente"

            # Aceitar
            accept_cmd = AcceptOrderCommand(
                restaurant_id=CHAR_RESTAURANT_ID,
                order_id=created.order_id,
            )
            accepted = OrderApplicationService.accept_order(db, accept_cmd)
            assert accepted.status == "producao"

            comanda = db.query(Comanda).filter(Comanda.id == created.order_id).first()
            assert comanda.delivery_status == "producao"

            # Estoque agora baixado
            movs = db.query(MovimentacaoEstoque).filter(
                MovimentacaoEstoque.restaurante_id == CHAR_RESTAURANT_ID,
                MovimentacaoEstoque.referencia_id.in_([it.id for it in comanda.itens]),
            ).all()
            assert len(movs) > 0
        finally:
            db.close()

    def test_cancel_order_restores_inventory_and_closes_comanda(self, char_setup):
        """Cancelar pedido aceito estorna o estoque e fecha a comanda."""
        db: Session = SessionLocal()
        try:
            cmd = CreateOrderCommand(
                restaurant_id=CHAR_RESTAURANT_ID,
                channel=OrderChannel.WEB_CARDAPIO,
                fulfillment=FulfillmentType.PICKUP,
                items=(
                    OrderItemInput(
                        product_id="prod-char-simples",
                        quantity=Decimal("1.00"),
                    ),
                ),
            )
            created = OrderApplicationService.create_order(db, cmd)

            cancel_cmd = CancelOrderCommand(
                restaurant_id=CHAR_RESTAURANT_ID,
                order_id=created.order_id,
                reason="Cliente desistiu",
                refund_stock=True,
            )
            cancelled = OrderApplicationService.cancel_order(db, cancel_cmd)
            assert cancelled.status == "recusado"

            comanda = db.query(Comanda).filter(Comanda.id == created.order_id).first()
            assert comanda.fechada is True
            assert all(it.status == "cancelado" for it in comanda.itens)

            # Estorno de estoque deve existir
            estornos = db.query(MovimentacaoEstoque).filter(
                MovimentacaoEstoque.restaurante_id == CHAR_RESTAURANT_ID,
                MovimentacaoEstoque.referencia_id.in_([it.id for it in comanda.itens]),
                MovimentacaoEstoque.origem == "cancelamento_venda",
            ).all()
            assert len(estornos) > 0
        finally:
            db.close()

    def test_invalid_transition_raises_state_machine_error(self, char_setup):
        """Transição inválida protegida pelo OrderStateMachine."""
        db: Session = SessionLocal()
        try:
            cmd = CreateOrderCommand(
                restaurant_id=CHAR_RESTAURANT_ID,
                channel=OrderChannel.WEB_CARDAPIO,
                fulfillment=FulfillmentType.PICKUP,
                items=(
                    OrderItemInput(
                        product_id="prod-char-simples",
                        quantity=Decimal("1.00"),
                    ),
                ),
            )
            created = OrderApplicationService.create_order(db, cmd)

            # Marcar pronto
            OrderApplicationService.mark_order_ready(
                db,
                MarkOrderReadyCommand(
                    restaurant_id=CHAR_RESTAURANT_ID,
                    order_id=created.order_id,
                ),
            )

            # Completar pedido
            OrderApplicationService.complete_order(
                db,
                CompleteOrderCommand(
                    restaurant_id=CHAR_RESTAURANT_ID,
                    order_id=created.order_id,
                ),
            )

            # Tentar aceitar pedido já completado (deve falhar)
            with pytest.raises(InvalidOrderTransitionError):
                OrderApplicationService.accept_order(
                    db,
                    AcceptOrderCommand(
                        restaurant_id=CHAR_RESTAURANT_ID,
                        order_id=created.order_id,
                    ),
                )
        finally:
            db.close()

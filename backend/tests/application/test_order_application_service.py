"""Testes de ponta a ponta do OrderApplicationService (Fase 3.1: Alinhamento Semântico e Transacional)."""

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
from app.models import Cliente, Comanda, ConfiguracaoRestaurante, Cupom, HistoricoFidelidade, Item, Lancamento, MovimentacaoEstoque
from tests.characterization.orders.fixtures import (
    CHAR_RESTAURANT_ID,
    char_client,
    char_setup,
)


class TestOrderApplicationServicePhase31:
    def test_canonical_identity_order_is_not_comanda(self, char_setup):
        """Garante que Order == Lancamento, order_id != comanda_id e display_number segue a família (ex: '1-A')."""
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
                customer=CustomerInput(name="João Silva", phone="11999990001"),
                delivery=DeliveryInput(address="Rua das Acácias, 100"),
            )

            dto = OrderApplicationService.create_order(db, cmd)

            # Verificações de Identidade Canônica
            assert dto.order_id.startswith("l-")  # Lancamento ID
            assert dto.comanda_id.startswith("c-")  # Comanda ID
            assert dto.order_id != dto.comanda_id  # Order != Comanda
            assert dto.sequence == 1
            assert dto.display_number.endswith("-A")  # ex: '1-A'
            assert dto.display_number == f"{dto.display_number.split('-')[0]}-A"

            # Verificar no banco
            lanc = db.query(Lancamento).filter(Lancamento.id == dto.order_id).first()
            assert lanc is not None
            assert lanc.comanda_id == dto.comanda_id

            comanda = db.query(Comanda).filter(Comanda.id == dto.comanda_id).first()
            assert comanda is not None
            assert str(comanda.numero_pedido) == dto.display_number.split("-")[0]
        finally:
            db.close()

    def test_multiple_orders_in_same_comanda_family_sequences_24a_24b(self, char_setup):
        """Múltiplos pedidos na mesma comanda geram sequências 1 (24-A) e 2 (24-B)."""
        db: Session = SessionLocal()
        try:
            # 1. Primeiro pedido cria a comanda
            cmd1 = CreateOrderCommand(
                restaurant_id=CHAR_RESTAURANT_ID,
                channel=OrderChannel.WAITER,
                fulfillment=FulfillmentType.DINE_IN,
                table_id=1,
                items=(
                    OrderItemInput(
                        product_id="prod-char-simples",
                        quantity=Decimal("1.00"),
                    ),
                ),
            )
            order_a = OrderApplicationService.create_order(db, cmd1)
            assert order_a.sequence == 1
            assert order_a.display_number.endswith("-A")

            # 2. Segundo pedido na mesma conta (check_id)
            cmd2 = CreateOrderCommand(
                restaurant_id=CHAR_RESTAURANT_ID,
                channel=OrderChannel.WAITER,
                fulfillment=FulfillmentType.DINE_IN,
                check_id=order_a.comanda_id,
                table_id=1,
                items=(
                    OrderItemInput(
                        product_id="prod-char-simples",
                        quantity=Decimal("2.00"),
                    ),
                ),
            )
            order_b = OrderApplicationService.create_order(db, cmd2)

            # Devem pertencer à mesma Comanda, mas com Lançamentos e identidades distintas
            assert order_b.comanda_id == order_a.comanda_id
            assert order_b.order_id != order_a.order_id
            assert order_b.sequence == 2
            assert order_b.display_number.endswith("-B")
            assert order_b.display_number.split("-")[0] == order_a.display_number.split("-")[0]

            # Cada DTO reflete a sua fatia de itens
            assert len(order_a.items) == 1
            assert len(order_b.items) == 2
        finally:
            db.close()

    def test_order_lifecycle_scoped_to_specific_launch_without_affecting_others(self, char_setup):
        """Aceitar ou cancelar um pedido atua especificamente nos itens do seu lançamento."""
        db: Session = SessionLocal()
        try:
            # Cria 24-A
            cmd1 = CreateOrderCommand(
                restaurant_id=CHAR_RESTAURANT_ID,
                channel=OrderChannel.WEB_CARDAPIO,
                fulfillment=FulfillmentType.DELIVERY,
                items=(OrderItemInput(product_id="prod-char-simples", quantity=Decimal("1.00")),),
                delivery=DeliveryInput(address="Rua A, 1"),
                customer=CustomerInput(name="Cliente A", phone="11999990001"),
            )
            order_a = OrderApplicationService.create_order(db, cmd1)

            # Cria 24-B na mesma conta
            cmd2 = CreateOrderCommand(
                restaurant_id=CHAR_RESTAURANT_ID,
                channel=OrderChannel.WEB_CARDAPIO,
                fulfillment=FulfillmentType.DELIVERY,
                check_id=order_a.comanda_id,
                items=(OrderItemInput(product_id="prod-char-simples", quantity=Decimal("1.00")),),
                delivery=DeliveryInput(address="Rua A, 1"),
                customer=CustomerInput(name="Cliente A", phone="11999990001"),
            )
            order_b = OrderApplicationService.create_order(db, cmd2)

            # Aceitar especificamente o pedido 24-B
            accept_cmd = AcceptOrderCommand(
                restaurant_id=CHAR_RESTAURANT_ID,
                order_id=order_b.order_id,  # Passa o Lancamento.id
            )
            OrderApplicationService.accept_order(db, accept_cmd)

            # Movimentações de estoque devem existir APENAS para os itens do pedido B
            movs_b = db.query(MovimentacaoEstoque).filter(
                MovimentacaoEstoque.restaurante_id == CHAR_RESTAURANT_ID,
                MovimentacaoEstoque.referencia_id.in_([it.item_id for it in order_b.items]),
            ).all()
            assert len(movs_b) > 0

            # Itens do pedido A NÃO devem ter movimentação de estoque
            movs_a = db.query(MovimentacaoEstoque).filter(
                MovimentacaoEstoque.restaurante_id == CHAR_RESTAURANT_ID,
                MovimentacaoEstoque.referencia_id.in_([it.item_id for it in order_a.items]),
            ).all()
            assert len(movs_a) == 0
        finally:
            db.close()

    def test_server_authoritative_delivery_fee_ignores_client_tampering(self, char_setup):
        """O servidor calcula o frete autoritativamente e ignora valores adulterados pelo cliente."""
        db: Session = SessionLocal()
        try:
            # Configura taxa por bairro no restaurante
            config = db.query(ConfiguracaoRestaurante).filter(
                ConfiguracaoRestaurante.restaurante_id == CHAR_RESTAURANT_ID
            ).first()
            if not config:
                config = ConfiguracaoRestaurante(
                    restaurante_id=CHAR_RESTAURANT_ID,
                    tipo_taxa_entrega="bairro",
                    tabela_taxas_bairros=[{"bairro": "Centro", "taxa": 5.0}],
                )
                db.add(config)
            else:
                config.tipo_taxa_entrega = "bairro"
                config.tabela_taxas_bairros = [{"bairro": "Centro", "taxa": 5.0}]
            db.commit()

            # Cliente tenta enviar fee=0.01 adulterada
            cmd = CreateOrderCommand(
                restaurant_id=CHAR_RESTAURANT_ID,
                channel=OrderChannel.WEB_CARDAPIO,
                fulfillment=FulfillmentType.DELIVERY,
                items=(OrderItemInput(product_id="prod-char-simples", quantity=Decimal("1.00")),),
                customer=CustomerInput(name="João Centro", phone="11999990001"),
                delivery=DeliveryInput(
                    address="Av Brasil, 500",
                    neighborhood="Centro",
                    fee=Decimal("0.01"),  # Adulterado pelo cliente
                ),
            )

            dto = OrderApplicationService.create_order(db, cmd)

            # Servidor deve ter aplicado a taxa autoritativa de R$ 5,00 do bairro Centro
            assert dto.delivery_fee == Decimal("5.00")
            assert dto.total == Decimal("25.00") + Decimal("5.00")  # 30.00
        finally:
            db.close()

    def test_cupom_transactional_effects_increment_usage_and_persist_fk(self, char_setup):
        """Cupom aplicado com sucesso incrementa usos_atuais e grava cupom_id na comanda."""
        db: Session = SessionLocal()
        try:
            cupom = db.query(Cupom).filter(
                Cupom.restaurante_id == CHAR_RESTAURANT_ID,
                Cupom.codigo == "CHAR10",
            ).first()
            usos_iniciais = cupom.usos_atuais or 0

            cmd = CreateOrderCommand(
                restaurant_id=CHAR_RESTAURANT_ID,
                channel=OrderChannel.WEB_CARDAPIO,
                fulfillment=FulfillmentType.PICKUP,
                items=(OrderItemInput(product_id="prod-char-simples", quantity=Decimal("1.00")),),
                customer=CustomerInput(name="Maria Cupom", phone="11999990002"),
                coupon_code="CHAR10",
            )

            dto = OrderApplicationService.create_order(db, cmd)
            assert dto.discount == Decimal("2.50")  # 10% de 25.00

            # Verificar atualização atômica no banco
            db.refresh(cupom)
            assert cupom.usos_atuais == usos_iniciais + 1

            comanda = db.query(Comanda).filter(Comanda.id == dto.comanda_id).first()
            assert comanda.cupom_id == cupom.id
            assert comanda.valor_desconto_cupom == 2.50
        finally:
            db.close()

    def test_cashback_transactional_effects_deducts_customer_balance(self, char_setup):
        """Resgate de cashback deduz saldo do cliente no banco e registra histórico."""
        db: Session = SessionLocal()
        try:
            cliente = db.query(Cliente).filter(
                Cliente.restaurante_id == CHAR_RESTAURANT_ID,
                Cliente.telefone == "11999998888",
            ).first()
            if not cliente:
                cliente = Cliente(
                    restaurante_id=CHAR_RESTAURANT_ID,
                    nome="Cliente Fidelidade",
                    telefone="11999998888",
                    saldo_cashback=15.00,
                )
                db.add(cliente)
                db.commit()
                db.refresh(cliente)
            else:
                cliente.saldo_cashback = 15.00
                db.commit()

            cmd = CreateOrderCommand(
                restaurant_id=CHAR_RESTAURANT_ID,
                channel=OrderChannel.WEB_CARDAPIO,
                fulfillment=FulfillmentType.PICKUP,
                items=(OrderItemInput(product_id="prod-char-simples", quantity=Decimal("1.00")),),
                customer=CustomerInput(customer_id=cliente.id, name=cliente.nome, phone=cliente.telefone),
                usar_cashback=True,
            )

            dto = OrderApplicationService.create_order(db, cmd)
            assert dto.discount == Decimal("15.00")
            assert dto.total == Decimal("10.00")  # 25.00 - 15.00

            # Saldo do cliente deve ter sido zerado no banco
            db.refresh(cliente)
            assert float(cliente.saldo_cashback) == 0.00

            # Histórico de fidelidade registrado
            hist = db.query(HistoricoFidelidade).filter(
                HistoricoFidelidade.restaurante_id == CHAR_RESTAURANT_ID,
                HistoricoFidelidade.comanda_id == dto.comanda_id,
                HistoricoFidelidade.tipo_movimentacao == "RESGATE",
            ).first()
            assert hist is not None
            assert float(hist.valor_delta) == -15.00
        finally:
            db.close()

    def test_checkout_context_fields_persisted_on_comanda(self, char_setup):
        """Preserva bairro, forma de pagamento e troco na comanda."""
        db: Session = SessionLocal()
        try:
            cmd = CreateOrderCommand(
                restaurant_id=CHAR_RESTAURANT_ID,
                channel=OrderChannel.WEB_CARDAPIO,
                fulfillment=FulfillmentType.DELIVERY,
                items=(OrderItemInput(product_id="prod-char-simples", quantity=Decimal("1.00")),),
                customer=CustomerInput(name="Ana Pagamento", phone="11999990005"),
                delivery=DeliveryInput(address="Rua B, 20", neighborhood="Jardins"),
                payment_method="Dinheiro",
                change_for="R$ 50,00",
            )

            dto = OrderApplicationService.create_order(db, cmd)

            comanda = db.query(Comanda).filter(Comanda.id == dto.comanda_id).first()
            assert comanda.delivery_bairro == "Jardins"
            assert comanda.delivery_forma_pagamento == "Dinheiro"
            assert comanda.delivery_troco_para == 50.0
        finally:
            db.close()

    def test_idempotency_returns_existing_order_without_creating_duplicates(self, char_setup):
        """Replay com mesma chave idempotente retorna o pedido existente sem duplicar registros."""
        db: Session = SessionLocal()
        try:
            key = "idemp-key-unique-998877"
            cmd = CreateOrderCommand(
                restaurant_id=CHAR_RESTAURANT_ID,
                channel=OrderChannel.WEB_CARDAPIO,
                fulfillment=FulfillmentType.PICKUP,
                items=(OrderItemInput(product_id="prod-char-simples", quantity=Decimal("1.00")),),
                idempotency_key=key,
            )

            dto1 = OrderApplicationService.create_order(db, cmd)
            dto2 = OrderApplicationService.create_order(db, cmd)

            assert dto1.order_id == dto2.order_id
            assert dto1.comanda_id == dto2.comanda_id
            assert dto1.total == dto2.total

            # Apenas 1 lançamento criado no banco
            count = db.query(Lancamento).filter(
                Lancamento.restaurante_id == CHAR_RESTAURANT_ID,
                Lancamento.idempotency_key == key,
            ).count()
            assert count == 1
        finally:
            db.close()

    def test_cancel_order_restores_inventory_and_closes_comanda_when_all_cancelled(self, char_setup):
        """Cancelar único pedido da comanda estorna estoque e fecha a comanda."""
        db: Session = SessionLocal()
        try:
            cmd = CreateOrderCommand(
                restaurant_id=CHAR_RESTAURANT_ID,
                channel=OrderChannel.WEB_CARDAPIO,
                fulfillment=FulfillmentType.PICKUP,
                items=(OrderItemInput(product_id="prod-char-simples", quantity=Decimal("1.00")),),
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

            comanda = db.query(Comanda).filter(Comanda.id == created.comanda_id).first()
            assert comanda.fechada is True
            assert all(it.status == "cancelado" for it in comanda.itens)

            estornos = db.query(MovimentacaoEstoque).filter(
                MovimentacaoEstoque.restaurante_id == CHAR_RESTAURANT_ID,
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
                items=(OrderItemInput(product_id="prod-char-simples", quantity=Decimal("1.00")),),
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

            # Finalizar
            OrderApplicationService.complete_order(
                db,
                CompleteOrderCommand(
                    restaurant_id=CHAR_RESTAURANT_ID,
                    order_id=created.order_id,
                ),
            )

            # Tentar aceitar pedido já completado (deve disparar erro de transição)
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

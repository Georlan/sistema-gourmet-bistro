"""Testes de validação da migration e compatibilidade do Lancamento.status e rotas (Fase 3.2.1)."""

from decimal import Decimal
import uuid
import pytest
from sqlalchemy.orm import Session

from app.application.orders.commands import (
    CancelOrderCommand,
    CreateOrderCommand,
    CustomerInput,
    DeliveryInput,
    OrderItemInput,
    RejectOrderCommand,
)
from app.application.orders.service import OrderApplicationService
from app.database import SessionLocal, engine
from app.domain.orders.errors import InvalidOrderTransitionError
from app.domain.orders.types import FulfillmentType, OrderChannel, OrderStatus
from app.models import Comanda, Item, Lancamento, Motoboy, Restaurante, Usuario
from tests.characterization.orders.fixtures import (
    CHAR_RESTAURANT_ID,
    char_client,
    char_setup,
)


class TestLancamentoMigrationAndCompatibility:

    def test_lancamento_table_has_status_column_with_default(self, char_setup):
        """Verifica que Lancamento possui a coluna status no schema com valor default 'pendente'."""
        db: Session = SessionLocal()
        try:
            comanda = Comanda(
                id=f"c-{uuid.uuid4().hex[:8]}",
                restaurante_id=CHAR_RESTAURANT_ID,
                garcom_id="usr-char-admin",
                tipo="Retirada",
                numero_pedido=999,
                fechada=False,
            )
            db.add(comanda)
            db.flush()

            # Cria lançamento sem passar status explicitamente (simula código legado)
            lanc = Lancamento(
                id=f"l-{uuid.uuid4().hex[:8]}",
                restaurante_id=CHAR_RESTAURANT_ID,
                comanda_id=comanda.id,
                garcom_id="usr-char-admin",
                origem="caixa",
            )
            db.add(lanc)
            db.commit()
            db.refresh(lanc)

            assert lanc.status == "pendente"
        finally:
            db.close()

    def test_reject_order_produces_recusado_status_distinct_from_cancelado(self, char_setup):
        """Garante que reject_order() transiciona para 'recusado' (REJECTED), não 'cancelado'."""
        db: Session = SessionLocal()
        try:
            cmd = CreateOrderCommand(
                restaurant_id=CHAR_RESTAURANT_ID,
                channel=OrderChannel.WEB_CARDAPIO,
                fulfillment=FulfillmentType.DELIVERY,
                items=(OrderItemInput(product_id="prod-char-simples", quantity=Decimal("1.00")),),
                customer=CustomerInput(name="Cliente Rejeitado", phone="11999990001"),
                delivery=DeliveryInput(address="Rua Rejeicao, 1"),
            )
            dto = OrderApplicationService.create_order(db, cmd)
            assert dto.status == "pendente"

            # Rejeitar pedido
            reject_cmd = RejectOrderCommand(
                restaurant_id=CHAR_RESTAURANT_ID,
                order_id=dto.order_id,
                reason="Restaurante sobrecarregado",
            )
            rejected_dto = OrderApplicationService.reject_order(db, reject_cmd)

            # Verifica DTO e banco
            assert rejected_dto.status == "recusado"

            lanc = db.query(Lancamento).filter(Lancamento.id == dto.order_id).one()
            comanda = db.query(Comanda).filter(Comanda.id == dto.comanda_id).one()

            assert lanc.status == "recusado"
            assert comanda.delivery_status == "recusado"
            assert comanda.fechada is True
        finally:
            db.close()

    def test_multi_tenant_scoping_in_delivery_dispatch(self, char_setup):
        """Garante que motoboy de outro restaurante não pode ser vinculado a entrega de tenant diferente."""
        from fastapi import HTTPException
        from app.routes.orders_core import despachar_delivery
        from fastapi import BackgroundTasks

        db: Session = SessionLocal()
        other_rid = 888
        try:
            # Cria outro restaurante e motoboy para ele
            other_rest = Restaurante(id=other_rid, nome="Outro Restaurante", plano="bistro")
            db.add(other_rest)
            db.flush()

            motoboy_outro = Motoboy(
                id=9988,
                restaurante_id=other_rid,
                nome="Motoboy Invasor",
                telefone="11999998888",
                ativo=True,
            )
            db.add(motoboy_outro)

            # Cria comanda no restaurante do teste
            comanda_valida = Comanda(
                id=f"c-{uuid.uuid4().hex[:8]}",
                restaurante_id=CHAR_RESTAURANT_ID,
                garcom_id="usr-char-admin",
                tipo="Delivery",
                delivery_status="pronto",
                numero_pedido=8881,
                fechada=False,
            )
            db.add(comanda_valida)
            db.commit()

            # Tenta despachar usando motoboy do outro restaurante (deve lançar 404 por falta de tenant matching)
            from app.database import current_restaurante_id
            token = current_restaurante_id.set(CHAR_RESTAURANT_ID)
            try:
                with pytest.raises(HTTPException) as exc_info:
                    despachar_delivery(
                        comanda_id=comanda_valida.id,
                        payload={"motoboy_id": 9988},
                        background_tasks=BackgroundTasks(),
                        db=db,
                        current_user=None,
                    )
                assert exc_info.value.status_code == 404
                assert "Motoboy não encontrado" in exc_info.value.detail
            finally:
                current_restaurante_id.reset(token)
        finally:
            db.close()

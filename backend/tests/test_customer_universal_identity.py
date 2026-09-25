from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from app.application.orders.commands import (
    CreateOrderCommand,
    CustomerInput,
    DeliveryInput,
    OrderItemInput,
)
from app.application.orders.service import OrderApplicationService
from app.database import SessionLocal, current_restaurante_id
from app.domain.orders.types import FulfillmentType, OrderChannel
from app.models import (
    Cliente,
    Comanda,
    ConfigFidelizacao,
    HistoricoFidelidade,
    Pagamento,
    Restaurante,
)
from app.services.clientes import registrar_fidelidade_compra_quitada
from app.services.customer_relationship import load_customer_relationship_metrics
from tests.characterization.orders.fixtures import CHAR_RESTAURANT_ID, char_client, char_setup


def _web_order(db: Session, *, phone: str, name: str, address: str):
    return OrderApplicationService.create_order(
        db,
        CreateOrderCommand(
            restaurant_id=CHAR_RESTAURANT_ID,
            channel=OrderChannel.WEB_CARDAPIO,
            fulfillment=FulfillmentType.DELIVERY,
            items=(
                OrderItemInput(
                    product_id="prod-char-simples",
                    quantity=Decimal("1.00"),
                ),
            ),
            customer=CustomerInput(name=name, phone=phone),
            delivery=DeliveryInput(address=address),
        ),
    )


def test_web_guest_order_creates_and_links_canonical_customer(char_setup):
    db = SessionLocal()
    phone = "11988881001"
    try:
        dto = _web_order(
            db,
            phone=phone,
            name="Cliente Guest",
            address="Rua Guest, 10",
        )

        customer = db.query(Cliente).filter(
            Cliente.restaurante_id == CHAR_RESTAURANT_ID,
            Cliente.telefone == phone,
        ).one()
        command = db.query(Comanda).filter(
            Comanda.restaurante_id == CHAR_RESTAURANT_ID,
            Comanda.id == dto.comanda_id,
        ).one()

        assert command.cliente_id == customer.id
        assert customer.nome == "Cliente Guest"
        assert customer.endereco == "Rua Guest, 10"
    finally:
        db.close()


def test_public_order_links_existing_phone_without_overwriting_profile(char_setup):
    db = SessionLocal()
    phone = "11988881002"
    try:
        customer = Cliente(
            id="customer-existing-universal",
            restaurante_id=CHAR_RESTAURANT_ID,
            telefone=phone,
            nome="Nome Canônico",
            endereco="Endereço Salvo, 20",
            saldo_pontos=0,
            saldo_cashback=0,
        )
        db.add(customer)
        db.commit()

        dto = _web_order(
            db,
            phone=phone,
            name="Nome Não Verificado",
            address="Endereço Não Verificado, 999",
        )
        db.expire_all()

        persisted = db.query(Cliente).filter(
            Cliente.restaurante_id == CHAR_RESTAURANT_ID,
            Cliente.telefone == phone,
        ).one()
        command = db.query(Comanda).filter(
            Comanda.restaurante_id == CHAR_RESTAURANT_ID,
            Comanda.id == dto.comanda_id,
        ).one()

        assert command.cliente_id == persisted.id
        assert persisted.id == "customer-existing-universal"
        assert persisted.nome == "Nome Canônico"
        assert persisted.endereco == "Endereço Salvo, 20"
    finally:
        db.close()


def test_same_phone_in_other_tenant_never_leaks_identity(char_setup):
    db = SessionLocal(restaurante_id=None)
    phone = "11988881003"
    other_restaurant_id = 7781

    foreign_token = current_restaurante_id.set(None)
    try:
        if not db.query(Restaurante).filter(Restaurante.id == other_restaurant_id).first():
            db.add(Restaurante(id=other_restaurant_id, nome="Outro Tenant", plano="pocket"))
            db.flush()
        db.add(Cliente(
            id="customer-other-tenant",
            restaurante_id=other_restaurant_id,
            telefone=phone,
            nome="Cliente Outro Tenant",
            saldo_pontos=0,
            saldo_cashback=0,
        ))
        db.commit()
    finally:
        current_restaurante_id.reset(foreign_token)

    try:
        dto = _web_order(
            db,
            phone=phone,
            name="Cliente Tenant Correto",
            address="Rua Tenant, 30",
        )

        command = db.query(Comanda).filter(
            Comanda.restaurante_id == CHAR_RESTAURANT_ID,
            Comanda.id == dto.comanda_id,
        ).one()
        local_customer = db.query(Cliente).filter(
            Cliente.restaurante_id == CHAR_RESTAURANT_ID,
            Cliente.telefone == phone,
        ).one()

        assert command.cliente_id == local_customer.id
        assert local_customer.id != "customer-other-tenant"
        assert local_customer.nome == "Cliente Tenant Correto"
    finally:
        db.rollback()
        cleanup_token = current_restaurante_id.set(None)
        try:
            db.query(Cliente).filter(Cliente.restaurante_id == other_restaurant_id).delete(
                synchronize_session=False,
            )
            db.query(Restaurante).filter(Restaurante.id == other_restaurant_id).delete(
                synchronize_session=False,
            )
            db.commit()
        finally:
            current_restaurante_id.reset(cleanup_token)
            db.close()

def test_online_pix_approval_credits_loyalty_once(char_setup):
    db = SessionLocal()
    customer_id = "customer-online-loyalty"
    command_id = "command-online-loyalty"
    payment_id = "payment-online-loyalty"
    created_config = False
    old_config = None
    try:
        config = db.query(ConfigFidelizacao).filter(
            ConfigFidelizacao.restaurante_id == CHAR_RESTAURANT_ID,
        ).first()
        if config is None:
            created_config = True
            config = ConfigFidelizacao(restaurante_id=CHAR_RESTAURANT_ID)
            db.add(config)
        else:
            old_config = (
                config.ativo,
                config.tipo_recompensa,
                config.taxa_conversao,
                config.valor_ponto_em_dinheiro,
            )
        config.ativo = True
        config.tipo_recompensa = "CASHBACK"
        config.taxa_conversao = 3.0
        config.valor_ponto_em_dinheiro = 0.05

        customer = Cliente(
            id=customer_id,
            restaurante_id=CHAR_RESTAURANT_ID,
            telefone="11988881004",
            nome="Cliente Pix",
            saldo_pontos=0,
            saldo_cashback=0,
        )
        command = Comanda(
            id=command_id,
            restaurante_id=CHAR_RESTAURANT_ID,
            garcom_id="usr-char-admin",
            cliente_id=customer_id,
            numero_pedido=981004,
            tipo="Delivery",
            delivery_status="pendente",
            online_payment_status="approved",
            valor_pago=0,
        )
        db.add_all([customer, command])
        db.flush()

        # O fixture abre um turno; usar o turno persistido evita acoplar ao ID.
        from app.models import CaixaTurno

        current_shift = db.query(CaixaTurno).filter(
            CaixaTurno.restaurante_id == CHAR_RESTAURANT_ID,
            CaixaTurno.status == "aberto",
        ).order_by(CaixaTurno.id.desc()).first()
        assert current_shift is not None

        db.add(Pagamento(
            id=payment_id,
            restaurante_id=CHAR_RESTAURANT_ID,
            comanda_id=command_id,
            turno_id=current_shift.id,
            valor=100,
            metodo="pix",
            status="aprovado",
            idempotency_key="online:mercado_pago:universal-981004",
            cliente_id=customer_id,
            nome_cliente="Cliente Pix",
        ))
        db.commit()
        db.expire_all()

        persisted = db.query(Cliente).filter(Cliente.id == customer_id).one()
        ledger = db.query(HistoricoFidelidade).filter(
            HistoricoFidelidade.restaurante_id == CHAR_RESTAURANT_ID,
            HistoricoFidelidade.comanda_id == command_id,
            HistoricoFidelidade.tipo_movimentacao == "ACUMULO",
        ).all()
        assert Decimal(str(persisted.saldo_cashback)) == Decimal("3.00")
        assert len(ledger) == 1
        assert Decimal(str(ledger[0].valor_delta)) == Decimal("3.0000")

        # Um segundo caminho de fechamento/reconciliação não pode duplicar o crédito.
        command = db.query(Comanda).filter(Comanda.id == command_id).one()
        customer = db.query(Cliente).filter(Cliente.id == customer_id).one()
        assert registrar_fidelidade_compra_quitada(
            db,
            comanda=command,
            cliente=customer,
            valor_base=100,
        ) is False
        db.commit()
        assert db.query(HistoricoFidelidade).filter(
            HistoricoFidelidade.restaurante_id == CHAR_RESTAURANT_ID,
            HistoricoFidelidade.comanda_id == command_id,
            HistoricoFidelidade.tipo_movimentacao == "ACUMULO",
        ).count() == 1
    finally:
        db.rollback()
        config = db.query(ConfigFidelizacao).filter(
            ConfigFidelizacao.restaurante_id == CHAR_RESTAURANT_ID,
        ).first()
        if created_config and config is not None:
            db.delete(config)
        elif config is not None and old_config is not None:
            (
                config.ativo,
                config.tipo_recompensa,
                config.taxa_conversao,
                config.valor_ponto_em_dinheiro,
            ) = old_config
        db.commit()
        db.close()


def test_relationship_metrics_ignore_rejected_and_cancelled_sales(char_setup):
    db = SessionLocal()
    customer_id = "customer-relationship-valid-only"
    try:
        customer = Cliente(
            id=customer_id,
            restaurante_id=CHAR_RESTAURANT_ID,
            telefone="11988881005",
            nome="Cliente Métricas",
            saldo_pontos=0,
            saldo_cashback=0,
        )
        db.add(customer)
        db.flush()

        db.add_all([
            Comanda(
                id="relationship-completed",
                restaurante_id=CHAR_RESTAURANT_ID,
                garcom_id="usr-char-admin",
                cliente_id=customer_id,
                numero_pedido=981005,
                tipo="Retirada",
                delivery_status="finalizado",
                fechada=True,
                valor_pago=50,
            ),
            Comanda(
                id="relationship-rejected",
                restaurante_id=CHAR_RESTAURANT_ID,
                garcom_id="usr-char-admin",
                cliente_id=customer_id,
                numero_pedido=981006,
                tipo="Retirada",
                delivery_status="recusado",
                fechada=True,
                valor_pago=80,
            ),
            Comanda(
                id="relationship-online-cancelled",
                restaurante_id=CHAR_RESTAURANT_ID,
                garcom_id="usr-char-admin",
                cliente_id=customer_id,
                numero_pedido=981007,
                tipo="Delivery",
                delivery_status="finalizado",
                online_payment_status="cancelled",
                fechada=True,
                valor_pago=90,
            ),
        ])
        db.commit()

        metrics = load_customer_relationship_metrics(
            db,
            restaurante_id=CHAR_RESTAURANT_ID,
            cliente_ids=[customer_id],
        )[customer_id]

        assert metrics.pedidos_concluidos == 1
        assert metrics.valor_pago_total == 50.0
        assert metrics.ticket_medio_pago == 50.0
        assert metrics.ultima_compra_em is not None
        assert metrics.segmento_relacionamento == "ATIVO"
    finally:
        db.close()

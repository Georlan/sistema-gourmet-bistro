import hashlib
import hmac
import time
from decimal import Decimal

from app.application.orders.commands import (
    CreateOrderCommand,
    CustomerInput,
    DeliveryInput,
    OrderItemInput,
)
from app.application.orders.service import OrderApplicationService
from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.domain.orders.types import FulfillmentType, OrderChannel
from app.models import (
    CaixaTurno,
    Categoria,
    Comanda,
    IntegrationOutbox,
    Item,
    Lancamento,
    OnlinePaymentIntent,
    Pagamento,
    Produto,
    Restaurante,
    RestaurantPaymentAccount,
    Usuario,
)
from app.services.online_payments.base import ProviderPayment
from app.services.online_payments.service import OnlinePaymentService
from app.services.online_payments.signature import verify_mercado_pago_signature


RESTAURANT_ID = 9917


def test_mercado_pago_signature_rejects_tamper_and_stale_timestamp():
    secret = "webhook-secret"
    request_id = "req-123"
    payment_id = "PAY-ABC"
    timestamp = str(int(time.time()))
    manifest = f"id:{payment_id.lower()};request-id:{request_id};ts:{timestamp};"
    digest = hmac.new(secret.encode(), manifest.encode(), hashlib.sha256).hexdigest()
    signature = f"ts={timestamp},v1={digest}"

    assert verify_mercado_pago_signature(
        signature_header=signature,
        request_id=request_id,
        data_id=payment_id,
        secret=secret,
    )
    assert not verify_mercado_pago_signature(
        signature_header=signature,
        request_id=request_id,
        data_id="outro-pagamento",
        secret=secret,
    )
    assert not verify_mercado_pago_signature(
        signature_header=f"ts={int(timestamp) - 600},v1={digest}",
        request_id=request_id,
        data_id=payment_id,
        secret=secret,
    )


def test_online_order_is_published_and_settled_only_after_provider_approval(monkeypatch):
    Base.metadata.create_all(bind=engine)
    token = current_restaurante_id.set(RESTAURANT_ID)
    db = SessionLocal()
    try:
        db.add(Restaurante(id=RESTAURANT_ID, nome="Gate Payment Test", plano="pro"))
        db.flush()
        db.add(Usuario(
            id="payment-gate-user",
            restaurante_id=RESTAURANT_ID,
            nome="Operador",
            email="operador-payment-gate@koma.test",
            senha_hash="unused",
            role="admin",
            cargo="admin",
            status="ativo",
        ))
        db.add(Categoria(id="payment-gate-category", restaurante_id=RESTAURANT_ID, nome="Teste"))
        db.flush()
        db.add(Produto(
            id="payment-gate-product",
            restaurante_id=RESTAURANT_ID,
            categoria_id="payment-gate-category",
            nome="Produto",
            preco=25,
            ativo=True,
        ))
        shift = CaixaTurno(
            restaurante_id=RESTAURANT_ID,
            aberto_por_id="payment-gate-user",
            saldo_inicial=0,
            status="aberto",
        )
        account = RestaurantPaymentAccount(
            id="payment-gate-account",
            restaurante_id=RESTAURANT_ID,
            provider="mercado_pago",
            provider_user_id="seller-9917",
            status="active",
        )
        account.access_token = "seller-access-token"
        account.webhook_secret = "webhook-secret"
        db.add_all([shift, account])
        db.commit()

        command = CreateOrderCommand(
            restaurant_id=RESTAURANT_ID,
            channel=OrderChannel.WEB_CARDAPIO,
            fulfillment=FulfillmentType.DELIVERY,
            items=(OrderItemInput(product_id="payment-gate-product", quantity=Decimal("1")),),
            customer=CustomerInput(name="Cliente Teste", phone="85999999999"),
            delivery=DeliveryInput(address="Rua Teste, 10"),
            payment_method="pix",
            idempotency_key="payment-gate-order-key",
            operator_user_id="payment-gate-user",
            defer_operational_publish=True,
        )
        dto = OrderApplicationService.create_order(db, command, commit=False)
        comanda = db.query(Comanda).filter(Comanda.id == dto.comanda_id).one()
        intent = OnlinePaymentService.create_intent_in_session(
            db,
            comanda=comanda,
            turno=shift,
            amount=dto.total,
            idempotency_key="payment-gate-order-key",
        )
        intent.external_payment_id = "mp-payment-9917"
        intent.status = "pending"
        db.commit()

        assert comanda.online_payment_status == "pending"
        assert db.query(IntegrationOutbox).filter(
            IntegrationOutbox.restaurante_id == RESTAURANT_ID,
            IntegrationOutbox.event_name == "koma.order.created",
        ).count() == 0
        assert db.query(Pagamento).filter(Pagamento.restaurante_id == RESTAURANT_ID).count() == 0

        class ApprovedProvider:
            def __init__(self, _access_token):
                pass

            def get_payment(self, external_payment_id):
                return ProviderPayment(
                    external_id=external_payment_id,
                    status="approved",
                    amount=Decimal(str(intent.amount)),
                    external_reference=intent.id,
                )

        monkeypatch.setattr(
            "app.services.online_payments.service.MercadoPagoProvider",
            ApprovedProvider,
        )
        settled, became_approved = OnlinePaymentService.reconcile_provider_payment(
            db,
            account=account,
            external_payment_id="mp-payment-9917",
        )

        assert became_approved is True
        assert settled is not None and settled.status == "approved"
        db.refresh(comanda)
        assert comanda.online_payment_status == "approved"
        assert comanda.valor_pago == intent.amount
        assert all(item.pago for item in comanda.itens)
        assert db.query(Pagamento).filter(Pagamento.restaurante_id == RESTAURANT_ID).count() == 1
        assert db.query(IntegrationOutbox).filter(
            IntegrationOutbox.restaurante_id == RESTAURANT_ID,
            IntegrationOutbox.event_name == "koma.order.created",
        ).count() == 1

        _, became_approved_again = OnlinePaymentService.reconcile_provider_payment(
            db,
            account=account,
            external_payment_id="mp-payment-9917",
        )
        assert became_approved_again is False
        assert db.query(Pagamento).filter(Pagamento.restaurante_id == RESTAURANT_ID).count() == 1
    finally:
        db.rollback()
        for model in (OnlinePaymentIntent, Pagamento, IntegrationOutbox, Item, Lancamento, Comanda, Produto, Categoria, CaixaTurno, RestaurantPaymentAccount, Usuario):
            db.query(model).filter(model.restaurante_id == RESTAURANT_ID).delete(synchronize_session=False)
        db.query(Restaurante).filter(Restaurante.id == RESTAURANT_ID).delete(synchronize_session=False)
        db.commit()
        db.close()
        current_restaurante_id.reset(token)

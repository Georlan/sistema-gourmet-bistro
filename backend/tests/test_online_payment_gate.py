import hashlib
import hmac
import time
from decimal import Decimal

import httpx
import pytest

from app.application.orders.commands import (
    CreateOrderCommand,
    CustomerInput,
    DeliveryInput,
    OrderItemInput,
)
from app.application.orders.service import OrderApplicationService
from app.config import settings
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
from app.services.online_payments.mercado_pago import MercadoPagoError, MercadoPagoProvider
from app.services.online_payments.service import OnlinePaymentService
from app.services.online_payments.signature import verify_mercado_pago_signature


RESTAURANT_ID = 9917
IMMEDIATE_APPROVAL_RESTAURANT_ID = 9918


def test_mercado_pago_payment_lookup_rejects_untrusted_url_parts():
    requested_urls: list[httpx.URL] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_urls.append(request.url)
        return httpx.Response(
            200,
            json={
                "id": 123,
                "status": "approved",
                "transaction_amount": 25,
                "external_reference": "order-123",
            },
        )

    provider = MercadoPagoProvider("test-token")
    provider._client = httpx.Client(
        base_url=provider.API_URL,
        transport=httpx.MockTransport(handler),
    )

    payment = provider.get_payment("000123")
    assert payment.external_id == "123"
    assert requested_urls == [httpx.URL("https://api.mercadopago.com/v1/payments/123")]

    for unsafe_id in ("//attacker.example/payment", "../123", "123?redirect=evil", "", "0"):
        with pytest.raises(MercadoPagoError, match="Identificador de pagamento inválido"):
            provider.get_payment(unsafe_id)

    assert len(requested_urls) == 1


def test_mercado_pago_create_pix_date_of_expiration_format():
    import datetime
    import json
    import re

    captured_requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured_requests.append(request)
        return httpx.Response(
            201,
            json={
                "id": 999888,
                "status": "pending",
                "transaction_amount": 48.0,
                "external_reference": "ref-exp-test",
                "date_of_expiration": "2026-09-02T03:40:00.000+00:00",
                "point_of_interaction": {
                    "transaction_data": {
                        "qr_code": "pix-code-123",
                        "qr_code_base64": "base64-qr",
                    }
                },
            },
        )

    provider = MercadoPagoProvider("test-token")
    provider._client = httpx.Client(
        base_url=provider.API_URL,
        transport=httpx.MockTransport(handler),
    )

    expires_at = datetime.datetime(2026, 9, 2, 3, 40, 0, tzinfo=datetime.timezone.utc)
    payment = provider.create_pix(
        amount=Decimal("48.00"),
        marketplace_fee=Decimal("0.00"),
        payer_email="cliente@example.com",
        external_reference="ref-exp-test",
        idempotency_key="idemp-exp-1",
        notification_url="https://api.example.com/notification",
        expires_at=expires_at,
    )

    assert payment.external_id == "999888"
    assert len(captured_requests) == 1
    payload = json.loads(captured_requests[0].content)
    assert payload["date_of_expiration"] == "2026-09-02T03:40:00.000+00:00"
    assert re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$", payload["date_of_expiration"])


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


def test_marketplace_fee_is_zero_until_plan_fees_are_explicitly_enabled(monkeypatch):
    monkeypatch.setattr(settings, "ONLINE_PAYMENT_PLAN_FEES_ENABLED", False)
    for plan in ("pocket", "pro", "premium", "gold"):
        assert OnlinePaymentService.marketplace_fee(Decimal("100.00"), plan) == Decimal("0.00")


def test_marketplace_fee_uses_exact_commercial_rate_for_stored_plan(monkeypatch):
    monkeypatch.setattr(settings, "ONLINE_PAYMENT_PLAN_FEES_ENABLED", True)
    amount = Decimal("100.00")

    assert OnlinePaymentService.marketplace_fee(amount, "pocket") == Decimal("1.49")
    assert OnlinePaymentService.marketplace_fee(amount, "pro") == Decimal("0.69")
    assert OnlinePaymentService.marketplace_fee(amount, "premium") == Decimal("0.29")
    assert OnlinePaymentService.marketplace_fee(amount, "gold") == Decimal("0.29")
    assert OnlinePaymentService.marketplace_fee(amount, "unknown") == Decimal("1.49")


def test_online_order_is_published_and_settled_only_after_provider_approval(monkeypatch):
    Base.metadata.create_all(bind=engine)
    token = current_restaurante_id.set(RESTAURANT_ID)
    db = SessionLocal()
    try:
        monkeypatch.setattr(settings, "ONLINE_PAYMENT_PLAN_FEES_ENABLED", False)
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
        assert Decimal(str(intent.marketplace_fee)) == Decimal("0.0")
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


def test_pix_creation_approved_immediately_applies_financial_effects_once(monkeypatch):
    Base.metadata.create_all(bind=engine)
    rid = IMMEDIATE_APPROVAL_RESTAURANT_ID
    token = current_restaurante_id.set(rid)
    db = SessionLocal()
    try:
        monkeypatch.setattr(settings, "ONLINE_PAYMENT_PLAN_FEES_ENABLED", False)
        db.add(Restaurante(id=rid, nome="Immediate Approval Test", plano="pro"))
        db.flush()
        db.add(Usuario(
            id="immediate-payment-user",
            restaurante_id=rid,
            nome="Operador",
            email="immediate-payment@koma.test",
            senha_hash="unused",
            role="admin",
            cargo="admin",
            status="ativo",
        ))
        db.add(Categoria(id="immediate-payment-category", restaurante_id=rid, nome="Teste"))
        db.flush()
        db.add(Produto(
            id="immediate-payment-product",
            restaurante_id=rid,
            categoria_id="immediate-payment-category",
            nome="Produto",
            preco=30,
            ativo=True,
        ))
        shift = CaixaTurno(
            restaurante_id=rid,
            aberto_por_id="immediate-payment-user",
            saldo_inicial=0,
            status="aberto",
        )
        account = RestaurantPaymentAccount(
            id="immediate-payment-account",
            restaurante_id=rid,
            provider="mercado_pago",
            provider_user_id="seller-9918",
            status="active",
        )
        account.access_token = "seller-access-token"
        account.webhook_secret = "webhook-secret"
        db.add_all([shift, account])
        db.commit()

        command = CreateOrderCommand(
            restaurant_id=rid,
            channel=OrderChannel.WEB_CARDAPIO,
            fulfillment=FulfillmentType.DELIVERY,
            items=(OrderItemInput(product_id="immediate-payment-product", quantity=Decimal("1")),),
            customer=CustomerInput(name="Cliente Imediato", phone="85988888888"),
            delivery=DeliveryInput(address="Rua Teste, 20"),
            payment_method="pix",
            idempotency_key="immediate-payment-order-key",
            operator_user_id="immediate-payment-user",
            defer_operational_publish=True,
        )
        dto = OrderApplicationService.create_order(db, command, commit=False)
        comanda = db.query(Comanda).filter(Comanda.id == dto.comanda_id).one()
        intent = OnlinePaymentService.create_intent_in_session(
            db,
            comanda=comanda,
            turno=shift,
            amount=dto.total,
            idempotency_key="immediate-payment-order-key",
        )
        db.commit()

        assert comanda.online_payment_status == "pending"
        assert db.query(Pagamento).filter(Pagamento.restaurante_id == rid).count() == 0
        assert db.query(IntegrationOutbox).filter(
            IntegrationOutbox.restaurante_id == rid,
            IntegrationOutbox.event_name == "koma.order.created",
        ).count() == 0

        class ImmediateApprovedProvider:
            def __init__(self, _access_token):
                pass

            def create_pix(self, **kwargs):
                return ProviderPayment(
                    external_id="mp-payment-9918",
                    status="approved",
                    amount=kwargs["amount"],
                    external_reference=kwargs["external_reference"],
                    qr_code="000201-immediate",
                )

            def get_payment(self, external_payment_id):
                return ProviderPayment(
                    external_id=external_payment_id,
                    status="approved",
                    amount=Decimal(str(intent.amount)),
                    external_reference=intent.id,
                )

        monkeypatch.setattr(
            "app.services.online_payments.service.MercadoPagoProvider",
            ImmediateApprovedProvider,
        )

        settled = OnlinePaymentService.ensure_pix_created(
            db,
            intent=intent,
            payer_email="cliente@koma.test",
            account=account,
        )

        assert settled.status == "approved"
        assert settled.external_payment_id == "mp-payment-9918"
        assert settled.pagamento_id is not None
        db.refresh(comanda)
        assert comanda.online_payment_status == "approved"
        assert comanda.valor_pago == intent.amount
        assert all(item.pago for item in comanda.itens)
        assert db.query(Pagamento).filter(Pagamento.restaurante_id == rid).count() == 1
        assert db.query(IntegrationOutbox).filter(
            IntegrationOutbox.restaurante_id == rid,
            IntegrationOutbox.event_name == "koma.order.created",
        ).count() == 1

        _, applied_again = OnlinePaymentService.reconcile_provider_payment(
            db,
            account=account,
            external_payment_id="mp-payment-9918",
        )
        assert applied_again is False
        assert db.query(Pagamento).filter(Pagamento.restaurante_id == rid).count() == 1
        assert db.query(IntegrationOutbox).filter(
            IntegrationOutbox.restaurante_id == rid,
            IntegrationOutbox.event_name == "koma.order.created",
        ).count() == 1
    finally:
        db.rollback()
        for model in (OnlinePaymentIntent, Pagamento, IntegrationOutbox, Item, Lancamento, Comanda, Produto, Categoria, CaixaTurno, RestaurantPaymentAccount, Usuario):
            db.query(model).filter(model.restaurante_id == rid).delete(synchronize_session=False)
        db.query(Restaurante).filter(Restaurante.id == rid).delete(synchronize_session=False)
        db.commit()
        db.close()
        current_restaurante_id.reset(token)


def _make_mercado_pago_signature(*, secret: str, request_id: str, data_id: str, ts: int | None = None) -> str:
    timestamp = str(int(time.time()) if ts is None else ts)
    manifest = f"id:{data_id.lower()};request-id:{request_id};ts:{timestamp};"
    v1 = hmac.new(secret.encode(), manifest.encode(), hashlib.sha256).hexdigest()
    return f"ts={timestamp},v1={v1}"


def test_mercado_pago_webhook_approved_integration_and_idempotency(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.models import OnlinePaymentWebhookEvent

    Base.metadata.create_all(bind=engine)
    rid = 9919
    token = current_restaurante_id.set(rid)
    db = SessionLocal()
    try:
        monkeypatch.setattr(settings, "ONLINE_PAYMENT_PLAN_FEES_ENABLED", True)
        db.add(Restaurante(id=rid, nome="Webhook Integration Test", plano="premium"))
        db.flush()
        db.add(Usuario(
            id="webhook-test-user-9919",
            restaurante_id=rid,
            nome="Operador",
            email="webhook-user-9919@koma.test",
            senha_hash="unused",
            role="admin",
            cargo="admin",
            status="ativo",
        ))
        db.add(Categoria(id="webhook-test-cat-9919", restaurante_id=rid, nome="Teste"))
        db.flush()
        db.add(Produto(
            id="webhook-test-prod-9919",
            restaurante_id=rid,
            categoria_id="webhook-test-cat-9919",
            nome="Pizza Especial",
            preco=48,
            ativo=True,
        ))
        shift = CaixaTurno(
            restaurante_id=rid,
            aberto_por_id="webhook-test-user-9919",
            saldo_inicial=0,
            status="aberto",
        )
        account = RestaurantPaymentAccount(
            id="account-webhook-9919",
            restaurante_id=rid,
            provider="mercado_pago",
            provider_user_id="seller-9919",
            status="active",
        )
        account.access_token = "seller-access-token-9919"
        account.webhook_secret = "webhook-secret-9919"
        db.add_all([shift, account])
        db.commit()

        command = CreateOrderCommand(
            restaurant_id=rid,
            channel=OrderChannel.WEB_CARDAPIO,
            fulfillment=FulfillmentType.PICKUP,
            items=(OrderItemInput(product_id="webhook-test-prod-9919", quantity=Decimal("1")),),
            customer=CustomerInput(name="Cliente Webhook", phone="85999998888"),
            payment_method="pix",
            idempotency_key="webhook-order-key-9919",
            operator_user_id="webhook-test-user-9919",
            defer_operational_publish=True,
        )
        dto = OrderApplicationService.create_order(db, command, commit=False)
        comanda = db.query(Comanda).filter(Comanda.id == dto.comanda_id).one()
        intent = OnlinePaymentService.create_intent_in_session(
            db,
            comanda=comanda,
            turno=shift,
            amount=dto.total,
            idempotency_key="webhook-order-key-9919",
        )
        assert Decimal(str(intent.marketplace_fee)) == Decimal("0.14")
        intent.external_payment_id = "mp-payment-9919"
        intent.status = "pending"
        db.commit()

        assert comanda.online_payment_status == "pending"
        assert comanda.valor_pago == 0.0
        assert db.query(Pagamento).filter(Pagamento.restaurante_id == rid).count() == 0
        assert db.query(IntegrationOutbox).filter(
            IntegrationOutbox.restaurante_id == rid,
            IntegrationOutbox.event_name == "koma.order.created",
        ).count() == 0

        class ApprovedProviderMock:
            def __init__(self, _access_token):
                pass

            def get_payment(self, external_payment_id):
                return ProviderPayment(
                    external_id=external_payment_id,
                    status="approved",
                    amount=Decimal("48.00"),
                    external_reference=intent.id,
                )

        monkeypatch.setattr(
            "app.services.online_payments.service.MercadoPagoProvider",
            ApprovedProviderMock,
        )

        client = TestClient(app)
        req_id_1 = "req-webhook-9919-1"
        payload_1 = {
            "type": "payment",
            "user_id": "seller-9919",
            "data": {"id": "mp-payment-9919"},
        }
        sig_1 = _make_mercado_pago_signature(
            secret="webhook-secret-9919",
            request_id=req_id_1,
            data_id="mp-payment-9919",
        )

        # 1. Primeira notificação via endpoint de aplicação
        resp_1 = client.post(
            "/payments/webhooks/mercado-pago",
            json=payload_1,
            headers={
                "x-request-id": req_id_1,
                "x-signature": sig_1,
            },
        )
        assert resp_1.status_code == 200
        assert resp_1.json() == {"status": "processed"}

        db.refresh(intent)
        db.refresh(comanda)
        assert intent.status == "approved"
        assert comanda.online_payment_status == "approved"
        assert comanda.valor_pago == 48.0
        assert all(item.pago for item in comanda.itens if item.status != "cancelado")

        pagamentos = db.query(Pagamento).filter(Pagamento.restaurante_id == rid).all()
        assert len(pagamentos) == 1
        assert pagamentos[0].status == "aprovado"
        assert pagamentos[0].valor == 48.0

        outbox = db.query(IntegrationOutbox).filter(
            IntegrationOutbox.restaurante_id == rid,
            IntegrationOutbox.event_name == "koma.order.created",
        ).all()
        assert len(outbox) == 1

        # 2. Replay exato (mesmo request_id) -> already_processed
        resp_replay_1 = client.post(
            "/payments/webhooks/mercado-pago",
            json=payload_1,
            headers={
                "x-request-id": req_id_1,
                "x-signature": sig_1,
            },
        )
        assert resp_replay_1.status_code == 200
        assert resp_replay_1.json() == {"status": "already_processed"}

        # 3. Notificação com novo request_id para o mesmo pagamento -> processamento idempotente
        req_id_2 = "req-webhook-9919-2"
        sig_2 = _make_mercado_pago_signature(
            secret="webhook-secret-9919",
            request_id=req_id_2,
            data_id="mp-payment-9919",
        )
        resp_replay_2 = client.post(
            "/payments/webhooks/mercado-pago",
            json=payload_1,
            headers={
                "x-request-id": req_id_2,
                "x-signature": sig_2,
            },
        )
        assert resp_replay_2.status_code == 200
        assert resp_replay_2.json() == {"status": "processed"}

        # 4. Notificação no endpoint direto com account_id
        req_id_3 = "req-webhook-9919-3"
        sig_3 = _make_mercado_pago_signature(
            secret="webhook-secret-9919",
            request_id=req_id_3,
            data_id="mp-payment-9919",
        )
        resp_account_endpoint = client.post(
            "/payments/webhooks/mercado-pago/account-webhook-9919",
            json=payload_1,
            headers={
                "x-request-id": req_id_3,
                "x-signature": sig_3,
            },
        )
        assert resp_account_endpoint.status_code == 200
        assert resp_account_endpoint.json() == {"status": "processed"}

        # 5. Validação rigorosa de idempotência: nenhum efeito duplicado
        db.refresh(intent)
        db.refresh(comanda)
        assert intent.status == "approved"
        assert comanda.online_payment_status == "approved"
        assert comanda.valor_pago == 48.0
        assert all(item.pago for item in comanda.itens if item.status != "cancelado")
        assert db.query(Pagamento).filter(Pagamento.restaurante_id == rid).count() == 1
        assert db.query(IntegrationOutbox).filter(
            IntegrationOutbox.restaurante_id == rid,
            IntegrationOutbox.event_name == "koma.order.created",
        ).count() == 1
    finally:
        db.rollback()
        for model in (OnlinePaymentWebhookEvent, OnlinePaymentIntent, Pagamento, IntegrationOutbox, Item, Lancamento, Comanda, Produto, Categoria, CaixaTurno, RestaurantPaymentAccount, Usuario):
            db.query(model).filter(model.restaurante_id == rid).delete(synchronize_session=False)
        db.query(Restaurante).filter(Restaurante.id == rid).delete(synchronize_session=False)
        db.commit()
        db.close()
        current_restaurante_id.reset(token)


def test_mercado_pago_webhook_rejects_divergent_amount_or_reference(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.models import OnlinePaymentWebhookEvent

    Base.metadata.create_all(bind=engine)
    rid = 9920
    token = current_restaurante_id.set(rid)
    db = SessionLocal()
    try:
        monkeypatch.setattr(settings, "ONLINE_PAYMENT_PLAN_FEES_ENABLED", True)
        db.add(Restaurante(id=rid, nome="Webhook Divergence Test", plano="premium"))
        db.flush()
        db.add(Usuario(
            id="webhook-user-9920",
            restaurante_id=rid,
            nome="Operador",
            email="webhook-user-9920@koma.test",
            senha_hash="unused",
            role="admin",
            cargo="admin",
            status="ativo",
        ))
        db.add(Categoria(id="webhook-cat-9920", restaurante_id=rid, nome="Teste"))
        db.flush()
        db.add(Produto(
            id="webhook-prod-9920",
            restaurante_id=rid,
            categoria_id="webhook-cat-9920",
            nome="Pizza Divergência",
            preco=48,
            ativo=True,
        ))
        shift = CaixaTurno(
            restaurante_id=rid,
            aberto_por_id="webhook-user-9920",
            saldo_inicial=0,
            status="aberto",
        )
        account = RestaurantPaymentAccount(
            id="account-webhook-9920",
            restaurante_id=rid,
            provider="mercado_pago",
            provider_user_id="seller-9920",
            status="active",
        )
        account.access_token = "seller-access-token-9920"
        account.webhook_secret = "webhook-secret-9920"
        db.add_all([shift, account])
        db.commit()

        command = CreateOrderCommand(
            restaurant_id=rid,
            channel=OrderChannel.WEB_CARDAPIO,
            fulfillment=FulfillmentType.DELIVERY,
            items=(OrderItemInput(product_id="webhook-prod-9920", quantity=Decimal("1")),),
            customer=CustomerInput(name="Cliente Divergente", phone="85999997777"),
            delivery=DeliveryInput(address="Rua Divergente, 200"),
            payment_method="pix",
            idempotency_key="webhook-order-key-9920",
            operator_user_id="webhook-user-9920",
            defer_operational_publish=True,
        )
        dto = OrderApplicationService.create_order(db, command, commit=False)
        comanda = db.query(Comanda).filter(Comanda.id == dto.comanda_id).one()
        intent = OnlinePaymentService.create_intent_in_session(
            db,
            comanda=comanda,
            turno=shift,
            amount=dto.total,
            idempotency_key="webhook-order-key-9920",
        )
        intent.external_payment_id = "mp-payment-9920"
        intent.status = "pending"
        db.commit()

        # Cenário 1: Valor retornado pelo Mercado Pago diverge (ex: R$ 50,00 em vez de R$ 48,00)
        class DivergentAmountProviderMock:
            def __init__(self, _access_token):
                pass

            def get_payment(self, external_payment_id):
                return ProviderPayment(
                    external_id=external_payment_id,
                    status="approved",
                    amount=Decimal("50.00"),
                    external_reference=intent.id,
                )

        monkeypatch.setattr(
            "app.services.online_payments.service.MercadoPagoProvider",
            DivergentAmountProviderMock,
        )

        client = TestClient(app)
        req_id_div_1 = "req-webhook-div-1"
        sig_div_1 = _make_mercado_pago_signature(
            secret="webhook-secret-9920",
            request_id=req_id_div_1,
            data_id="mp-payment-9920",
        )
        resp_div_1 = client.post(
            "/payments/webhooks/mercado-pago",
            json={
                "type": "payment",
                "user_id": "seller-9920",
                "data": {"id": "mp-payment-9920"},
            },
            headers={
                "x-request-id": req_id_div_1,
                "x-signature": sig_div_1,
            },
        )
        assert resp_div_1.status_code == 409
        assert "Pagamento não corresponde ao pedido" in resp_div_1.json()["detail"]

        # Verifica que nenhum efeito financeiro foi gerado
        db.refresh(intent)
        db.refresh(comanda)
        assert intent.status == "pending"
        assert comanda.online_payment_status == "pending"
        assert comanda.valor_pago == 0.0
        assert db.query(Pagamento).filter(Pagamento.restaurante_id == rid).count() == 0
        assert db.query(IntegrationOutbox).filter(
            IntegrationOutbox.restaurante_id == rid,
            IntegrationOutbox.event_name == "koma.order.created",
        ).count() == 0

        # Cenário 2: External reference diverge da intent registrada
        class DivergentRefProviderMock:
            def __init__(self, _access_token):
                pass

            def get_payment(self, external_payment_id):
                return ProviderPayment(
                    external_id=external_payment_id,
                    status="approved",
                    amount=Decimal("48.00"),
                    external_reference="wrong-intent-uuid",
                )

        monkeypatch.setattr(
            "app.services.online_payments.service.MercadoPagoProvider",
            DivergentRefProviderMock,
        )

        req_id_div_2 = "req-webhook-div-2"
        sig_div_2 = _make_mercado_pago_signature(
            secret="webhook-secret-9920",
            request_id=req_id_div_2,
            data_id="mp-payment-9920",
        )
        resp_div_2 = client.post(
            "/payments/webhooks/mercado-pago",
            json={
                "type": "payment",
                "user_id": "seller-9920",
                "data": {"id": "mp-payment-9920"},
            },
            headers={
                "x-request-id": req_id_div_2,
                "x-signature": sig_div_2,
            },
        )
        assert resp_div_2.status_code == 409
        assert "Pagamento não corresponde ao pedido" in resp_div_2.json()["detail"]

        # Valida que continua sem efeitos financeiros e evento foi gravado como failed
        db.refresh(intent)
        db.refresh(comanda)
        assert intent.status == "pending"
        assert comanda.online_payment_status == "pending"
        assert comanda.valor_pago == 0.0
        assert db.query(Pagamento).filter(Pagamento.restaurante_id == rid).count() == 0
        assert db.query(IntegrationOutbox).filter(
            IntegrationOutbox.restaurante_id == rid,
            IntegrationOutbox.event_name == "koma.order.created",
        ).count() == 0
    finally:
        db.rollback()
        for model in (OnlinePaymentWebhookEvent, OnlinePaymentIntent, Pagamento, IntegrationOutbox, Item, Lancamento, Comanda, Produto, Categoria, CaixaTurno, RestaurantPaymentAccount, Usuario):
            db.query(model).filter(model.restaurante_id == rid).delete(synchronize_session=False)
        db.query(Restaurante).filter(Restaurante.id == rid).delete(synchronize_session=False)
        db.commit()
        db.close()
        current_restaurante_id.reset(token)

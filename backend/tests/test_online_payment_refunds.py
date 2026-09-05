from __future__ import annotations

import json
from decimal import Decimal

import httpx
import pytest

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.financial_models import PagamentoAlocacao, PagamentoEstorno
from app.financial_refund_models import PagamentoEstornoAlocacao, PagamentoEstornoLiquidacao
from app.models import (
    CaixaTurno,
    Comanda,
    OnlinePaymentIntent,
    Pagamento,
    Restaurante,
    RestaurantPaymentAccount,
    Usuario,
)
from app.online_payment_refund_models import OnlinePaymentRefund
from app.routes.online_payments import _resolve_mercado_pago_account_id_by_payment
from app.services.cash_reconciliation import RefundDomainError
from app.services.online_payments.base import ProviderRefund
from app.services.online_payments.mercado_pago import MercadoPagoProvider
from app.services.refund_guard import create_refund_guarded


RESTAURANT_ID = 9931


@pytest.fixture
def online_refund_db():
    Base.metadata.create_all(bind=engine)
    ctx = current_restaurante_id.set(RESTAURANT_ID)
    db = SessionLocal()
    try:
        db.add(Restaurante(id=RESTAURANT_ID, nome="Refund Test", plano="pro"))
        db.flush()
        user = Usuario(
            id="refund-user",
            restaurante_id=RESTAURANT_ID,
            nome="Operador",
            email="refund-test@example.invalid",
            senha_hash="unused",
            role="admin",
            cargo="admin",
            status="ativo",
        )
        db.add(user)
        db.flush()
        command = Comanda(
            id="refund-command",
            restaurante_id=RESTAURANT_ID,
            garcom_id=user.id,
            numero_pedido=9931,
            tipo="Delivery",
            online_payment_status="approved",
            valor_pago=100,
        )
        db.add(command)
        shift = CaixaTurno(
            restaurante_id=RESTAURANT_ID,
            aberto_por_id=user.id,
            saldo_inicial=0,
            status="aberto",
        )
        db.add(shift)
        db.flush()
        payment = Pagamento(
            id="refund-payment",
            restaurante_id=RESTAURANT_ID,
            comanda_id=command.id,
            turno_id=shift.id,
            valor=100,
            metodo="pix",
            status="aprovado",
            idempotency_key="online-payment-777001",
        )
        db.add(payment)
        account = RestaurantPaymentAccount(
            id="refund-account",
            restaurante_id=RESTAURANT_ID,
            provider="mercado_pago",
            provider_user_id="seller-9931",
            status="active",
        )
        account.access_token = "test"
        account.webhook_secret = "test"
        db.add(account)
        db.add(OnlinePaymentIntent(
            id="refund-intent",
            restaurante_id=RESTAURANT_ID,
            comanda_id=command.id,
            turno_id=shift.id,
            pagamento_id=payment.id,
            provider="mercado_pago",
            method="pix",
            status="approved",
            amount=100,
            marketplace_fee=0.69,
            idempotency_key="refund-order-key",
            external_payment_id="777001",
        ))
        db.commit()
        yield db, payment, shift
    finally:
        db.rollback()
        for model in (
            OnlinePaymentRefund,
            PagamentoEstornoAlocacao,
            PagamentoEstornoLiquidacao,
            PagamentoEstorno,
            PagamentoAlocacao,
            OnlinePaymentIntent,
            Pagamento,
            Comanda,
            CaixaTurno,
            RestaurantPaymentAccount,
            Usuario,
        ):
            db.query(model).filter(model.restaurante_id == RESTAURANT_ID).delete(synchronize_session=False)
        db.query(Restaurante).filter(Restaurante.id == RESTAURANT_ID).delete(synchronize_session=False)
        db.commit()
        db.close()
        current_restaurante_id.reset(ctx)


def test_mercado_pago_refund_endpoint_uses_idempotency_and_total_body():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(201, json={
            "id": 991122,
            "payment_id": 777001,
            "amount": 100,
            "status": "approved",
        })

    provider = MercadoPagoProvider("test")
    provider._client = httpx.Client(base_url=provider.API_URL, transport=httpx.MockTransport(handler))
    refund = provider.refund_payment(
        "000777001",
        amount=None,
        idempotency_key="koma-refund-test-total",
    )

    assert refund.external_id == "991122"
    assert refund.payment_id == "777001"
    assert requests[0].url == httpx.URL("https://api.mercadopago.com/v1/payments/777001/refunds")
    assert requests[0].headers["X-Idempotency-Key"] == "koma-refund-test-total"
    assert json.loads(requests[0].content) == {}


def test_provider_confirmed_refund_materializes_local_ledger_once(monkeypatch, online_refund_db):
    db, payment, shift = online_refund_db
    calls: list[dict] = []

    class ApprovedProvider:
        def __init__(self, access_token):
            assert access_token == "test"

        def refund_payment(self, external_payment_id, *, amount, idempotency_key):
            calls.append({"payment_id": external_payment_id, "amount": amount, "key": idempotency_key})
            return ProviderRefund(
                external_id="880001",
                payment_id=external_payment_id,
                status="approved",
                amount=Decimal("40.00"),
            )

    monkeypatch.setattr("app.services.online_payments.refunds.MercadoPagoProvider", ApprovedProvider)

    refund = create_refund_guarded(
        db,
        restaurante_id=RESTAURANT_ID,
        payment_id=payment.id,
        turno_id=shift.id,
        usuario_id="refund-user",
        valor=Decimal("40.00"),
        motivo="Cliente pediu devolucao parcial",
        idempotency_key="refund-partial-001",
        metodo_devolucao="pix",
    )
    db.commit()

    persisted = db.query(OnlinePaymentRefund).filter(
        OnlinePaymentRefund.restaurante_id == RESTAURANT_ID,
        OnlinePaymentRefund.idempotency_key == "refund-partial-001",
    ).one()
    assert persisted.status == "confirmed"
    assert persisted.external_refund_id == "880001"
    assert persisted.estorno_id == refund.id
    assert len(calls[0]["key"]) <= 64

    retry = create_refund_guarded(
        db,
        restaurante_id=RESTAURANT_ID,
        payment_id=payment.id,
        turno_id=shift.id,
        usuario_id="refund-user",
        valor=Decimal("40.00"),
        motivo="Cliente pediu devolucao parcial",
        idempotency_key="refund-partial-001",
        metodo_devolucao="pix",
    )
    db.commit()
    assert retry.id == refund.id
    assert len(calls) == 1


def test_timeout_reserves_value_and_same_key_reconciles(monkeypatch, online_refund_db):
    db, payment, shift = online_refund_db
    first_keys: list[str] = []

    class TimeoutProvider:
        def __init__(self, _access_token):
            pass

        def refund_payment(self, external_payment_id, *, amount, idempotency_key):
            first_keys.append(idempotency_key)
            request = httpx.Request("POST", "https://example.invalid/refund")
            raise httpx.ReadTimeout("timeout", request=request)

    monkeypatch.setattr("app.services.online_payments.refunds.MercadoPagoProvider", TimeoutProvider)

    with pytest.raises(RefundDomainError) as exc_info:
        create_refund_guarded(
            db,
            restaurante_id=RESTAURANT_ID,
            payment_id=payment.id,
            turno_id=shift.id,
            usuario_id="refund-user",
            valor=Decimal("80.00"),
            motivo="Timeout de teste com reserva",
            idempotency_key="refund-timeout-001",
            metodo_devolucao="pix",
        )
    assert exc_info.value.status_code == 503
    reserved = db.query(OnlinePaymentRefund).filter(
        OnlinePaymentRefund.restaurante_id == RESTAURANT_ID,
        OnlinePaymentRefund.idempotency_key == "refund-timeout-001",
    ).one()
    assert reserved.status == "requested"
    assert reserved.estorno_id is None

    with pytest.raises(RefundDomainError, match="R\\$ 20.00"):
        create_refund_guarded(
            db,
            restaurante_id=RESTAURANT_ID,
            payment_id=payment.id,
            turno_id=shift.id,
            usuario_id="refund-user",
            valor=Decimal("30.00"),
            motivo="Tentativa concorrente bloqueada",
            idempotency_key="refund-other-001",
            metodo_devolucao="pix",
        )
    db.rollback()

    retry_keys: list[str] = []

    class ApprovedAfterTimeoutProvider:
        def __init__(self, _access_token):
            pass

        def refund_payment(self, external_payment_id, *, amount, idempotency_key):
            retry_keys.append(idempotency_key)
            return ProviderRefund(
                external_id="880002",
                payment_id=external_payment_id,
                status="approved",
                amount=Decimal("80.00"),
            )

    monkeypatch.setattr("app.services.online_payments.refunds.MercadoPagoProvider", ApprovedAfterTimeoutProvider)
    refund = create_refund_guarded(
        db,
        restaurante_id=RESTAURANT_ID,
        payment_id=payment.id,
        turno_id=shift.id,
        usuario_id="refund-user",
        valor=Decimal("80.00"),
        motivo="Timeout de teste com reserva",
        idempotency_key="refund-timeout-001",
        metodo_devolucao="pix",
    )
    db.commit()

    assert first_keys == retry_keys
    assert Decimal(str(refund.valor)) == Decimal("80.00")


def test_full_refund_omits_amount_and_webhook_resolves_known_payment(monkeypatch, online_refund_db):
    db, payment, shift = online_refund_db
    amounts: list[Decimal | None] = []

    class FullProvider:
        def __init__(self, _access_token):
            pass

        def refund_payment(self, external_payment_id, *, amount, idempotency_key):
            amounts.append(amount)
            return ProviderRefund(
                external_id="880003",
                payment_id=external_payment_id,
                status="approved",
                amount=Decimal("100.00"),
            )

    monkeypatch.setattr("app.services.online_payments.refunds.MercadoPagoProvider", FullProvider)
    create_refund_guarded(
        db,
        restaurante_id=RESTAURANT_ID,
        payment_id=payment.id,
        turno_id=shift.id,
        usuario_id="refund-user",
        valor=Decimal("100.00"),
        motivo="Cancelamento total do pedido",
        idempotency_key="refund-total-001",
        metodo_devolucao="pix",
    )
    db.commit()

    assert amounts == [None]
    assert _resolve_mercado_pago_account_id_by_payment(db, "777001") == "refund-account"

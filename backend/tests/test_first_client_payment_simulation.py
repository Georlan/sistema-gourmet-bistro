"""Gate financeiro do primeiro cliente por simulação determinística.

Este arquivo não movimenta dinheiro nem chama a internet. Ele usa o provider real
`MercadoPagoProvider` sobre `httpx.MockTransport`, de modo que o KÔMA percorre o
mesmo contrato HTTP de criação Pix, consulta e refund que usará em produção.

O objetivo é aceitar, por decisão explícita do proprietário, uma homologação por
simulação quando não há outra conta/pagador disponível para repetir um refund real.
O teste é executado tanto na suíte canônica quanto no PostgreSQL 17 efêmero do CI.
"""

from __future__ import annotations

import json
import os
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
from app.financial_models import PagamentoAlocacao, PagamentoEstorno
from app.financial_refund_models import PagamentoEstornoAlocacao, PagamentoEstornoLiquidacao
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
from app.online_payment_refund_models import OnlinePaymentRefund
from app.services.cash_reconciliation import RefundDomainError
from app.services.online_payments.mercado_pago import MercadoPagoProvider
from app.services.online_payments.service import OnlinePaymentService
from app.services.refund_guard import create_refund_guarded


SUCCESS_RESTAURANT_ID = 8841
REFUSAL_RESTAURANT_ID = 8842
PAYMENT_EXTERNAL_ID = "990001"
REFUND_EXTERNAL_ID = "880001"
ORDER_TOTAL = Decimal("100.00")
EXPECTED_PRO_FEE = Decimal("0.69")


def _external_postgres() -> bool:
    return os.getenv("KOMA_PYTEST_USE_EXTERNAL_DATABASE", "false").lower() == "true"


def _session(restaurante_id: int):
    if not _external_postgres():
        Base.metadata.create_all(bind=engine)
    return (
        SessionLocal(restaurante_id=restaurante_id)
        if _external_postgres()
        else SessionLocal()
    )


def _cleanup(db, restaurante_id: int) -> None:
    # Ordem explícita para respeitar FKs também no PostgreSQL real.
    for model in (
        OnlinePaymentRefund,
        PagamentoEstornoAlocacao,
        PagamentoEstornoLiquidacao,
        PagamentoEstorno,
        PagamentoAlocacao,
        OnlinePaymentIntent,
        Pagamento,
        IntegrationOutbox,
        Item,
        Lancamento,
        Comanda,
        Produto,
        Categoria,
        CaixaTurno,
        RestaurantPaymentAccount,
        Usuario,
    ):
        db.query(model).filter(model.restaurante_id == restaurante_id).delete(
            synchronize_session=False
        )
    db.query(Restaurante).filter(Restaurante.id == restaurante_id).delete(
        synchronize_session=False
    )
    db.commit()


def _seed_online_order(db, restaurante_id: int):
    user_id = f"first-client-user-{restaurante_id}"
    category_id = f"first-client-category-{restaurante_id}"
    product_id = f"first-client-product-{restaurante_id}"
    account_id = f"first-client-account-{restaurante_id}"

    db.add(Restaurante(id=restaurante_id, nome="First Client Payment Simulation", plano="pro"))
    db.flush()
    db.add(
        Usuario(
            id=user_id,
            restaurante_id=restaurante_id,
            nome="Operador Simulação",
            email=f"first-client-{restaurante_id}@koma.test",
            senha_hash="unused",
            role="admin",
            cargo="admin",
            status="ativo",
        )
    )
    db.add(Categoria(id=category_id, restaurante_id=restaurante_id, nome="Simulação"))
    db.flush()
    db.add(
        Produto(
            id=product_id,
            restaurante_id=restaurante_id,
            categoria_id=category_id,
            nome="Pedido simulado R$ 100",
            preco=float(ORDER_TOTAL),
            ativo=True,
        )
    )
    shift = CaixaTurno(
        restaurante_id=restaurante_id,
        aberto_por_id=user_id,
        saldo_inicial=0,
        status="aberto",
    )
    account = RestaurantPaymentAccount(
        id=account_id,
        restaurante_id=restaurante_id,
        provider="mercado_pago",
        provider_user_id=f"seller-{restaurante_id}",
        status="active",
    )
    account.access_token = "simulated-seller-access-token"
    account.webhook_secret = "simulated-webhook-secret"
    db.add_all([shift, account])
    db.commit()

    command = CreateOrderCommand(
        restaurant_id=restaurante_id,
        channel=OrderChannel.WEB_CARDAPIO,
        fulfillment=FulfillmentType.DELIVERY,
        items=(OrderItemInput(product_id=product_id, quantity=Decimal("1")),),
        customer=CustomerInput(name="Cliente Simulado", phone="85999999999"),
        delivery=DeliveryInput(address="Rua da Simulação, 100"),
        payment_method="pix",
        idempotency_key=f"first-client-order-{restaurante_id}",
        operator_user_id=user_id,
        defer_operational_publish=True,
    )
    dto = OrderApplicationService.create_order(db, command, commit=False)
    assert Decimal(str(dto.total)) == ORDER_TOTAL
    comanda = db.query(Comanda).filter(Comanda.id == dto.comanda_id).one()
    intent = OnlinePaymentService.create_intent_in_session(
        db,
        comanda=comanda,
        turno=shift,
        amount=dto.total,
        idempotency_key=f"first-client-order-{restaurante_id}",
    )
    db.commit()
    return user_id, account, shift, comanda, intent


def _simulated_provider(monkeypatch, *, reject_refund: bool = False):
    state: dict[str, object] = {
        "external_reference": None,
        "requests": [],
        "reject_refund": reject_refund,
    }

    def handler(request: httpx.Request) -> httpx.Response:
        requests = state["requests"]
        assert isinstance(requests, list)
        requests.append(request)

        if request.method == "POST" and request.url.path == "/v1/payments":
            payload = json.loads(request.content)
            state["external_reference"] = payload["external_reference"]
            return httpx.Response(
                201,
                json={
                    "id": int(PAYMENT_EXTERNAL_ID),
                    "status": "pending",
                    "transaction_amount": payload["transaction_amount"],
                    "external_reference": payload["external_reference"],
                    "date_of_expiration": payload["date_of_expiration"],
                    "point_of_interaction": {
                        "transaction_data": {
                            "qr_code": "000201-first-client-simulation",
                            "qr_code_base64": "simulated-base64-qr",
                            "ticket_url": "https://example.invalid/pix-ticket",
                        }
                    },
                },
            )

        if request.method == "GET" and request.url.path == f"/v1/payments/{PAYMENT_EXTERNAL_ID}":
            return httpx.Response(
                200,
                json={
                    "id": int(PAYMENT_EXTERNAL_ID),
                    "status": "approved",
                    "transaction_amount": float(ORDER_TOTAL),
                    "external_reference": state["external_reference"],
                },
            )

        if request.method == "POST" and request.url.path == f"/v1/payments/{PAYMENT_EXTERNAL_ID}/refunds":
            if state["reject_refund"]:
                return httpx.Response(
                    400,
                    json={"message": "seller_insufficient_balance"},
                )
            return httpx.Response(
                201,
                json={
                    "id": int(REFUND_EXTERNAL_ID),
                    "payment_id": int(PAYMENT_EXTERNAL_ID),
                    "amount": float(ORDER_TOTAL),
                    "status": "approved",
                },
            )

        raise AssertionError(f"Requisição inesperada na simulação: {request.method} {request.url}")

    transport = httpx.MockTransport(handler)

    def provider_factory(access_token: str):
        provider = MercadoPagoProvider(access_token)
        provider._client.close()
        provider._client = httpx.Client(
            base_url=provider.API_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            transport=transport,
        )
        return provider

    monkeypatch.setattr(
        "app.services.online_payments.service.MercadoPagoProvider",
        provider_factory,
    )
    monkeypatch.setattr(
        "app.services.online_payments.refunds.MercadoPagoProvider",
        provider_factory,
    )
    return state


def _requests_by(state: dict[str, object], method: str, path: str) -> list[httpx.Request]:
    requests = state["requests"]
    assert isinstance(requests, list)
    return [req for req in requests if req.method == method and req.url.path == path]


def test_first_client_split_payment_and_full_refund_simulation(monkeypatch):
    """Simula pedido -> Pix Split -> aprovação -> refund total -> retry idempotente."""
    restaurante_id = SUCCESS_RESTAURANT_ID
    tenant_token = current_restaurante_id.set(restaurante_id)
    db = _session(restaurante_id)
    try:
        _cleanup(db, restaurante_id)
        monkeypatch.setattr(settings, "ONLINE_PAYMENT_PLAN_FEES_ENABLED", True)
        monkeypatch.setattr(settings, "KOMA_PUBLIC_API_URL", "https://api.koma.test")
        state = _simulated_provider(monkeypatch)

        user_id, account, shift, comanda, intent = _seed_online_order(db, restaurante_id)
        assert Decimal(str(intent.marketplace_fee)) == EXPECTED_PRO_FEE
        assert comanda.online_payment_status == "pending"

        created = OnlinePaymentService.ensure_pix_created(
            db,
            intent=intent,
            payer_email="cliente.simulado@example.invalid",
            account=account,
        )
        assert created.status == "pending"
        assert created.external_payment_id == PAYMENT_EXTERNAL_ID
        assert created.qr_code == "000201-first-client-simulation"
        assert db.query(Pagamento).filter(Pagamento.restaurante_id == restaurante_id).count() == 0

        create_requests = _requests_by(state, "POST", "/v1/payments")
        assert len(create_requests) == 1
        create_payload = json.loads(create_requests[0].content)
        assert Decimal(str(create_payload["transaction_amount"])) == ORDER_TOTAL
        assert Decimal(str(create_payload["application_fee"])) == EXPECTED_PRO_FEE
        assert create_payload["description"] == "Pedido KOMA"
        assert create_payload["payment_method_id"] == "pix"
        assert create_payload["external_reference"] == intent.id
        assert create_payload["notification_url"].endswith(
            f"/payments/webhooks/mercado-pago/{account.id}"
        )
        assert create_requests[0].headers["X-Idempotency-Key"] == f"koma-online-{intent.id}"
        assert create_requests[0].headers["Authorization"] == "Bearer simulated-seller-access-token"

        settled, first_approval = OnlinePaymentService.reconcile_provider_payment(
            db,
            account=account,
            external_payment_id=PAYMENT_EXTERNAL_ID,
        )
        assert first_approval is True
        assert settled is not None and settled.status == "approved"
        db.refresh(comanda)
        assert comanda.online_payment_status == "approved"
        assert Decimal(str(comanda.valor_pago)) == ORDER_TOTAL
        assert all(item.pago for item in comanda.itens)

        pagamentos = db.query(Pagamento).filter(
            Pagamento.restaurante_id == restaurante_id
        ).all()
        assert len(pagamentos) == 1
        payment = pagamentos[0]
        assert payment.status == "aprovado"
        assert Decimal(str(payment.valor)) == ORDER_TOTAL
        assert payment.idempotency_key == f"online:mercado_pago:{PAYMENT_EXTERNAL_ID}"
        assert db.query(IntegrationOutbox).filter(
            IntegrationOutbox.restaurante_id == restaurante_id,
            IntegrationOutbox.event_name == "koma.order.created",
        ).count() == 1

        _, second_approval = OnlinePaymentService.reconcile_provider_payment(
            db,
            account=account,
            external_payment_id=PAYMENT_EXTERNAL_ID,
        )
        assert second_approval is False
        assert db.query(Pagamento).filter(
            Pagamento.restaurante_id == restaurante_id
        ).count() == 1
        assert db.query(IntegrationOutbox).filter(
            IntegrationOutbox.restaurante_id == restaurante_id,
            IntegrationOutbox.event_name == "koma.order.created",
        ).count() == 1

        refund_key = "first-client-refund-full-001"
        refund = create_refund_guarded(
            db,
            restaurante_id=restaurante_id,
            payment_id=payment.id,
            turno_id=shift.id,
            usuario_id=user_id,
            valor=ORDER_TOTAL,
            motivo="Simulação de devolução total do primeiro cliente",
            idempotency_key=refund_key,
            metodo_devolucao="pix",
        )
        db.commit()

        refund_requests = _requests_by(
            state,
            "POST",
            f"/v1/payments/{PAYMENT_EXTERNAL_ID}/refunds",
        )
        assert len(refund_requests) == 1
        # Refund total: contrato oficial exige omitir `amount` e o provider real
        # traduz isso em uma requisição sem corpo.
        assert refund_requests[0].content == b""
        provider_key = refund_requests[0].headers["X-Idempotency-Key"]
        assert provider_key.startswith("koma-refund-")
        assert len(provider_key) <= 64

        remote_refund = db.query(OnlinePaymentRefund).filter(
            OnlinePaymentRefund.restaurante_id == restaurante_id,
            OnlinePaymentRefund.pagamento_id == payment.id,
        ).one()
        assert remote_refund.status == "confirmed"
        assert remote_refund.provider_status == "approved"
        assert remote_refund.external_payment_id == PAYMENT_EXTERNAL_ID
        assert remote_refund.external_refund_id == REFUND_EXTERNAL_ID
        assert remote_refund.estorno_id == refund.id

        local_refunds = db.query(PagamentoEstorno).filter(
            PagamentoEstorno.restaurante_id == restaurante_id,
            PagamentoEstorno.pagamento_id == payment.id,
        ).all()
        assert len(local_refunds) == 1
        assert Decimal(str(local_refunds[0].valor)) == ORDER_TOTAL
        liquidations = db.query(PagamentoEstornoLiquidacao).filter(
            PagamentoEstornoLiquidacao.restaurante_id == restaurante_id,
            PagamentoEstornoLiquidacao.estorno_id == refund.id,
        ).all()
        assert len(liquidations) == 1
        assert liquidations[0].metodo_devolucao == "pix"

        # O fato original de aprovação não é reescrito; a reversão vive no ledger.
        db.refresh(payment)
        db.refresh(settled)
        assert payment.status == "aprovado"
        assert settled.status == "approved"

        retry = create_refund_guarded(
            db,
            restaurante_id=restaurante_id,
            payment_id=payment.id,
            turno_id=shift.id,
            usuario_id=user_id,
            valor=ORDER_TOTAL,
            motivo="Simulação de devolução total do primeiro cliente",
            idempotency_key=refund_key,
            metodo_devolucao="pix",
        )
        db.commit()
        assert retry.id == refund.id
        assert len(_requests_by(
            state,
            "POST",
            f"/v1/payments/{PAYMENT_EXTERNAL_ID}/refunds",
        )) == 1
        assert db.query(PagamentoEstorno).filter(
            PagamentoEstorno.restaurante_id == restaurante_id,
            PagamentoEstorno.pagamento_id == payment.id,
        ).count() == 1
    finally:
        db.rollback()
        _cleanup(db, restaurante_id)
        db.close()
        current_restaurante_id.reset(tenant_token)


def test_first_client_refund_refusal_never_materializes_local_estorno(monkeypatch):
    """Saldo/recusa do seller no provider não pode virar devolução fictícia local."""
    restaurante_id = REFUSAL_RESTAURANT_ID
    tenant_token = current_restaurante_id.set(restaurante_id)
    db = _session(restaurante_id)
    try:
        _cleanup(db, restaurante_id)
        monkeypatch.setattr(settings, "ONLINE_PAYMENT_PLAN_FEES_ENABLED", True)
        monkeypatch.setattr(settings, "KOMA_PUBLIC_API_URL", "https://api.koma.test")
        state = _simulated_provider(monkeypatch, reject_refund=True)

        user_id, account, shift, _comanda, intent = _seed_online_order(db, restaurante_id)
        OnlinePaymentService.ensure_pix_created(
            db,
            intent=intent,
            payer_email="cliente.recusa@example.invalid",
            account=account,
        )
        settled, applied = OnlinePaymentService.reconcile_provider_payment(
            db,
            account=account,
            external_payment_id=PAYMENT_EXTERNAL_ID,
        )
        assert applied is True and settled is not None
        payment = db.query(Pagamento).filter(
            Pagamento.restaurante_id == restaurante_id
        ).one()

        with pytest.raises(RefundDomainError) as exc_info:
            create_refund_guarded(
                db,
                restaurante_id=restaurante_id,
                payment_id=payment.id,
                turno_id=shift.id,
                usuario_id=user_id,
                valor=ORDER_TOTAL,
                motivo="Simulação de seller sem saldo para devolver",
                idempotency_key="first-client-refund-refused-001",
                metodo_devolucao="pix",
            )
        assert exc_info.value.status_code == 409
        db.rollback()

        remote_refund = db.query(OnlinePaymentRefund).filter(
            OnlinePaymentRefund.restaurante_id == restaurante_id,
            OnlinePaymentRefund.pagamento_id == payment.id,
        ).one()
        assert remote_refund.status == "failed"
        assert remote_refund.estorno_id is None
        assert db.query(PagamentoEstorno).filter(
            PagamentoEstorno.restaurante_id == restaurante_id,
            PagamentoEstorno.pagamento_id == payment.id,
        ).count() == 0
        assert db.query(PagamentoEstornoLiquidacao).filter(
            PagamentoEstornoLiquidacao.restaurante_id == restaurante_id,
        ).count() == 0
        assert len(_requests_by(
            state,
            "POST",
            f"/v1/payments/{PAYMENT_EXTERNAL_ID}/refunds",
        )) == 1
    finally:
        db.rollback()
        _cleanup(db, restaurante_id)
        db.close()
        current_restaurante_id.reset(tenant_token)

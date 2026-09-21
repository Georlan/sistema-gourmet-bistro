from __future__ import annotations

import datetime
import json
from decimal import Decimal

import httpx
import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.database import Base, current_restaurante_id
from app.models import (
    CaixaTurno,
    Comanda,
    Lancamento,
    OnlinePaymentIntent,
    Pagamento,
    Restaurante,
    RestaurantPaymentAccount,
    Usuario,
)
from app.routes.financial_cash_routes import ReconciledCloseRequest, fechar_turno_reconciliado
from app.services.online_payments.base import ProviderPayment
from app.services.online_payments.mercado_pago import MercadoPagoError, MercadoPagoProvider
from app.services.online_payments.service import (
    OnlinePaymentConfigurationError,
    OnlinePaymentService,
)


RID = 9941
USER_ID = "pix-close-user"
engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSession = sessionmaker(bind=engine, autocommit=False, autoflush=False)


@pytest.fixture()
def db(monkeypatch):
    token = current_restaurante_id.set(RID)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    session = TestingSession()
    monkeypatch.setattr(settings, "KOMA_PUBLIC_API_URL", "https://api.example.test")
    monkeypatch.setattr(settings, "ONLINE_PAYMENT_PIX_EXPIRATION_MINUTES", 30)
    monkeypatch.setattr(settings, "ONLINE_PAYMENT_PIX_CLOSE_GRACE_MINUTES", 5)
    try:
        session.add(Restaurante(id=RID, nome="Pix Close Test", plano="premium"))
        session.add(
            Usuario(
                id=USER_ID,
                restaurante_id=RID,
                nome="Caixa Pix",
                email="pix-close@koma.test",
                senha_hash="unused",
                role="admin",
                cargo="admin",
                status="ativo",
            )
        )
        shift = CaixaTurno(
            restaurante_id=RID,
            aberto_por_id=USER_ID,
            saldo_inicial=0,
            status="aberto",
        )
        account = RestaurantPaymentAccount(
            id="pix-close-account",
            restaurante_id=RID,
            provider="mercado_pago",
            provider_user_id="seller-pix-close",
            status="active",
        )
        account.access_token = "seller-access-token"
        account.webhook_secret = "seller-webhook-secret"
        session.add_all([shift, account])
        session.commit()
        yield session
    finally:
        session.rollback()
        session.close()
        Base.metadata.drop_all(engine)
        current_restaurante_id.reset(token)


def _open_shift(db):
    return (
        db.query(CaixaTurno)
        .filter(
            CaixaTurno.restaurante_id == RID,
            CaixaTurno.status == "aberto",
        )
        .order_by(CaixaTurno.id.desc())
        .one()
    )


def _pending_pix(
    db,
    *,
    suffix: str,
    age_minutes: int,
    external_payment_id: str,
    shift: CaixaTurno | None = None,
):
    shift = shift or _open_shift(db)
    created_at = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(
        minutes=age_minutes
    )
    command = Comanda(
        id=f"cmd-{suffix}",
        restaurante_id=RID,
        garcom_id=USER_ID,
        numero_pedido=9000 + int(suffix[-1]),
        tipo="Retirada",
        fechada=False,
        criado_em=created_at,
        delivery_status="pendente",
        delivery_forma_pagamento="pix",
        online_payment_status="pending",
        valor_pago=0,
    )
    launch = Lancamento(
        id=f"launch-{suffix}",
        restaurante_id=RID,
        comanda_id=command.id,
        garcom_id=USER_ID,
        origem="cardapio",
        status="pendente",
        idempotency_key=f"launch-key-{suffix}",
        timestamp=created_at,
    )
    intent = OnlinePaymentIntent(
        id=f"intent-{suffix}",
        restaurante_id=RID,
        comanda_id=command.id,
        turno_id=shift.id,
        provider="mercado_pago",
        method="pix",
        status="pending",
        amount=25,
        marketplace_fee=0,
        idempotency_key=f"intent-key-{suffix}",
        external_payment_id=external_payment_id,
        created_at=created_at,
        expires_at=created_at + datetime.timedelta(minutes=30),
    )
    db.add_all([command, launch, intent])
    db.commit()
    return command, intent


def _close_request():
    return ReconciledCloseRequest(
        declarado_dinheiro=Decimal("0"),
        declarado_cartao=Decimal("0"),
        declarado_pix=Decimal("0"),
        observacao="",
    )


def test_mercado_pago_cancel_payment_uses_authoritative_cancelled_status():
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(
            200,
            json={
                "id": 123456,
                "status": "cancelled",
                "transaction_amount": 25,
                "external_reference": "intent-provider-cancel",
            },
        )

    provider = MercadoPagoProvider("test-token")
    provider._client.close()
    provider._client = httpx.Client(
        base_url=provider.API_URL,
        transport=httpx.MockTransport(handler),
    )
    try:
        payment = provider.cancel_payment("123456")
    finally:
        provider._client.close()

    assert payment.status == "cancelled"
    assert len(captured) == 1
    assert captured[0].method == "PUT"
    assert captured[0].url.path == "/v1/payments/123456"
    assert json.loads(captured[0].content) == {"status": "cancelled"}


def test_recent_pending_pix_blocks_shift_close_without_cancelling(db, monkeypatch):
    shift = _open_shift(db)
    command, intent = _pending_pix(
        db,
        suffix="recent1",
        age_minutes=2,
        external_payment_id="9941001",
        shift=shift,
    )

    class PendingProvider:
        cancel_calls = 0

        def __init__(self, _access_token):
            pass

        def get_payment(self, external_payment_id):
            return ProviderPayment(
                external_id=external_payment_id,
                status="pending",
                amount=Decimal("25.00"),
                external_reference=intent.id,
                expires_at=intent.expires_at,
            )

        def cancel_payment(self, external_payment_id):
            type(self).cancel_calls += 1
            raise AssertionError("Pix com menos de 5 minutos não deve ser cancelado.")

    monkeypatch.setattr(
        "app.services.online_payments.service.MercadoPagoProvider",
        PendingProvider,
    )

    with pytest.raises(HTTPException) as exc_info:
        fechar_turno_reconciliado(
            _close_request(),
            BackgroundTasks(),
            db=db,
            current_user=db.query(Usuario).filter(Usuario.id == USER_ID).one(),
        )

    assert exc_info.value.status_code == 409
    assert "Pix online aguardando confirmação ou cancelamento" in str(exc_info.value.detail)
    assert PendingProvider.cancel_calls == 0
    db.refresh(shift)
    db.refresh(command)
    db.refresh(intent)
    assert shift.status == "aberto"
    assert command.fechada is False
    assert intent.status == "pending"


def test_abandoned_pix_after_five_minutes_is_cancelled_and_shift_can_close(db, monkeypatch):
    shift = _open_shift(db)
    command, intent = _pending_pix(
        db,
        suffix="old002",
        age_minutes=6,
        external_payment_id="9941002",
        shift=shift,
    )

    class CancelledProvider:
        def __init__(self, _access_token):
            pass

        def get_payment(self, external_payment_id):
            return ProviderPayment(
                external_id=external_payment_id,
                status="pending",
                amount=Decimal("25.00"),
                external_reference=intent.id,
                expires_at=intent.expires_at,
            )

        def cancel_payment(self, external_payment_id):
            return ProviderPayment(
                external_id=external_payment_id,
                status="cancelled",
                amount=Decimal("25.00"),
                external_reference=intent.id,
                expires_at=intent.expires_at,
            )

    monkeypatch.setattr(
        "app.services.online_payments.service.MercadoPagoProvider",
        CancelledProvider,
    )

    result = fechar_turno_reconciliado(
        _close_request(),
        BackgroundTasks(),
        db=db,
        current_user=db.query(Usuario).filter(Usuario.id == USER_ID).one(),
    )

    db.refresh(shift)
    db.refresh(command)
    db.refresh(intent)
    launch = db.query(Lancamento).filter(Lancamento.comanda_id == command.id).one()
    assert result["status"] == "fechado"
    assert shift.status == "fechado"
    assert intent.status == "cancelled"
    assert intent.turno_id == shift.id
    assert command.online_payment_status == "cancelled"
    assert command.fechada is True
    assert command.delivery_status == "recusado"
    assert launch.status == "recusado"
    assert db.query(Pagamento).filter(Pagamento.restaurante_id == RID).count() == 0


def test_approval_wins_cancel_race_and_stays_in_original_shift(db, monkeypatch):
    shift = _open_shift(db)
    command, intent = _pending_pix(
        db,
        suffix="race03",
        age_minutes=6,
        external_payment_id="9941003",
        shift=shift,
    )

    class ApprovalWinsProvider:
        get_calls = 0

        def __init__(self, _access_token):
            pass

        def get_payment(self, external_payment_id):
            type(self).get_calls += 1
            status = "pending" if type(self).get_calls == 1 else "approved"
            return ProviderPayment(
                external_id=external_payment_id,
                status=status,
                amount=Decimal("25.00"),
                external_reference=intent.id,
                expires_at=intent.expires_at,
            )

        def cancel_payment(self, _external_payment_id):
            raise MercadoPagoError(
                "Pagamento já mudou de estado.",
                status_code=400,
            )

    monkeypatch.setattr(
        "app.services.online_payments.service.MercadoPagoProvider",
        ApprovalWinsProvider,
    )

    with pytest.raises(HTTPException) as exc_info:
        fechar_turno_reconciliado(
            _close_request(),
            BackgroundTasks(),
            db=db,
            current_user=db.query(Usuario).filter(Usuario.id == USER_ID).one(),
        )

    assert exc_info.value.status_code == 409
    db.refresh(shift)
    db.refresh(command)
    db.refresh(intent)
    payment = (
        db.query(Pagamento)
        .filter(
            Pagamento.restaurante_id == RID,
            Pagamento.id == intent.pagamento_id,
        )
        .one()
    )
    assert shift.status == "aberto"
    assert intent.status == "approved"
    assert intent.turno_id == shift.id
    assert payment.status == "aprovado"
    assert payment.turno_id == shift.id
    assert command.online_payment_status == "approved"
    assert command.fechada is False
    assert ApprovalWinsProvider.get_calls == 2


def test_approved_pix_is_never_reassigned_from_closed_shift(db, monkeypatch):
    original = _open_shift(db)
    original.status = "fechado"
    original.fechado_em = datetime.datetime.now(datetime.timezone.utc)
    original.fechado_por_id = USER_ID
    newer = CaixaTurno(
        restaurante_id=RID,
        aberto_por_id=USER_ID,
        saldo_inicial=0,
        status="aberto",
    )
    db.add(newer)
    db.commit()

    command, intent = _pending_pix(
        db,
        suffix="closed4",
        age_minutes=1,
        external_payment_id="9941004",
        shift=original,
    )
    original_id = original.id

    class ApprovedProvider:
        def __init__(self, _access_token):
            pass

        def get_payment(self, external_payment_id):
            return ProviderPayment(
                external_id=external_payment_id,
                status="approved",
                amount=Decimal("25.00"),
                external_reference=intent.id,
                expires_at=intent.expires_at,
            )

    monkeypatch.setattr(
        "app.services.online_payments.service.MercadoPagoProvider",
        ApprovedProvider,
    )
    account = (
        db.query(RestaurantPaymentAccount)
        .filter(RestaurantPaymentAccount.restaurante_id == RID)
        .one()
    )

    with pytest.raises(
        OnlinePaymentConfigurationError,
        match="turno já encerrado",
    ):
        OnlinePaymentService.reconcile_provider_payment(
            db,
            account=account,
            external_payment_id=intent.external_payment_id,
        )
    db.rollback()

    persisted_intent = (
        db.query(OnlinePaymentIntent)
        .filter(OnlinePaymentIntent.id == intent.id)
        .one()
    )
    assert persisted_intent.turno_id == original_id
    assert persisted_intent.status == "pending"
    assert db.query(Pagamento).filter(Pagamento.restaurante_id == RID).count() == 0
    assert newer.status == "aberto"
    assert command.id == persisted_intent.comanda_id

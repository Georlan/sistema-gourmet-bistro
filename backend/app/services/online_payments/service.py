from __future__ import annotations

import datetime
import uuid
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy.orm import Session

from ...config import settings
from ...domain.orders.events import OrderCreated
from ...domain.orders.types import FulfillmentType, OrderChannel
from ...models import (
    CaixaTurno,
    Comanda,
    Lancamento,
    OnlinePaymentIntent,
    Pagamento,
    RestaurantPaymentAccount,
)
from ..outbox import enqueue_outbox_event_in_session
from .base import ProviderPayment
from .mercado_pago import MercadoPagoProvider


MONEY = Decimal("0.01")


class OnlinePaymentConfigurationError(RuntimeError):
    pass


class OnlinePaymentValidationError(RuntimeError):
    pass


def _money(value: object) -> Decimal:
    return Decimal(str(value)).quantize(MONEY, rounding=ROUND_HALF_UP)


def _mapped_status(provider_status: str) -> str:
    return {
        "approved": "approved",
        "pending": "pending",
        "in_process": "pending",
        "authorized": "pending",
        "rejected": "rejected",
        "cancelled": "cancelled",
        "expired": "expired",
    }.get((provider_status or "").lower(), "pending")


class OnlinePaymentService:
    @staticmethod
    def active_account(db: Session, restaurant_id: int) -> RestaurantPaymentAccount:
        account = db.query(RestaurantPaymentAccount).filter(
            RestaurantPaymentAccount.restaurante_id == restaurant_id,
            RestaurantPaymentAccount.provider == "mercado_pago",
            RestaurantPaymentAccount.status == "active",
        ).first()
        if account is None:
            raise OnlinePaymentConfigurationError(
                "O pagamento online ainda não foi ativado por este restaurante. Escolha dinheiro ou fale com o estabelecimento."
            )
        if not account.access_token or not account.webhook_secret:
            raise OnlinePaymentConfigurationError("A conta de pagamento precisa ser reconectada.")
        if not settings.KOMA_PUBLIC_API_URL:
            raise OnlinePaymentConfigurationError("A URL pública de pagamentos ainda não foi configurada.")
        return account

    @staticmethod
    def open_shift(db: Session, restaurant_id: int) -> CaixaTurno:
        shift = db.query(CaixaTurno).filter(
            CaixaTurno.restaurante_id == restaurant_id,
            CaixaTurno.status == "aberto",
        ).order_by(CaixaTurno.id.desc()).first()
        if shift is None:
            raise OnlinePaymentConfigurationError(
                "O caixa precisa estar aberto para receber pagamentos online."
            )
        return shift

    @staticmethod
    def marketplace_fee(amount: Decimal) -> Decimal:
        rate = Decimal(str(settings.ONLINE_PAYMENT_MARKETPLACE_RATE))
        return (amount * rate).quantize(MONEY, rounding=ROUND_HALF_UP)

    @classmethod
    def create_intent_in_session(
        cls,
        db: Session,
        *,
        comanda: Comanda,
        turno: CaixaTurno,
        amount: Decimal,
        idempotency_key: str,
    ) -> OnlinePaymentIntent:
        intent = OnlinePaymentIntent(
            restaurante_id=comanda.restaurante_id,
            comanda_id=comanda.id,
            turno_id=turno.id,
            provider="mercado_pago",
            method="pix",
            status="created",
            amount=float(_money(amount)),
            marketplace_fee=float(cls.marketplace_fee(_money(amount))),
            idempotency_key=idempotency_key,
        )
        comanda.online_payment_status = "pending"
        db.add(intent)
        db.flush()
        return intent

    @classmethod
    def ensure_pix_created(
        cls,
        db: Session,
        *,
        intent: OnlinePaymentIntent,
        payer_email: str,
        account: RestaurantPaymentAccount | None = None,
    ) -> OnlinePaymentIntent:
        if intent.external_payment_id:
            return intent
        account = account or cls.active_account(db, intent.restaurante_id)
        expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(
            minutes=settings.ONLINE_PAYMENT_PIX_EXPIRATION_MINUTES
        )
        provider = MercadoPagoProvider(account.access_token)
        try:
            payment = provider.create_pix(
                amount=_money(intent.amount),
                marketplace_fee=_money(intent.marketplace_fee),
                payer_email=payer_email,
                external_reference=intent.id,
                idempotency_key=f"koma-online-{intent.id}",
                notification_url=(
                    f"{settings.KOMA_PUBLIC_API_URL}/payments/webhooks/mercado-pago/{account.id}"
                ),
                expires_at=expires_at,
            )
            if not payment.external_id or payment.external_reference != intent.id:
                raise OnlinePaymentValidationError("Resposta inválida do provedor de pagamento.")
            if _money(payment.amount) != _money(intent.amount):
                raise OnlinePaymentValidationError("O provedor retornou um valor diferente do pedido.")
            intent.external_payment_id = payment.external_id
            intent.status = _mapped_status(payment.status)
            intent.qr_code = payment.qr_code
            intent.qr_code_base64 = payment.qr_code_base64
            intent.ticket_url = payment.ticket_url
            intent.expires_at = payment.expires_at or expires_at
            intent.last_error = None
            db.commit()
            db.refresh(intent)
            return intent
        except Exception as exc:
            db.rollback()
            persisted = db.query(OnlinePaymentIntent).filter(
                OnlinePaymentIntent.restaurante_id == intent.restaurante_id,
                OnlinePaymentIntent.id == intent.id,
            ).first()
            if persisted is not None:
                persisted.status = "error"
                persisted.last_error = str(exc)[:1000]
                db.commit()
            raise

    @staticmethod
    def public_payload(intent: OnlinePaymentIntent) -> dict:
        return {
            "status": intent.status,
            "cobranca_online": True,
            "provedor": intent.provider,
            "metodo": intent.method,
            "qr_code": intent.qr_code,
            "qr_code_base64": intent.qr_code_base64,
            "ticket_url": intent.ticket_url,
            "expira_em": intent.expires_at.isoformat() if intent.expires_at else None,
        }

    @classmethod
    def reconcile_provider_payment(
        cls,
        db: Session,
        *,
        account: RestaurantPaymentAccount,
        external_payment_id: str,
    ) -> tuple[OnlinePaymentIntent | None, bool]:
        payment = MercadoPagoProvider(account.access_token).get_payment(external_payment_id)
        intent = db.query(OnlinePaymentIntent).filter(
            OnlinePaymentIntent.restaurante_id == account.restaurante_id,
            OnlinePaymentIntent.provider == "mercado_pago",
            OnlinePaymentIntent.external_payment_id == payment.external_id,
        ).with_for_update().first()
        if intent is None:
            return None, False
        if payment.external_reference != intent.id or _money(payment.amount) != _money(intent.amount):
            raise OnlinePaymentValidationError("Pagamento não corresponde ao pedido registrado.")

        mapped = _mapped_status(payment.status)
        became_approved = mapped == "approved" and intent.status != "approved"
        if intent.status == "approved" and mapped != "approved":
            return intent, False

        intent.status = mapped
        comanda = db.query(Comanda).filter(
            Comanda.restaurante_id == account.restaurante_id,
            Comanda.id == intent.comanda_id,
        ).with_for_update().one()
        comanda.online_payment_status = mapped

        if became_approved:
            shift = db.query(CaixaTurno).filter(
                CaixaTurno.restaurante_id == account.restaurante_id,
                CaixaTurno.id == intent.turno_id,
            ).with_for_update().first()
            if shift is None or shift.status != "aberto":
                shift = db.query(CaixaTurno).filter(
                    CaixaTurno.restaurante_id == account.restaurante_id,
                    CaixaTurno.status == "aberto",
                ).order_by(CaixaTurno.id.desc()).with_for_update().first()
                if shift is None:
                    raise OnlinePaymentConfigurationError(
                        "Pagamento aprovado sem turno de caixa aberto para conciliação."
                    )
                intent.turno_id = shift.id
            pagamento = Pagamento(
                id=str(uuid.uuid4()),
                restaurante_id=account.restaurante_id,
                comanda_id=comanda.id,
                turno_id=intent.turno_id,
                valor=float(_money(intent.amount)),
                metodo="pix",
                status="aprovado",
                idempotency_key=f"online:mercado_pago:{payment.external_id}",
                cliente_id=comanda.cliente_id,
                nome_cliente=comanda.identificador,
            )
            db.add(pagamento)
            db.flush()
            intent.pagamento_id = pagamento.id
            intent.approved_at = datetime.datetime.now(datetime.timezone.utc)
            comanda.valor_pago = float(_money(intent.amount))
            for item in comanda.itens:
                if item.status != "cancelado":
                    item.pago = True

            lancamento = db.query(Lancamento).filter(
                Lancamento.restaurante_id == account.restaurante_id,
                Lancamento.comanda_id == comanda.id,
            ).order_by(Lancamento.timestamp.asc()).first()
            if lancamento is not None:
                event = OrderCreated(
                    restaurant_id=account.restaurante_id,
                    order_id=lancamento.id,
                    check_id=comanda.id,
                    display_number=str(comanda.numero_pedido),
                    check_number=comanda.numero_pedido,
                    channel=OrderChannel.WEB_CARDAPIO,
                    fulfillment=(
                        FulfillmentType.PICKUP if comanda.tipo == "Retirada" else FulfillmentType.DELIVERY
                    ),
                    total=_money(intent.amount),
                    items_count=len([item for item in comanda.itens if item.status != "cancelado"]),
                    customer_name=comanda.identificador,
                    customer_phone=comanda.delivery_telefone,
                    idempotency_key=comanda.idempotency_key,
                )
                enqueue_outbox_event_in_session(
                    db,
                    event,
                    aggregate_type="order",
                    aggregate_id=str(lancamento.id),
                )
        db.commit()
        return intent, became_approved

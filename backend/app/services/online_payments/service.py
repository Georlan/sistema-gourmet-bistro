from __future__ import annotations

import datetime
import logging
import uuid
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy.orm import Session

from ...config import settings
from ...database import SessionLocal
from ...domain.orders.events import OrderCreated
from ...domain.orders.types import FulfillmentType, OrderChannel
from ...models import (
    CaixaTurno,
    Comanda,
    Lancamento,
    OnlinePaymentIntent,
    Pagamento,
    Restaurante,
    RestaurantPaymentAccount,
)
from ...subscription import subscription_marketplace_rate
from ..outbox import enqueue_outbox_event_in_session
from .base import ProviderPayment
from .mercado_pago import MercadoPagoError, MercadoPagoProvider
from .oauth import MercadoPagoOAuthError, refresh_access_token


MONEY = Decimal("0.01")
TOKEN_REFRESH_SKEW = datetime.timedelta(minutes=5)
logger = logging.getLogger("koma.online_payments")


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


def _token_needs_refresh(expires_at: datetime.datetime | None) -> bool:
    if expires_at is None:
        return False
    normalized = expires_at
    if normalized.tzinfo is None:
        normalized = normalized.replace(tzinfo=datetime.timezone.utc)
    return normalized <= datetime.datetime.now(datetime.timezone.utc) + TOKEN_REFRESH_SKEW


def _token_expiry(expires_in: int | None) -> datetime.datetime | None:
    if expires_in is None or expires_in <= 0:
        return None
    return datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=expires_in)


class OnlinePaymentService:
    @classmethod
    def _refresh_account_credentials(
        cls,
        db: Session,
        account: RestaurantPaymentAccount,
        *,
        force: bool = False,
        known_access_token: str | None = None,
    ) -> RestaurantPaymentAccount:
        """Renova credenciais OAuth numa transação independente da transação do pedido.

        O refresh token do Mercado Pago pode rotacionar. Por isso a renovação precisa
        ser commitada antes de continuar o pedido; um rollback posterior do pedido não
        pode restaurar um refresh token que o provedor já invalidou.
        """
        refresh_db = SessionLocal(restaurante_id=account.restaurante_id)
        try:
            locked = (
                refresh_db.query(RestaurantPaymentAccount)
                .filter(
                    RestaurantPaymentAccount.restaurante_id == account.restaurante_id,
                    RestaurantPaymentAccount.id == account.id,
                    RestaurantPaymentAccount.provider == "mercado_pago",
                    RestaurantPaymentAccount.status == "active",
                )
                .with_for_update()
                .first()
            )
            if locked is None:
                raise OnlinePaymentConfigurationError(
                    "A conta Mercado Pago precisa ser reconectada."
                )

            locked_access_token = locked.access_token
            if force and known_access_token and locked_access_token != known_access_token:
                # Outra requisição já renovou as credenciais enquanto esperávamos o lock.
                refresh_db.rollback()
            elif not force and not _token_needs_refresh(locked.token_expires_at):
                refresh_db.rollback()
            else:
                current_refresh_token = locked.refresh_token
                if not current_refresh_token:
                    raise OnlinePaymentConfigurationError(
                        "A conta Mercado Pago precisa ser reconectada."
                    )
                try:
                    tokens = refresh_access_token(current_refresh_token)
                except MercadoPagoOAuthError as exc:
                    logger.warning(
                        "Falha ao renovar OAuth Mercado Pago do restaurante %s.",
                        account.restaurante_id,
                    )
                    raise OnlinePaymentConfigurationError(
                        "Não foi possível renovar a conexão com o Mercado Pago. Reconecte a conta e tente novamente."
                    ) from exc

                if (
                    locked.provider_user_id
                    and tokens.provider_user_id != locked.provider_user_id
                ):
                    raise OnlinePaymentConfigurationError(
                        "A renovação do Mercado Pago retornou uma conta diferente. Reconecte a conta."
                    )

                locked.access_token = tokens.access_token
                if tokens.refresh_token:
                    locked.refresh_token = tokens.refresh_token
                if tokens.public_key:
                    locked.public_key = tokens.public_key
                locked.provider_user_id = tokens.provider_user_id
                locked.token_expires_at = _token_expiry(tokens.expires_in)
                locked.updated_at = datetime.datetime.now(datetime.timezone.utc)
                refresh_db.commit()
                logger.info(
                    "Credenciais OAuth Mercado Pago renovadas para o restaurante %s.",
                    account.restaurante_id,
                )
        except OnlinePaymentConfigurationError:
            refresh_db.rollback()
            raise
        finally:
            refresh_db.close()

        # A sessão do pedido pode ter carregado a linha antes da renovação. Recarrega
        # os campos criptografados sem interferir nos demais writes/locks da transação.
        db.refresh(account)
        return account

    @classmethod
    def active_account(cls, db: Session, restaurant_id: int) -> RestaurantPaymentAccount:
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
        if _token_needs_refresh(account.token_expires_at):
            account = cls._refresh_account_credentials(db, account)
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
    def marketplace_fee(amount: Decimal, stored_plan: str | None) -> Decimal:
        if not settings.ONLINE_PAYMENT_PLAN_FEES_ENABLED:
            return Decimal("0.00")
        rate = subscription_marketplace_rate(stored_plan)
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
        restaurant = db.query(Restaurante).filter(
            Restaurante.id == comanda.restaurante_id,
        ).first()
        if restaurant is None:
            raise OnlinePaymentConfigurationError("Restaurante não encontrado para calcular o pagamento online.")

        normalized_amount = _money(amount)
        intent = OnlinePaymentIntent(
            restaurante_id=comanda.restaurante_id,
            comanda_id=comanda.id,
            turno_id=turno.id,
            provider="mercado_pago",
            method="pix",
            status="created",
            amount=float(normalized_amount),
            marketplace_fee=float(cls.marketplace_fee(normalized_amount, restaurant.plano)),
            idempotency_key=idempotency_key,
        )
        comanda.online_payment_status = "pending"
        db.add(intent)
        db.flush()
        return intent

    @classmethod
    def apply_provider_snapshot_in_session(
        cls,
        db: Session,
        *,
        account: RestaurantPaymentAccount,
        intent: OnlinePaymentIntent,
        payment: ProviderPayment,
    ) -> tuple[OnlinePaymentIntent, bool]:
        """Aplica a verdade do provedor de forma transacional e idempotente.

        Todos os caminhos que observam um status do provedor (criação do Pix,
        webhook, reconciliação ou retry) devem passar por este método. O retorno
        booleano indica se os efeitos de aprovação foram materializados agora.
        """
        locked_intent = db.query(OnlinePaymentIntent).filter(
            OnlinePaymentIntent.restaurante_id == account.restaurante_id,
            OnlinePaymentIntent.id == intent.id,
            OnlinePaymentIntent.provider == "mercado_pago",
        ).with_for_update().one()

        if not (payment.external_id or "").strip():
            raise OnlinePaymentValidationError("Resposta inválida do provedor de pagamento.")
        if payment.external_reference != locked_intent.id:
            raise OnlinePaymentValidationError("Pagamento não corresponde ao pedido registrado.")
        if _money(payment.amount) != _money(locked_intent.amount):
            raise OnlinePaymentValidationError("Pagamento não corresponde ao pedido registrado.")
        if (
            locked_intent.external_payment_id
            and locked_intent.external_payment_id != payment.external_id
        ):
            raise OnlinePaymentValidationError("Pagamento externo divergente da intenção registrada.")

        locked_intent.external_payment_id = payment.external_id
        mapped = _mapped_status(payment.status)

        # Aprovação financeira é monotônica: um snapshot posterior pendente ou
        # rejeitado não desfaz receita já reconhecida. Reembolsos/chargebacks
        # pertencem ao ledger de estornos e serão tratados em fluxo próprio.
        if locked_intent.status == "approved" and mapped != "approved":
            return locked_intent, False

        comanda = db.query(Comanda).filter(
            Comanda.restaurante_id == account.restaurante_id,
            Comanda.id == locked_intent.comanda_id,
        ).with_for_update().one()
        locked_intent.status = mapped
        comanda.online_payment_status = mapped

        if mapped != "approved":
            return locked_intent, False

        payment_idempotency_key = f"online:mercado_pago:{payment.external_id}"
        pagamento = None
        if locked_intent.pagamento_id:
            pagamento = db.query(Pagamento).filter(
                Pagamento.restaurante_id == account.restaurante_id,
                Pagamento.id == locked_intent.pagamento_id,
            ).with_for_update().first()
        if pagamento is None:
            pagamento = db.query(Pagamento).filter(
                Pagamento.restaurante_id == account.restaurante_id,
                Pagamento.idempotency_key == payment_idempotency_key,
            ).with_for_update().first()

        approval_effects_applied = pagamento is None
        if pagamento is None:
            shift = db.query(CaixaTurno).filter(
                CaixaTurno.restaurante_id == account.restaurante_id,
                CaixaTurno.id == locked_intent.turno_id,
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
                locked_intent.turno_id = shift.id

            pagamento = Pagamento(
                id=str(uuid.uuid4()),
                restaurante_id=account.restaurante_id,
                comanda_id=comanda.id,
                turno_id=locked_intent.turno_id,
                valor=float(_money(locked_intent.amount)),
                metodo="pix",
                status="aprovado",
                idempotency_key=payment_idempotency_key,
                cliente_id=comanda.cliente_id,
                nome_cliente=comanda.identificador,
            )
            db.add(pagamento)
            db.flush()
        else:
            if pagamento.status != "aprovado" or _money(pagamento.valor) != _money(locked_intent.amount):
                raise OnlinePaymentValidationError(
                    "Pagamento já registrado diverge da aprovação recebida do provedor."
                )

        locked_intent.pagamento_id = pagamento.id
        if locked_intent.approved_at is None:
            locked_intent.approved_at = datetime.datetime.now(datetime.timezone.utc)
        comanda.valor_pago = float(_money(locked_intent.amount))
        for item in comanda.itens:
            if item.status != "cancelado":
                item.pago = True

        if approval_effects_applied:
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
                    total=_money(locked_intent.amount),
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

        return locked_intent, approval_effects_applied

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

        def create_with_current_token() -> ProviderPayment:
            return MercadoPagoProvider(account.access_token).create_pix(
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

        try:
            try:
                payment = create_with_current_token()
            except MercadoPagoError as exc:
                if exc.status_code != 401:
                    raise
                stale_access_token = account.access_token
                logger.info(
                    "Mercado Pago rejeitou access token do restaurante %s; tentando refresh OAuth uma vez.",
                    account.restaurante_id,
                )
                account = cls._refresh_account_credentials(
                    db,
                    account,
                    force=True,
                    known_access_token=stale_access_token,
                )
                payment = create_with_current_token()

            settled_intent, _ = cls.apply_provider_snapshot_in_session(
                db,
                account=account,
                intent=intent,
                payment=payment,
            )
            settled_intent.qr_code = payment.qr_code
            settled_intent.qr_code_base64 = payment.qr_code_base64
            settled_intent.ticket_url = payment.ticket_url
            settled_intent.expires_at = payment.expires_at or expires_at
            settled_intent.last_error = None
            db.commit()
            db.refresh(settled_intent)
            return settled_intent
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
        try:
            payment = MercadoPagoProvider(account.access_token).get_payment(external_payment_id)
        except MercadoPagoError as exc:
            if exc.status_code != 401:
                raise
            stale_access_token = account.access_token
            account = cls._refresh_account_credentials(
                db,
                account,
                force=True,
                known_access_token=stale_access_token,
            )
            payment = MercadoPagoProvider(account.access_token).get_payment(external_payment_id)

        intent = db.query(OnlinePaymentIntent).filter(
            OnlinePaymentIntent.restaurante_id == account.restaurante_id,
            OnlinePaymentIntent.provider == "mercado_pago",
            OnlinePaymentIntent.external_payment_id == payment.external_id,
        ).first()
        if intent is None:
            return None, False

        settled_intent, approval_effects_applied = cls.apply_provider_snapshot_in_session(
            db,
            account=account,
            intent=intent,
            payment=payment,
        )
        db.commit()
        return settled_intent, approval_effects_applied

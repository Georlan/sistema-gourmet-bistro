import datetime
from typing import Optional

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from ..config import settings
from ..smartpos_models import SmartPosPaymentIntent
from .smartpos_payment_state import transition_intent


_SAFE_EXPIRABLE_STATUSES = ("criada", "pendente")


def smartpos_intent_ttl() -> datetime.timedelta:
    return datetime.timedelta(minutes=settings.SMARTPOS_INTENT_TTL_MINUTES)


def new_smartpos_expiration(
    now: Optional[datetime.datetime] = None,
) -> datetime.datetime:
    current = now or datetime.datetime.now(datetime.timezone.utc)
    return current + smartpos_intent_ttl()


def _utc(value: datetime.datetime) -> datetime.datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=datetime.timezone.utc)
    return value.astimezone(datetime.timezone.utc)


def smartpos_expiration_deadline(intent: SmartPosPaymentIntent) -> datetime.datetime:
    if intent.expira_em is not None:
        return _utc(intent.expira_em)
    return _utc(intent.criado_em) + smartpos_intent_ttl()


def intent_is_safely_abandoned(
    intent: SmartPosPaymentIntent,
    *,
    now: Optional[datetime.datetime] = None,
) -> bool:
    if intent.status not in _SAFE_EXPIRABLE_STATUSES or intent.pagamento_id is not None:
        return False
    current = now or datetime.datetime.now(datetime.timezone.utc)
    return smartpos_expiration_deadline(intent) <= _utc(current)


def expire_intent_if_safely_abandoned(
    db: Session,
    *,
    intent: SmartPosPaymentIntent,
    actor_id: Optional[str],
    now: Optional[datetime.datetime] = None,
) -> bool:
    if not intent_is_safely_abandoned(intent, now=now):
        return False
    transition_intent(
        db,
        intent=intent,
        target_status="expirada",
        transition_key=f"ttl:{intent.id}",
        actor_id=actor_id,
        motivo="Intenção abandonada: prazo encerrado antes de iniciar uma cobrança.",
    )
    return True


def expire_abandoned_intents(
    db: Session,
    *,
    restaurante_id: int,
    actor_id: Optional[str],
    atendimento_id: Optional[str] = None,
    now: Optional[datetime.datetime] = None,
    limit: int = 100,
) -> list[SmartPosPaymentIntent]:
    current = _utc(now or datetime.datetime.now(datetime.timezone.utc))
    legacy_cutoff = current - smartpos_intent_ttl()
    query = db.query(SmartPosPaymentIntent).filter(
        SmartPosPaymentIntent.restaurante_id == restaurante_id,
        SmartPosPaymentIntent.status.in_(_SAFE_EXPIRABLE_STATUSES),
        SmartPosPaymentIntent.pagamento_id.is_(None),
        or_(
            SmartPosPaymentIntent.expira_em <= current,
            and_(
                SmartPosPaymentIntent.expira_em.is_(None),
                SmartPosPaymentIntent.criado_em <= legacy_cutoff,
            ),
        ),
    )
    if atendimento_id is not None:
        query = query.filter(SmartPosPaymentIntent.atendimento_id == atendimento_id)
    intents = (
        query.order_by(
            SmartPosPaymentIntent.criado_em.asc(),
            SmartPosPaymentIntent.id.asc(),
        )
        .limit(limit)
        .with_for_update(skip_locked=True)
        .all()
    )
    return [
        intent
        for intent in intents
        if expire_intent_if_safely_abandoned(
            db,
            intent=intent,
            actor_id=actor_id,
            now=current,
        )
    ]

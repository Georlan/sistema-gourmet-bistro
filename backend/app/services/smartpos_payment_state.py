import datetime
from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

from ..smartpos_models import SmartPosPaymentIntent, SmartPosPaymentIntentEvent


TERMINAL_STATUSES = {"aprovada", "recusada", "cancelada", "expirada"}

_ALLOWED_TRANSITIONS = {
    "criada": {"pendente", "cancelada", "expirada"},
    "pendente": {"processando", "aprovada", "cancelada", "expirada"},
    "processando": {"aprovada", "recusada"},
    "aprovada": set(),
    "recusada": set(),
    "cancelada": set(),
    "expirada": set(),
}


@dataclass(frozen=True)
class StateTransitionResult:
    intent: SmartPosPaymentIntent
    event: SmartPosPaymentIntentEvent
    replayed: bool = False


class InvalidSmartPosTransition(ValueError):
    pass


def initial_status_for_capture(captura: str) -> str:
    if captura in {"dinheiro_pendente", "registro_externo"}:
        return "pendente"
    return "criada"


def can_transition(current: str, target: str) -> bool:
    return target in _ALLOWED_TRANSITIONS.get(current, set())


def transition_intent(
    db: Session,
    *,
    intent: SmartPosPaymentIntent,
    target_status: str,
    transition_key: str,
    actor_id: Optional[str],
    motivo: Optional[str] = None,
) -> StateTransitionResult:
    normalized_key = transition_key.strip()
    if len(normalized_key) < 8:
        raise InvalidSmartPosTransition("A chave idempotente da transição deve possuir ao menos 8 caracteres úteis.")

    existing_event = db.query(SmartPosPaymentIntentEvent).filter(
        SmartPosPaymentIntentEvent.restaurante_id == intent.restaurante_id,
        SmartPosPaymentIntentEvent.intent_id == intent.id,
        SmartPosPaymentIntentEvent.transition_key == normalized_key,
    ).first()
    if existing_event is not None:
        if existing_event.to_status != target_status:
            raise InvalidSmartPosTransition("A chave idempotente já foi usada para outra transição.")
        return StateTransitionResult(intent=intent, event=existing_event, replayed=True)

    current = intent.status
    if not can_transition(current, target_status):
        raise InvalidSmartPosTransition(f"Transição inválida: {current} -> {target_status}.")

    now = datetime.datetime.now(datetime.timezone.utc)
    event = SmartPosPaymentIntentEvent(
        restaurante_id=intent.restaurante_id,
        intent_id=intent.id,
        from_status=current,
        to_status=target_status,
        actor_id=actor_id,
        transition_key=normalized_key,
        motivo=(motivo or "").strip() or None,
        criado_em=now,
    )
    intent.status = target_status
    intent.status_em = now
    db.add(event)
    db.flush()
    return StateTransitionResult(intent=intent, event=event, replayed=False)

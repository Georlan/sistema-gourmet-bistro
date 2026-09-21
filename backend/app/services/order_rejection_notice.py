"""Motivo de recusa como evento contextual, separado de mensagens humanas."""
from sqlalchemy.orm import Session
from ..order_chat_models import OrderConversation, OrderConversationEvent
from .order_chat_service import append_order_feed_event


def append_rejection_reason_notice(
    db: Session, *, restaurante_id: int, pedido_id: str, reason: str,
) -> OrderConversationEvent | None:
    normalized_reason = (reason or "").strip()
    if not normalized_reason:
        return None
    conversation = db.query(OrderConversation).filter_by(
        restaurante_id=restaurante_id, pedido_id=pedido_id,
    ).first()
    if conversation is None:
        return None
    return append_order_feed_event(
        db, conv=conversation, event_key="rejection_reason",
        body=f"Motivo informado pelo restaurante: {normalized_reason}",
    )

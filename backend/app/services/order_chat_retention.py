"""Bounded retention for ephemeral order-chat content."""
from __future__ import annotations

import datetime
from sqlalchemy.orm import Session

from ..order_chat_models import (
    OrderConversation, OrderConversationEvent, OrderMessage, OrderPushSubscription,
)


def purge_expired_order_chat_content(
    db: Session, *, restaurante_id: int, retention_days: int = 30,
    batch_size: int = 100, now: datetime.datetime | None = None,
) -> int:
    """Purga conteúdo, mantendo conversa, token e pedido para acompanhamento."""
    retention_days = max(7, min(int(retention_days), 365))
    batch_size = max(1, min(int(batch_size), 500))
    now = now or datetime.datetime.now(datetime.timezone.utc)
    cutoff = now - datetime.timedelta(days=retention_days)
    conversations = (
        db.query(OrderConversation)
        .filter(OrderConversation.restaurante_id == restaurante_id,
                OrderConversation.closed_at.is_not(None),
                OrderConversation.closed_at < cutoff,
                OrderConversation.chat_purged_at.is_(None))
        .order_by(OrderConversation.closed_at.asc())
        .limit(batch_size).all()
    )
    for conversation in conversations:
        filters = {"restaurante_id": restaurante_id, "conversation_id": conversation.id}
        db.query(OrderMessage).filter_by(**filters).delete(synchronize_session=False)
        db.query(OrderConversationEvent).filter_by(**filters).delete(synchronize_session=False)
        db.query(OrderPushSubscription).filter_by(**filters).delete(synchronize_session=False)
        conversation.chat_purged_at = now
    if conversations:
        db.flush()
    return len(conversations)

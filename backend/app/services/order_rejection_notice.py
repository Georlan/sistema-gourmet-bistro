"""Notificação de sistema com o motivo explícito de uma recusa de pedido.

O ciclo de vida continua sendo a autoridade do status. Este módulo apenas cria
uma mensagem de sistema idempotente na conversa já existente, depois que a
transição canônica foi aplicada, para que o cliente entenda por que o pedido não
foi aceito.
"""

from __future__ import annotations

import datetime
import uuid

from sqlalchemy.orm import Session

from ..order_chat_models import OrderConversation, OrderMessage
from .order_chat_hub import order_chat_hub
from .order_chat_service import PLAIN_TEXT_BODY_FORMAT, serialize_message

_REJECTION_REASON_EVENT_KEY = "rejection_reason"


def append_rejection_reason_notice(
    db: Session,
    *,
    restaurante_id: int,
    pedido_id: str,
    reason: str,
) -> OrderMessage | None:
    """Anexa o motivo da recusa ao histórico do pedido sem reabrir a conversa."""
    normalized_reason = (reason or "").strip()
    if not normalized_reason:
        return None

    conversation = (
        db.query(OrderConversation)
        .filter(
            OrderConversation.restaurante_id == restaurante_id,
            OrderConversation.pedido_id == pedido_id,
        )
        .first()
    )
    if conversation is None:
        return None

    existing = (
        db.query(OrderMessage)
        .filter(
            OrderMessage.restaurante_id == restaurante_id,
            OrderMessage.conversation_id == conversation.id,
            OrderMessage.event_key == _REJECTION_REASON_EVENT_KEY,
        )
        .first()
    )
    if existing is not None:
        return existing

    now = datetime.datetime.now(datetime.timezone.utc)
    message = OrderMessage(
        id=str(uuid.uuid4()),
        restaurante_id=restaurante_id,
        conversation_id=conversation.id,
        pedido_id=pedido_id,
        sender_type="system",
        body=f"Motivo informado pelo restaurante: {normalized_reason}",
        body_format=PLAIN_TEXT_BODY_FORMAT,
        event_key=_REJECTION_REASON_EVENT_KEY,
        created_at=now,
    )
    db.add(message)
    conversation.updated_at = now
    db.flush()

    order_chat_hub.publish_message(
        restaurante_id,
        conversation.id,
        serialize_message(message),
    )
    return message

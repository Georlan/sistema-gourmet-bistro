"""Read model da Central de Conversas do Caixa.

Mantém o hot path de não lidas somente em conversas ativas, mas permite que a
Central consulte também o histórico encerrado sem apagar mensagens antigas.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ..models import Comanda
from ..order_chat_models import OrderConversation, OrderMessage
from .order_chat_service import compute_comanda_total, list_caixa_conversations, serialize_message


def _client_name(comanda: Comanda | None) -> str:
    if not comanda:
        return "Cliente"
    try:
        if comanda.cliente_id and getattr(comanda, "cliente", None):
            return getattr(comanda.cliente, "nome", None) or "Cliente"
        if getattr(comanda, "identificador", None):
            return comanda.identificador or "Cliente"
    except Exception:
        return "Cliente"
    return "Cliente"


def list_caixa_conversations_for_central(
    db: Session,
    restaurante_id: int,
    *,
    archived_limit: int = 50,
) -> list[dict[str, Any]]:
    """Retorna fila ativa + histórico arquivado recente para a Central.

    Conversas encerradas não participam do contador de não lidas. A UI decide
    qual aba mostrar, enquanto o backend continua sendo a fonte do histórico.
    """
    active = list_caixa_conversations(db, restaurante_id)

    archived = (
        db.query(OrderConversation)
        .options(
            joinedload(OrderConversation.comanda).joinedload(Comanda.cliente),
            joinedload(OrderConversation.comanda).joinedload(Comanda.itens),
        )
        .filter(
            OrderConversation.restaurante_id == restaurante_id,
            OrderConversation.closed_at.isnot(None),
        )
        .order_by(OrderConversation.updated_at.desc())
        .limit(max(1, min(int(archived_limit), 100)))
        .all()
    )
    if not archived:
        return active

    conversation_ids = [conversation.id for conversation in archived]
    ranked_messages = (
        db.query(
            OrderMessage.id.label("message_id"),
            OrderMessage.conversation_id.label("conversation_id"),
            func.row_number()
            .over(
                partition_by=OrderMessage.conversation_id,
                order_by=(OrderMessage.created_at.desc(), OrderMessage.id.desc()),
            )
            .label("row_number"),
        )
        .filter(OrderMessage.conversation_id.in_(conversation_ids))
        .subquery()
    )
    last_messages = (
        db.query(OrderMessage)
        .join(ranked_messages, OrderMessage.id == ranked_messages.c.message_id)
        .filter(ranked_messages.c.row_number == 1)
        .all()
    )
    last_by_conversation = {message.conversation_id: message for message in last_messages}

    history: list[dict[str, Any]] = []
    for conversation in archived:
        comanda = conversation.comanda
        last_message = last_by_conversation.get(conversation.id)
        history.append({
            "id": conversation.id,
            "pedido_id": conversation.pedido_id,
            "numero_pedido": comanda.numero_pedido if comanda else None,
            "cliente_nome": _client_name(comanda),
            "tipo_pedido": comanda.tipo if comanda else "Delivery",
            "status_pedido": comanda.delivery_status if comanda else "finalizado",
            "total_pedido": compute_comanda_total(comanda),
            "unread_count": 0,
            "closed_at": conversation.closed_at.isoformat() if conversation.closed_at else None,
            "updated_at": conversation.updated_at.isoformat() if conversation.updated_at else None,
            "last_message": serialize_message(last_message) if last_message else None,
        })

    combined = active + history
    combined.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
    return combined[:100]

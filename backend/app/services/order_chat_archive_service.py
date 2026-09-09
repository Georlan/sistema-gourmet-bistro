"""Read model e regras leves de arquivo da Central de Conversas do Caixa.

Mantém o hot path de não lidas somente em conversas ativas, permite consultar o
histórico encerrado e reabre atendimento de pós-venda quando o cliente volta a
escrever em um pedido concluído — sem reabrir o pedido.
"""

from __future__ import annotations

import datetime
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ..models import Comanda
from ..order_chat_models import OrderConversation, OrderMessage
from .order_chat_hub import order_chat_hub
from .order_chat_service import compute_comanda_total, list_caixa_conversations, serialize_message


_COMPLETED_STATUSES = {"finalizado", "finalizada", "concluido", "concluida", "completed"}
_REJECTED_STATUSES = {"recusado", "recusada", "rejected", "cancelado", "cancelada", "cancelled"}


def _normalize_status(value: str | None) -> str:
    return (value or "").strip().lower()


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


def reopen_completed_conversation_if_needed(
    db: Session,
    restaurante_id: int,
    conversation_id: str,
) -> bool:
    """Reabre somente o atendimento de um pedido concluído.

    Pedido recusado/cancelado continua encerrado. O pedido em si nunca muda de
    status; somente ``closed_at`` da conversa volta a ``None`` para pós-venda.
    """
    conversation = (
        db.query(OrderConversation)
        .filter(
            OrderConversation.restaurante_id == restaurante_id,
            OrderConversation.id == conversation_id,
        )
        .first()
    )
    if not conversation or conversation.closed_at is None:
        return False

    comanda = (
        db.query(Comanda)
        .filter(
            Comanda.restaurante_id == restaurante_id,
            Comanda.id == conversation.pedido_id,
        )
        .first()
    )
    if not comanda:
        return False

    raw_status = _normalize_status(comanda.delivery_status)
    if raw_status in _REJECTED_STATUSES:
        return False
    if not bool(comanda.fechada) and raw_status not in _COMPLETED_STATUSES:
        return False

    now = datetime.datetime.now(datetime.timezone.utc)
    conversation.closed_at = None
    conversation.updated_at = now
    db.flush()
    order_chat_hub.publish_status(
        restaurante_id,
        conversation.id,
        {
            "status": "post_sale",
            "closed_at": None,
            "reopened": True,
        },
    )
    return True


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

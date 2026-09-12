"""Retenção segura do histórico de Chat & Status de pedidos.

A política remove apenas conversas já encerradas cujo ``closed_at`` ultrapassou
uma janela explícita. Pedidos/comandas e registros financeiros nunca são
apagados por este serviço.
"""

from __future__ import annotations

import datetime

from sqlalchemy.orm import Session

from ..order_chat_models import OrderConversation, OrderMessage, OrderPushSubscription

DEFAULT_RETENTION_DAYS = 90
DEFAULT_BATCH_SIZE = 100
MAX_BATCH_SIZE = 500


def purge_expired_closed_conversations_in_session(
    db: Session,
    *,
    restaurante_id: int,
    retention_days: int = DEFAULT_RETENTION_DAYS,
    batch_size: int = DEFAULT_BATCH_SIZE,
    now: datetime.datetime | None = None,
) -> dict[str, int]:
    """Remove um lote de conversas encerradas fora da janela de retenção.

    Regras de segurança:
    - somente o tenant informado pode ser afetado;
    - ``closed_at IS NULL`` nunca é elegível;
    - pedidos/comandas não são removidos;
    - o lote elegível é bloqueado na transação para evitar corrida com outro worker;
    - mensagens e assinaturas push são removidas antes da conversa para tornar
      o comportamento determinístico também em SQLite/testes, sem depender de
      ``ON DELETE CASCADE`` estar habilitado no cliente;
    - qualquer divergência entre seleção e delete levanta erro para o chamador
      fazer rollback integral da transação;
    - não faz ``commit``: a transação pertence ao chamador.
    """
    if restaurante_id <= 0:
        raise ValueError("restaurante_id deve ser positivo")
    if retention_days <= 0:
        raise ValueError("retention_days deve ser positivo")
    if batch_size <= 0:
        raise ValueError("batch_size deve ser positivo")

    effective_batch_size = min(batch_size, MAX_BATCH_SIZE)
    reference_time = now or datetime.datetime.now(datetime.timezone.utc)
    if reference_time.tzinfo is None:
        reference_time = reference_time.replace(tzinfo=datetime.timezone.utc)
    cutoff = reference_time - datetime.timedelta(days=retention_days)

    rows = (
        db.query(OrderConversation.id)
        .filter(
            OrderConversation.restaurante_id == restaurante_id,
            OrderConversation.closed_at.isnot(None),
            OrderConversation.closed_at < cutoff,
        )
        .order_by(OrderConversation.closed_at.asc(), OrderConversation.id.asc())
        .limit(effective_batch_size)
        .with_for_update(skip_locked=True)
        .all()
    )
    conversation_ids = [row[0] for row in rows]
    if not conversation_ids:
        return {
            "conversations_deleted": 0,
            "messages_deleted": 0,
            "push_subscriptions_deleted": 0,
        }

    push_subscriptions_deleted = (
        db.query(OrderPushSubscription)
        .filter(
            OrderPushSubscription.restaurante_id == restaurante_id,
            OrderPushSubscription.conversation_id.in_(conversation_ids),
        )
        .delete(synchronize_session=False)
    )
    messages_deleted = (
        db.query(OrderMessage)
        .filter(
            OrderMessage.restaurante_id == restaurante_id,
            OrderMessage.conversation_id.in_(conversation_ids),
        )
        .delete(synchronize_session=False)
    )
    conversations_deleted = (
        db.query(OrderConversation)
        .filter(
            OrderConversation.restaurante_id == restaurante_id,
            OrderConversation.id.in_(conversation_ids),
            OrderConversation.closed_at.isnot(None),
            OrderConversation.closed_at < cutoff,
        )
        .delete(synchronize_session=False)
    )

    if int(conversations_deleted or 0) != len(conversation_ids):
        raise RuntimeError(
            "Retenção de chat abortada: o lote elegível mudou durante a transação."
        )

    return {
        "conversations_deleted": int(conversations_deleted or 0),
        "messages_deleted": int(messages_deleted or 0),
        "push_subscriptions_deleted": int(push_subscriptions_deleted or 0),
    }

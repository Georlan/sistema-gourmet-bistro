"""Serviço de domínio para Gerenciamento de Chat e Acompanhamento de Pedidos.

Centraliza regras de criação de conversas por comanda, segurança de tokens públicos
de alta entropia (SHA-256), validação/idempotência de mensagens humanas,
ciclo de vida (closed_at) e controle de mensagens lidas/não lidas (read tracking).
"""

from __future__ import annotations

import datetime
import hashlib
import html
import secrets
import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, or_, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from ..models import Comanda, Item
from ..order_chat_models import OrderConversation, OrderConversationEvent, OrderMessage
from .order_chat_hub import queue_order_chat_event

CANONICAL_STATUS_MESSAGES = {
    "pendente": "Seu pedido foi recebido pelo restaurante.",
    "producao": "Seu pedido foi confirmado e está em preparo.",
    "pronto": "Seu pedido está pronto!",
    "transito": "Seu pedido saiu para entrega.",
    "finalizado": "Pedido concluído. Bom apetite!",
    "recusado": "O restaurante não conseguiu aceitar este pedido.",
    "cancelado": "Pedido cancelado.",
}

TERMINAL_ORDER_STATUSES = frozenset({"finalizado", "recusado", "cancelado"})
LEGACY_ESCAPED_BODY_FORMAT = "html_escaped_v1"
PLAIN_TEXT_BODY_FORMAT = "plain_text_v2"


def _allocate_feed_seq(db: Session, conversation_id: str) -> int:
    value = db.execute(
        update(OrderConversation)
        .where(OrderConversation.id == conversation_id)
        .values(next_feed_seq=OrderConversation.next_feed_seq + 1)
        .returning(OrderConversation.next_feed_seq - 1)
    ).scalar_one()
    return int(value)


def compute_comanda_total(comanda: Comanda | None) -> float:
    """Calcula com precisão o valor total do pedido a partir dos itens e taxas."""
    if not comanda:
        return 0.0
    itens_total = sum(
        float(getattr(it, "preco_unit", getattr(it, "preco_unitario", 0.0)) or 0.0)
        for it in (comanda.itens or [])
    )
    taxa = float(getattr(comanda, "delivery_taxa", 0.0) or 0.0)
    desconto = float(getattr(comanda, "valor_desconto_cupom", 0.0) or 0.0) + float(
        getattr(comanda, "valor_desconto_cashback", 0.0) or 0.0
    )
    return round(max(0.0, itens_total + taxa - desconto), 2)


def hash_token(raw_token: str) -> str:
    """Calcula o hash SHA-256 seguro de um token de acompanhamento."""
    return hashlib.sha256(raw_token.strip().encode("utf-8")).hexdigest()


def generate_secure_tracking_token() -> tuple[str, str]:
    """Gera um token criptográfico de alta entropia e seu hash para armazenamento."""
    raw_token = secrets.token_urlsafe(32)
    token_hash = hash_token(raw_token)
    return raw_token, token_hash


def sanitize_message_body(raw_body: str) -> str:
    """Valida e normaliza texto sem persistir entidades HTML.

    Segurança de apresentação pertence ao renderer: consumidores web devem renderizar
    ``body`` como texto React, nunca como HTML confiável. Mensagens históricas escapadas
    são identificadas por ``body_format`` e decodificadas somente na serialização.
    """
    if not raw_body or not isinstance(raw_body, str):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A mensagem não pode ser vazia.",
        )
    trimmed = raw_body.strip()
    if not trimmed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A mensagem não pode ser vazia.",
        )
    if len(trimmed) > 1000:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A mensagem pode conter no máximo 1000 caracteres.",
        )
    return trimmed


def assert_conversation_writable(conv: OrderConversation) -> None:
    """Barreira única de escrita para cliente e equipe.

    ``closed_at`` deixa de representar uma janela futura de pós-venda: qualquer valor
    não nulo significa histórico read-only. Isso também encerra imediatamente as
    conversas antigas que ainda carregavam um ``closed_at`` agendado no futuro.
    """
    if conv.closed_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="O atendimento deste pedido já foi encerrado.",
        )



def _chat_savepoint(db: Session):
    # Python's SQLite legacy mode does not BEGIN for SELECT/SAVEPOINT. Ensure
    # RELEASE cannot accidentally commit an insertion before the outer commit.
    if db.get_bind().dialect.name == "sqlite":
        connection = db.connection()
        if not connection.connection.driver_connection.in_transaction:
            connection.exec_driver_sql("BEGIN")
    return db.begin_nested()


def _normalize_client_message_id(client_message_id: str | None) -> str | None:
    """Valida e canonicaliza a chave idempotente gerada pelo remetente."""
    raw = (client_message_id or "").strip()
    if not raw:
        return None
    try:
        return str(uuid.UUID(raw))
    except (ValueError, AttributeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Identificador idempotente da mensagem é inválido.",
        ) from exc


def _existing_human_message(
    db: Session,
    *,
    conversation_id: str,
    sender_type: str,
    client_message_id: str | None,
) -> OrderMessage | None:
    if not client_message_id:
        return None
    # Compatibilidade de rollout: versões imediatamente anteriores codificavam
    # a chave humana em event_key. Novas mensagens nunca voltam a gravar ali.
    legacy_event_key = f"{sender_type}:{client_message_id}"
    existing = (
        db.query(OrderMessage)
        .filter(
            OrderMessage.conversation_id == conversation_id,
            or_(
                OrderMessage.client_message_id == client_message_id,
                OrderMessage.event_key == legacy_event_key,
            ),
        )
        .first()
    )

    if existing is not None and existing.sender_type != sender_type:
        raise HTTPException(status_code=409, detail="Identificador da mensagem já utilizado por outro remetente.")
    return existing


def create_conversation_for_order(
    db: Session,
    restaurante_id: int,
    pedido_id: str,
) -> tuple[OrderConversation, str | None]:
    """Cria a conversa atômica para um pedido caso ainda não exista.

    Retorna a conversa e o token bruto somente na criação (raw_token).
    Em consultas idempotentes subsequentes, o raw_token retornado é None.
    """
    existing = (
        db.query(OrderConversation)
        .filter(
            OrderConversation.restaurante_id == restaurante_id,
            OrderConversation.pedido_id == pedido_id,
        )
        .first()
    )
    if existing:
        return existing, None

    raw_token, token_hash = generate_secure_tracking_token()
    now = datetime.datetime.now(datetime.timezone.utc)

    conv = OrderConversation(
        id=str(uuid.uuid4()),
        restaurante_id=restaurante_id,
        pedido_id=pedido_id,
        public_access_token_hash=token_hash,
        created_at=now,
        updated_at=now,
    )
    db.add(conv)
    db.flush()

    # Status do pedido não é mensagem. O painel deriva "Recebido" do estado
    # canônico da Comanda, evitando uma linha redundante por pedido.
    return conv, raw_token


def resolve_public_tracking(
    db: Session,
    raw_token: str,
) -> tuple[int, str, str, datetime.datetime | None] | None:
    """Descobre restaurante_id, conversation_id e pedido_id a partir do token público.

    Executa via helper SECURITY DEFINER em PostgreSQL para não exigir concessões
    globais de SELECT em toda a tabela pela role koma_app.
    Retorna None se o token for inválido, sem vazar IDs.
    """
    token = (raw_token or "").strip()
    if not token or len(token) < 16:
        return None

    token_hash = hash_token(token)

    if db.get_bind().dialect.name == "postgresql":
        row = db.execute(
            text(
                "SELECT restaurante_id, conversation_id, pedido_id, closed_at "
                "FROM koma_internal.resolve_public_tracking_token(:hash)"
            ),
            {"hash": token_hash},
        ).mappings().first()
    else:
        row = db.execute(
            text(
                "SELECT restaurante_id, id AS conversation_id, pedido_id, closed_at "
                "FROM order_conversations "
                "WHERE public_access_token_hash = :hash "
                "LIMIT 1"
            ),
            {"hash": token_hash},
        ).mappings().first()

    if not row:
        return None

    return (
        int(row["restaurante_id"]),
        str(row["conversation_id"]),
        str(row["pedido_id"]),
        row["closed_at"],
    )


def post_system_order_event(
    db: Session,
    restaurante_id: int,
    pedido_id: str,
    new_status: str,
) -> dict[str, Any] | None:
    """Persiste a projeção da transição no feed, separada de mensagens humanas.

    O status continua pertencendo à Comanda. O evento SSE é apenas um hint
    transacional e só deixa o banco depois do commit via PostgreSQL NOTIFY
    (ou after_commit em SQLite/testes).
    """
    conv = (
        db.query(OrderConversation)
        .filter(
            OrderConversation.restaurante_id == restaurante_id,
            OrderConversation.pedido_id == pedido_id,
        )
        .first()
    )
    if not conv:
        return None

    norm_status = (new_status or "").strip().lower()
    if not norm_status:
        return None

    now = datetime.datetime.now(datetime.timezone.utc)
    if norm_status in TERMINAL_ORDER_STATUSES and conv.closed_at is None:
        conv.closed_at = now
    event = append_order_feed_event(
        db, conv=conv, event_key=f"status:{norm_status}", order_status=norm_status,
        body=CANONICAL_STATUS_MESSAGES.get(norm_status, f"Status do pedido atualizado: {norm_status}."),
    )
    return {"status": norm_status, "body": event.body,
            "closed_at": conv.closed_at.isoformat() if conv.closed_at else None}


def append_order_feed_event(
    db: Session, *, conv: OrderConversation, event_key: str,
    body: str, order_status: str | None = None,
) -> OrderConversationEvent:
    existing = db.query(OrderConversationEvent).filter_by(
        restaurante_id=conv.restaurante_id, conversation_id=conv.id, event_key=event_key,
    ).first()
    if existing is not None:
        return existing
    event = OrderConversationEvent(
        restaurante_id=conv.restaurante_id, conversation_id=conv.id,
        pedido_id=conv.pedido_id, event_key=event_key, status=order_status, body=body,
        feed_seq=_allocate_feed_seq(db, conv.id),
    )
    try:
        with _chat_savepoint(db):
            db.add(event)
            db.flush()
    except IntegrityError:
        existing = db.query(OrderConversationEvent).filter_by(
            restaurante_id=conv.restaurante_id, conversation_id=conv.id, event_key=event_key,
        ).first()
        if existing is None:
            raise
        return existing
    queue_order_chat_event(db, restaurante_id=conv.restaurante_id,
                          conversation_id=conv.id, kind="status", data={"event_id": event.id})
    return event


def serialize_feed_event(event: OrderConversationEvent) -> dict[str, Any]:
    return {
        "id": event.id, "kind": "order_event", "sender_type": "system",
        "conversation_id": event.conversation_id, "pedido_id": event.pedido_id,
        "status": event.status, "event_key": event.event_key,
        "body": html.unescape(event.body) if event.body_format == LEGACY_ESCAPED_BODY_FORMAT else event.body,
        "created_at": event.created_at.isoformat() if event.created_at else None,
        "seq": event.feed_seq or 0,
    }


def send_customer_message(
    db: Session,
    restaurante_id: int,
    conversation_id: str,
    pedido_id: str,
    raw_body: str,
    client_message_id: str | None = None,
) -> OrderMessage:
    """Valida e persiste uma mensagem enviada pelo cliente no Cardápio."""
    body = sanitize_message_body(raw_body)
    now = datetime.datetime.now(datetime.timezone.utc)

    conv = (
        db.query(OrderConversation)
        .filter(
            OrderConversation.restaurante_id == restaurante_id,
            OrderConversation.id == conversation_id,
        )
        .first()
    )
    if not conv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversa não encontrada.",
        )
    normalized_client_message_id = _normalize_client_message_id(client_message_id)
    existing = _existing_human_message(
        db,
        conversation_id=conv.id,
        sender_type="customer",
        client_message_id=normalized_client_message_id,
    )
    if existing is not None:
        return existing
    assert_conversation_writable(conv)

    one_minute_ago = now - datetime.timedelta(minutes=1)
    recent_count = (
        db.query(func.count(OrderMessage.id))
        .filter(
            OrderMessage.conversation_id == conv.id,
            OrderMessage.sender_type == "customer",
            OrderMessage.created_at >= one_minute_ago,
        )
        .scalar()
        or 0
    )
    if recent_count >= 10:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Muitas mensagens enviadas. Por favor, aguarde alguns instantes.",
        )

    msg = OrderMessage(
        id=str(uuid.uuid4()),
        restaurante_id=restaurante_id,
        conversation_id=conv.id,
        pedido_id=pedido_id,
        sender_type="customer",
        sender_user_id=None,
        body=body,
        body_format=PLAIN_TEXT_BODY_FORMAT,
        client_message_id=normalized_client_message_id,
        created_at=now,
        feed_seq=_allocate_feed_seq(db, conv.id),
    )
    try:
        with _chat_savepoint(db):
            db.add(msg)
            conv.updated_at = now
            db.flush()
    except IntegrityError:
        existing = _existing_human_message(
            db,
            conversation_id=conv.id,
            sender_type="customer",
            client_message_id=normalized_client_message_id,
        )
        if existing is not None:
            return existing
        raise

    queue_order_chat_event(
        db,
        restaurante_id=restaurante_id,
        conversation_id=conv.id,
        kind="message",
        data={"message_id": msg.id},
    )
    return msg


def send_staff_message(
    db: Session,
    restaurante_id: int,
    conversation_id: str,
    user_id: int,
    raw_body: str,
    client_message_id: str | None = None,
) -> OrderMessage:
    """Valida e persiste uma resposta enviada pelo atendente/operador do Caixa."""
    body = sanitize_message_body(raw_body)
    now = datetime.datetime.now(datetime.timezone.utc)

    conv = (
        db.query(OrderConversation)
        .filter(
            OrderConversation.restaurante_id == restaurante_id,
            OrderConversation.id == conversation_id,
        )
        .first()
    )
    if not conv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversa não encontrada.",
        )
    normalized_client_message_id = _normalize_client_message_id(client_message_id)
    existing = _existing_human_message(
        db,
        conversation_id=conv.id,
        sender_type="staff",
        client_message_id=normalized_client_message_id,
    )
    if existing is not None:
        return existing
    assert_conversation_writable(conv)

    msg = OrderMessage(
        id=str(uuid.uuid4()),
        restaurante_id=restaurante_id,
        conversation_id=conv.id,
        pedido_id=conv.pedido_id,
        sender_type="staff",
        sender_user_id=user_id,
        body=body,
        body_format=PLAIN_TEXT_BODY_FORMAT,
        client_message_id=normalized_client_message_id,
        created_at=now,
        feed_seq=_allocate_feed_seq(db, conv.id),
    )
    try:
        with _chat_savepoint(db):
            db.add(msg)
            conv.updated_at = now
            db.flush()
    except IntegrityError:
        existing = _existing_human_message(
            db,
            conversation_id=conv.id,
            sender_type="staff",
            client_message_id=normalized_client_message_id,
        )
        if existing is not None:
            return existing
        raise

    queue_order_chat_event(
        db,
        restaurante_id=restaurante_id,
        conversation_id=conv.id,
        kind="message",
        data={"message_id": msg.id},
    )
    # Only a newly inserted message creates delivery side effects. A retry
    # returns above, including when the original HTTP response was lost.
    from .web_push import enqueue_order_push_event
    enqueue_order_push_event(
        db, restaurante_id=restaurante_id, pedido_id=conv.pedido_id,
        conversation_id=conv.id, kind="message", message_id=msg.id,
    )
    return msg


def _advance_read_watermark(
    db: Session,
    *,
    restaurante_id: int,
    conversation_id: str,
    reader: str,
) -> datetime.datetime | None:
    """Avança leitura somente até a última mensagem oposta já observável no banco.

    O watermark usa o timestamp da própria mensagem, não o relógio atual. Assim
    uma mensagem concorrente que ainda não foi observada pelo request de leitura
    não é marcada como lida por acidente. Requests repetidos sem novidade viram
    no-op: não fazem UPDATE e não publicam evento realtime.
    """
    if reader not in {"customer", "staff"}:
        raise ValueError("reader inválido")

    conv = (
        db.query(OrderConversation)
        .filter(
            OrderConversation.restaurante_id == restaurante_id,
            OrderConversation.id == conversation_id,
        )
        .first()
    )
    if conv is None:
        return None

    sender_type = "staff" if reader == "customer" else "customer"
    watermark_attr = "customer_last_read_at" if reader == "customer" else "staff_last_read_at"
    current_watermark = getattr(conv, watermark_attr)

    latest_query = db.query(func.max(OrderMessage.created_at)).filter(
        OrderMessage.restaurante_id == restaurante_id,
        OrderMessage.conversation_id == conversation_id,
        OrderMessage.sender_type == sender_type,
    )
    if current_watermark is not None:
        latest_query = latest_query.filter(OrderMessage.created_at > current_watermark)

    latest_visible = latest_query.scalar()
    if latest_visible is None:
        return None

    setattr(conv, watermark_attr, latest_visible)
    db.flush()
    queue_order_chat_event(
        db,
        restaurante_id=restaurante_id,
        conversation_id=conv.id,
        kind="read",
        data={"reader": reader, "last_read_at": latest_visible.isoformat()},
    )
    return latest_visible


def mark_customer_read(
    db: Session,
    restaurante_id: int,
    conversation_id: str,
) -> bool:
    """Marca apenas respostas da equipe realmente observáveis pelo cliente."""
    return _advance_read_watermark(
        db,
        restaurante_id=restaurante_id,
        conversation_id=conversation_id,
        reader="customer",
    ) is not None


def mark_staff_read(
    db: Session,
    restaurante_id: int,
    conversation_id: str,
) -> bool:
    """Marca apenas mensagens do cliente realmente observáveis pela equipe."""
    return _advance_read_watermark(
        db,
        restaurante_id=restaurante_id,
        conversation_id=conversation_id,
        reader="staff",
    ) is not None

def serialize_message(msg: OrderMessage) -> dict[str, Any]:
    """Serializa mensagem como texto; converte somente o legado HTML-escaped."""
    body = msg.body
    if getattr(msg, "body_format", None) == LEGACY_ESCAPED_BODY_FORMAT:
        body = html.unescape(body)
    return {
        "id": msg.id,
        "kind": "message",
        "conversation_id": msg.conversation_id,
        "pedido_id": msg.pedido_id,
        "sender_type": msg.sender_type,
        "sender_user_id": msg.sender_user_id,
        "body": body,
        "client_message_id": getattr(msg, "client_message_id", None),
        "event_key": msg.event_key,
        "created_at": msg.created_at.isoformat() if msg.created_at else None,
        "seq": msg.feed_seq or 0,
    }



def list_recent_messages(
    db: Session,
    *,
    restaurante_id: int,
    conversation_id: str,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Retorna a cauda cronológica da conversa com limite rígido de leitura."""
    return list_feed_page(db, restaurante_id=restaurante_id,
                          conversation_id=conversation_id, limit=limit)["items"]


def list_feed_page(
    db: Session, *, restaurante_id: int, conversation_id: str, limit: int = 50,
    before_seq: int | None = None, after_seq: int | None = None,
) -> dict[str, Any]:
    """Lê uma página estável; ``after`` reconcilia SSE e ``before`` pagina."""
    if before_seq is not None and after_seq is not None:
        raise HTTPException(status_code=422, detail="Use before_seq ou after_seq, não ambos.")
    bounded_limit = max(1, min(int(limit), 100))

    def fetch(model):
        query = db.query(model).filter(model.restaurante_id == restaurante_id,
                                       model.conversation_id == conversation_id)
        if after_seq is not None:
            query = query.filter(model.feed_seq > after_seq).order_by(model.feed_seq.asc())
        elif before_seq is not None:
            query = query.filter(model.feed_seq < before_seq).order_by(model.feed_seq.desc())
        else:
            query = query.order_by(model.feed_seq.desc())
        return query.limit(bounded_limit + 1).all()

    feed = ([serialize_message(row) for row in fetch(OrderMessage)]
            + [serialize_feed_event(row) for row in fetch(OrderConversationEvent)])
    descending = after_seq is None
    feed.sort(key=lambda item: item["seq"], reverse=descending)
    has_more = len(feed) > bounded_limit
    selected = feed[:bounded_limit]
    if descending:
        selected.reverse()
    conv = db.query(OrderConversation).filter_by(
        restaurante_id=restaurante_id, id=conversation_id,
    ).first()
    return {
        "items": selected,
        "has_more": has_more,
        "oldest_seq": selected[0]["seq"] if selected else None,
        "latest_seq": selected[-1]["seq"] if selected else None,
        "purged_at": conv.chat_purged_at.isoformat() if conv and conv.chat_purged_at else None,
    }

def list_caixa_conversations(
    db: Session,
    restaurante_id: int,
) -> list[dict[str, Any]]:
    """Lista conversas ativas sem consultas N+1 por thread."""
    conversations = (
        db.query(OrderConversation)
        .options(
            joinedload(OrderConversation.comanda).joinedload(Comanda.cliente),
        )
        .filter(
            OrderConversation.restaurante_id == restaurante_id,
            OrderConversation.closed_at.is_(None),
        )
        .order_by(OrderConversation.updated_at.desc())
        .limit(150)
        .all()
    )
    if not conversations:
        return []

    conversation_ids = [conv.id for conv in conversations]
    comanda_ids = [conv.pedido_id for conv in conversations]
    item_total_rows = (
        db.query(Item.comanda_id, func.coalesce(func.sum(Item.preco_unit), 0.0))
        .filter(
            Item.restaurante_id == restaurante_id,
            Item.comanda_id.in_(comanda_ids),
        )
        .group_by(Item.comanda_id)
        .all()
    )
    item_total_by_comanda = {
        str(comanda_id): float(total or 0.0)
        for comanda_id, total in item_total_rows
    }

    unread_rows = (
        db.query(OrderMessage.conversation_id, func.count(OrderMessage.id))
        .join(OrderConversation, OrderConversation.id == OrderMessage.conversation_id)
        .filter(
            OrderConversation.restaurante_id == restaurante_id,
            OrderConversation.closed_at.is_(None),
            OrderMessage.conversation_id.in_(conversation_ids),
            OrderMessage.sender_type == "customer",
            or_(
                OrderConversation.staff_last_read_at.is_(None),
                OrderMessage.created_at > OrderConversation.staff_last_read_at,
            ),
        )
        .group_by(OrderMessage.conversation_id)
        .all()
    )
    unread_by_conversation = {
        str(conversation_id): int(count or 0)
        for conversation_id, count in unread_rows
    }

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
    last_by_conversation = {msg.conversation_id: msg for msg in last_messages}

    results: list[dict[str, Any]] = []
    for conv in conversations:
        comanda = conv.comanda
        last_msg = last_by_conversation.get(conv.id)

        client_name = "Cliente"
        if comanda:
            try:
                if comanda.cliente_id and getattr(comanda, "cliente", None):
                    client_name = getattr(comanda.cliente, "nome", None) or "Cliente"
                elif getattr(comanda, "identificador", None):
                    client_name = comanda.identificador or "Cliente"
            except Exception:
                client_name = "Cliente"

        results.append({
            "id": conv.id,
            "pedido_id": conv.pedido_id,
            "numero_pedido": comanda.numero_pedido if comanda else None,
            "cliente_nome": client_name,
            "tipo_pedido": comanda.tipo if comanda else "Delivery",
            "status_pedido": comanda.delivery_status if comanda else "pendente",
            "total_pedido": (
                round(
                    max(
                        0.0,
                        item_total_by_comanda.get(conv.pedido_id, 0.0)
                        + float(getattr(comanda, "delivery_taxa", 0.0) or 0.0)
                        - float(getattr(comanda, "valor_desconto_cupom", 0.0) or 0.0)
                        - float(getattr(comanda, "valor_desconto_cashback", 0.0) or 0.0),
                    ),
                    2,
                )
                if comanda
                else 0.0
            ),
            "unread_count": unread_by_conversation.get(conv.id, 0),
            "closed_at": None,
            "updated_at": conv.updated_at.isoformat() if conv.updated_at else None,
            "last_message": serialize_message(last_msg) if last_msg else None,
        })

    return results


def get_caixa_unread_summary(db: Session, restaurante_id: int) -> int:
    """Calcula não lidas em uma única query agregada e apenas no hot path ativo."""
    total = (
        db.query(func.count(OrderMessage.id))
        .join(OrderConversation, OrderConversation.id == OrderMessage.conversation_id)
        .filter(
            OrderConversation.restaurante_id == restaurante_id,
            OrderConversation.closed_at.is_(None),
            OrderMessage.sender_type == "customer",
            or_(
                OrderConversation.staff_last_read_at.is_(None),
                OrderMessage.created_at > OrderConversation.staff_last_read_at,
            ),
        )
        .scalar()
        or 0
    )
    return int(total)

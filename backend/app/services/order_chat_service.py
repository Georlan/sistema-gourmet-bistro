"""Serviço de domínio para Gerenciamento de Chat e Acompanhamento de Pedidos.

Centraliza regras de criação de conversas por comanda, segurança de tokens públicos
de alta entropia (SHA-256), validação de texto, idempotência de mensagens de sistema,
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
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session, joinedload

from ..models import Comanda
from ..order_chat_models import OrderConversation, OrderMessage
from .order_chat_hub import order_chat_hub

CANONICAL_STATUS_MESSAGES = {
    "pendente": "Seu pedido foi recebido pelo restaurante.",
    "producao": "Seu pedido foi confirmado e está em preparo.",
    "pronto": "Seu pedido está pronto!",
    "transito": "Seu pedido saiu para entrega.",
    "finalizado": "Pedido concluído. Bom apetite!",
    "recusado": "O restaurante não conseguiu aceitar este pedido.",
}

TERMINAL_ORDER_STATUSES = frozenset({"finalizado", "recusado"})
LEGACY_ESCAPED_BODY_FORMAT = "html_escaped_v1"
PLAIN_TEXT_BODY_FORMAT = "plain_text_v2"


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

    initial_msg = OrderMessage(
        id=str(uuid.uuid4()),
        restaurante_id=restaurante_id,
        conversation_id=conv.id,
        pedido_id=pedido_id,
        sender_type="system",
        body="Seu pedido foi recebido pelo restaurante.",
        body_format=PLAIN_TEXT_BODY_FORMAT,
        event_key="order_created",
        created_at=now,
    )
    db.add(initial_msg)
    db.flush()

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
) -> OrderMessage | None:
    """Emite uma mensagem automática de transição da máquina de estados do pedido."""
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
    event_key = f"status:{norm_status}"

    existing_msg = (
        db.query(OrderMessage)
        .filter(
            OrderMessage.conversation_id == conv.id,
            OrderMessage.event_key == event_key,
        )
        .first()
    )
    if existing_msg:
        return existing_msg

    body = CANONICAL_STATUS_MESSAGES.get(
        norm_status,
        f"Status do pedido atualizado: {norm_status}.",
    )
    now = datetime.datetime.now(datetime.timezone.utc)

    msg = OrderMessage(
        id=str(uuid.uuid4()),
        restaurante_id=restaurante_id,
        conversation_id=conv.id,
        pedido_id=pedido_id,
        sender_type="system",
        body=body,
        body_format=PLAIN_TEXT_BODY_FORMAT,
        event_key=event_key,
        created_at=now,
    )
    try:
        with db.begin_nested():
            db.add(msg)
            conv.updated_at = now
            if norm_status in TERMINAL_ORDER_STATUSES:
                conv.closed_at = now
            db.flush()
    except Exception:
        existing = (
            db.query(OrderMessage)
            .filter(
                OrderMessage.conversation_id == conv.id,
                OrderMessage.event_key == event_key,
            )
            .first()
        )
        if existing:
            return existing
        return None

    msg_payload = serialize_message(msg)
    order_chat_hub.publish_message(restaurante_id, conv.id, msg_payload)
    order_chat_hub.publish_status(
        restaurante_id,
        conv.id,
        {
            "status": norm_status,
            "body": body,
            "closed_at": conv.closed_at.isoformat() if conv.closed_at else None,
        },
    )

    return msg


def send_customer_message(
    db: Session,
    restaurante_id: int,
    conversation_id: str,
    pedido_id: str,
    raw_body: str,
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
        created_at=now,
    )
    db.add(msg)
    conv.updated_at = now
    conv.customer_last_read_at = now
    db.flush()

    msg_payload = serialize_message(msg)
    order_chat_hub.publish_message(restaurante_id, conv.id, msg_payload)

    return msg


def send_staff_message(
    db: Session,
    restaurante_id: int,
    conversation_id: str,
    user_id: int,
    raw_body: str,
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
        created_at=now,
    )
    db.add(msg)
    conv.updated_at = now
    conv.staff_last_read_at = now
    db.flush()

    msg_payload = serialize_message(msg)
    order_chat_hub.publish_message(restaurante_id, conv.id, msg_payload)

    return msg


def mark_customer_read(
    db: Session,
    restaurante_id: int,
    conversation_id: str,
) -> None:
    """Atualiza o timestamp de leitura do cliente para o momento atual."""
    now = datetime.datetime.now(datetime.timezone.utc)
    conv = (
        db.query(OrderConversation)
        .filter(
            OrderConversation.restaurante_id == restaurante_id,
            OrderConversation.id == conversation_id,
        )
        .first()
    )
    if conv:
        conv.customer_last_read_at = now
        db.flush()
        order_chat_hub.publish_read(
            restaurante_id,
            conv.id,
            {"reader": "customer", "last_read_at": now.isoformat()},
        )


def mark_staff_read(
    db: Session,
    restaurante_id: int,
    conversation_id: str,
) -> None:
    """Atualiza o timestamp de leitura do operador do restaurante para o momento atual."""
    now = datetime.datetime.now(datetime.timezone.utc)
    conv = (
        db.query(OrderConversation)
        .filter(
            OrderConversation.restaurante_id == restaurante_id,
            OrderConversation.id == conversation_id,
        )
        .first()
    )
    if conv:
        conv.staff_last_read_at = now
        db.flush()
        order_chat_hub.publish_read(
            restaurante_id,
            conv.id,
            {"reader": "staff", "last_read_at": now.isoformat()},
        )


def serialize_message(msg: OrderMessage) -> dict[str, Any]:
    """Serializa mensagem como texto; converte somente o legado HTML-escaped."""
    body = msg.body
    if getattr(msg, "body_format", None) == LEGACY_ESCAPED_BODY_FORMAT:
        body = html.unescape(body)
    return {
        "id": msg.id,
        "conversation_id": msg.conversation_id,
        "pedido_id": msg.pedido_id,
        "sender_type": msg.sender_type,
        "sender_user_id": msg.sender_user_id,
        "body": body,
        "event_key": msg.event_key,
        "created_at": msg.created_at.isoformat() if msg.created_at else None,
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
            joinedload(OrderConversation.comanda).joinedload(Comanda.itens),
        )
        .filter(
            OrderConversation.restaurante_id == restaurante_id,
            OrderConversation.closed_at.is_(None),
        )
        .order_by(OrderConversation.updated_at.desc())
        .limit(50)
        .all()
    )
    if not conversations:
        return []

    conversation_ids = [conv.id for conv in conversations]

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
            "total_pedido": compute_comanda_total(comanda),
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

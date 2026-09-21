"""Rotas públicas do Cardápio para Acompanhamento de Pedidos e Chat com o Restaurante.

Segurança P0:
- Consulta exclusivamente por token de alta entropia (/acompanhar/{token}).
- Nenhuma exposição de IDs sequenciais ou enumeração de pedidos.
- Zero dependência de autenticação do cliente.
- Isolamento multi-tenant garantido por tenant_session_scope.
- Flood de mensagens limitado por conversa e IP, com chaves persistidas somente em hash.
"""

from __future__ import annotations

import asyncio
import datetime
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, selectinload

from ..database import SessionLocal, get_db, tenant_session_scope
from ..models import Comanda, Item, Restaurante
from ..online_order_control_models import OnlineOrderCustomerBlock
from ..order_chat_models import OrderConversation, OrderMessage
from ..services.clientes import normalizar_telefone_cliente
from ..services.customer_auth import hash_public_rate_key
from ..services.order_chat_hub import order_chat_hub
from ..services.order_chat_service import (
    compute_comanda_total,
    list_feed_page,
    list_recent_messages,
    mark_customer_read,
    resolve_public_tracking,
    send_customer_message,
    serialize_message,
)
from ..services.order_state_contract import build_order_state_contract
from ..services.public_orders import client_ip, consume_rate_limit
from ..services.web_push import (
    disable_order_push_subscription,
    get_web_push_config,
    upsert_order_push_subscription,
)

router = APIRouter(prefix="/api/cardapio/pedidos/acompanhar", tags=["Cardapio - Acompanhamento"])


class CustomerMessagePayload(BaseModel):
    body: str = Field(..., min_length=1, max_length=1000, description="Texto da mensagem")
    client_message_id: str | None = Field(default=None, min_length=36, max_length=36)


class PushSubscriptionKeysPayload(BaseModel):
    p256dh: str = Field(..., min_length=16, max_length=512)
    auth: str = Field(..., min_length=8, max_length=256)


class PushSubscriptionPayload(BaseModel):
    endpoint: str = Field(..., min_length=16, max_length=4096)
    expirationTime: int | None = None
    keys: PushSubscriptionKeysPayload


class PushUnsubscribePayload(BaseModel):
    endpoint: str = Field(..., min_length=16, max_length=4096)


def _sse_event(event_name: str, payload: dict[str, Any]) -> str:
    return f"event: {event_name}\ndata: {json.dumps(payload, separators=(',', ':'))}\n\n"


def _effective_tracking_status_values(delivery_status: Any, fechada: Any) -> str:
    raw_status = str(delivery_status or "pendente").strip().lower()
    if raw_status in {"recusado", "rejected", "cancelado", "cancelled"}:
        return raw_status
    if bool(fechada):
        return "finalizado"
    return raw_status


def _effective_tracking_status(comanda: Comanda) -> str:
    return _effective_tracking_status_values(comanda.delivery_status, comanda.fechada)


def _iso_or_none(value: Any) -> str | None:
    """Serializa timestamps vindos tanto do ORM/PostgreSQL quanto de SQL textual/SQLite."""
    if value is None:
        return None
    if isinstance(value, datetime.datetime):
        return value.isoformat()
    raw = str(value).strip()
    return raw or None


def _active_ordering_block(
    db: Session,
    *,
    restaurante_id: int,
    comanda: Comanda,
) -> dict[str, Any] | None:
    """Retorna o bloqueio ativo somente no contexto do token seguro do pedido.

    A rota nunca aceita telefone como chave pública. A identidade é derivada da
    própria comanda já resolvida pelo capability token e usa exatamente o mesmo
    fingerprint tenant-local adotado pela barreira autoritativa de criação.
    """
    identity_filters = []
    cliente_id = getattr(comanda, "cliente_id", None)
    if cliente_id:
        identity_filters.append(OnlineOrderCustomerBlock.cliente_id == cliente_id)

    raw_phone = getattr(comanda, "delivery_telefone", None)
    if raw_phone:
        try:
            normalized_phone = normalizar_telefone_cliente(raw_phone)
            phone_hash = hash_public_rate_key(
                restaurante_id,
                "online_order_customer_block",
                normalized_phone,
            )
            identity_filters.append(OnlineOrderCustomerBlock.phone_hash == phone_hash)
        except ValueError:
            pass

    if not identity_filters:
        return None

    blocks = (
        db.query(OnlineOrderCustomerBlock)
        .filter(
            OnlineOrderCustomerBlock.restaurante_id == restaurante_id,
            OnlineOrderCustomerBlock.active.is_(True),
            or_(*identity_filters),
        )
        .order_by(OnlineOrderCustomerBlock.created_at.desc())
        .all()
    )
    now = datetime.datetime.now(datetime.timezone.utc)
    for block in blocks:
        expires_at = block.expires_at
        if expires_at is not None and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=datetime.timezone.utc)
        if expires_at is not None and expires_at <= now:
            continue

        created_at = block.created_at
        if created_at is not None and created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=datetime.timezone.utc)
        return {
            "active": True,
            "reason": block.reason,
            "created_at": created_at.isoformat() if created_at else None,
            "expires_at": expires_at.isoformat() if expires_at else None,
        }
    return None


@router.get("/{token}/summary", summary="Resumo leve e seguro do acompanhamento do pedido")
def consultar_resumo_pedido_por_token(
    token: str,
    db: Session = Depends(get_db),
):
    """Projeção quente para realtime/fallback sem carregar itens, produto ou restaurante."""
    resolved = resolve_public_tracking(db, token)
    if not resolved:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pedido não encontrado.")

    restaurante_id, conversation_id, pedido_id, _resolved_closed_at = resolved
    with tenant_session_scope(db, restaurante_id):
        row = (
            db.query(
                Comanda.id.label("id"),
                Comanda.delivery_status.label("delivery_status"),
                Comanda.tipo.label("tipo"),
                Comanda.fechada.label("fechada"),
                OrderConversation.closed_at.label("closed_at"),
                OrderConversation.customer_last_read_at.label("customer_last_read_at"),
                func.count(OrderMessage.id).label("customer_unread_count"),
            )
            .join(
                OrderConversation,
                and_(
                    OrderConversation.restaurante_id == Comanda.restaurante_id,
                    OrderConversation.pedido_id == Comanda.id,
                    OrderConversation.id == conversation_id,
                ),
            )
            .outerjoin(
                OrderMessage,
                and_(
                    OrderMessage.restaurante_id == OrderConversation.restaurante_id,
                    OrderMessage.conversation_id == OrderConversation.id,
                    OrderMessage.sender_type == "staff",
                    or_(
                        OrderConversation.customer_last_read_at.is_(None),
                        OrderMessage.created_at > OrderConversation.customer_last_read_at,
                    ),
                ),
            )
            .filter(
                Comanda.restaurante_id == restaurante_id,
                Comanda.id == pedido_id,
            )
            .group_by(
                Comanda.id,
                Comanda.delivery_status,
                Comanda.tipo,
                Comanda.fechada,
                OrderConversation.closed_at,
                OrderConversation.customer_last_read_at,
            )
            .first()
        )
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pedido não encontrado.")

        closed_at_iso = _iso_or_none(row.closed_at)
        effective_status = _effective_tracking_status_values(row.delivery_status, row.fechada)
        state_contract = build_order_state_contract(
            effective_status,
            row.tipo,
            conversation_closed=row.closed_at is not None,
        )
        return {
            "id": str(row.id),
            "status": effective_status,
            "state": state_contract,
            "tipo": row.tipo or "Delivery",
            "fechada": bool(row.fechada),
            "closed_at": closed_at_iso,
            "conversa": {
                "id": conversation_id,
                "closed_at": closed_at_iso,
                "unread_count": int(row.customer_unread_count or 0),
                "can_chat": state_contract["can_chat"],
            },
        }


@router.get("/{token}", summary="Consulta segura dos dados de acompanhamento do pedido")
def consultar_pedido_por_token(
    token: str,
    db: Session = Depends(get_db),
):
    resolved = resolve_public_tracking(db, token)
    if not resolved:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pedido não encontrado.")

    restaurante_id, conversation_id, pedido_id, closed_at = resolved
    with tenant_session_scope(db, restaurante_id):
        comanda = (
            db.query(Comanda)
            .options(selectinload(Comanda.itens).joinedload(Item.produto))
            .filter(Comanda.restaurante_id == restaurante_id, Comanda.id == pedido_id)
            .first()
        )
        if not comanda:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pedido não encontrado.")

        restaurante = db.query(Restaurante).filter(Restaurante.id == restaurante_id).first()
        conversation = (
            db.query(OrderConversation)
            .filter(
                OrderConversation.restaurante_id == restaurante_id,
                OrderConversation.id == conversation_id,
            )
            .first()
        )
        customer_unread_count = 0
        if conversation:
            unread_query = db.query(func.count(OrderMessage.id)).filter(
                OrderMessage.restaurante_id == restaurante_id,
                OrderMessage.conversation_id == conversation_id,
                OrderMessage.sender_type == "staff",
            )
            if conversation.customer_last_read_at:
                unread_query = unread_query.filter(OrderMessage.created_at > conversation.customer_last_read_at)
            customer_unread_count = int(unread_query.scalar() or 0)

        itens_payload = [
            {
                "id": it.id,
                "nome": it.produto.nome if it.produto else "Item",
                "quantidade": 1,
                "preco_unitario": float(it.preco_unit or 0.0),
                "observacao": it.observacao,
            }
            for it in comanda.itens
            if it.status != "cancelado"
        ]

        closed_at_iso = _iso_or_none(closed_at)
        effective_status = _effective_tracking_status(comanda)
        state_contract = build_order_state_contract(
            effective_status,
            comanda.tipo,
            conversation_closed=closed_at is not None,
        )
        return {
            "id": comanda.id,
            "numero_pedido": comanda.numero_pedido,
            # Compatibilidade legada. Clientes novos devem consumir `state`.
            "status": effective_status,
            "state": state_contract,
            "tipo": comanda.tipo or "Delivery",
            "total": compute_comanda_total(comanda),
            "endereco_entrega": getattr(comanda, "delivery_endereco", None),
            "bairro": getattr(comanda, "delivery_bairro", None),
            "fechada": bool(comanda.fechada),
            "criado_em": comanda.criado_em.isoformat() if comanda.criado_em else None,
            "closed_at": closed_at_iso,
            "itens": itens_payload,
            "ordering_block": _active_ordering_block(
                db,
                restaurante_id=restaurante_id,
                comanda=comanda,
            ),
            "restaurante": {
                "id": restaurante.id if restaurante else restaurante_id,
                "nome": restaurante.nome if restaurante else "Restaurante",
                "logo_url": restaurante.logo_url if restaurante else None,
                "cor_primaria": restaurante.cor_primaria if restaurante else "#00b894",
            },
            "conversa": {
                "id": conversation_id,
                "closed_at": closed_at_iso,
                "unread_count": customer_unread_count,
                "can_chat": state_contract["can_chat"],
            },
        }


@router.get("/{token}/messages", summary="Histórico de mensagens da conversa do pedido")
def listar_mensagens_do_pedido(token: str, db: Session = Depends(get_db)):
    resolved = resolve_public_tracking(db, token)
    if not resolved:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pedido não encontrado.")
    restaurante_id, conversation_id, _pedido_id, _closed_at = resolved
    with tenant_session_scope(db, restaurante_id):
        return list_recent_messages(
            db,
            restaurante_id=restaurante_id,
            conversation_id=conversation_id,
        )


@router.get("/{token}/feed", summary="Feed paginado da conversa do pedido")
def listar_feed_do_pedido(
    token: str, limit: int = Query(50, ge=1, le=100),
    before_seq: int | None = Query(None, ge=1), after_seq: int | None = Query(None, ge=0),
    db: Session = Depends(get_db),
):
    resolved = resolve_public_tracking(db, token)
    if not resolved:
        raise HTTPException(status_code=404, detail="Pedido não encontrado.")
    restaurante_id, conversation_id, _pedido_id, _closed_at = resolved
    with tenant_session_scope(db, restaurante_id):
        return list_feed_page(db, restaurante_id=restaurante_id,
                              conversation_id=conversation_id, limit=limit,
                              before_seq=before_seq, after_seq=after_seq)


@router.post("/{token}/messages", summary="Envia mensagem do cliente para o restaurante")
def enviar_mensagem_do_cliente(
    token: str,
    payload: CustomerMessagePayload,
    request: Request,
    db: Session = Depends(get_db),
):
    resolved = resolve_public_tracking(db, token)
    if not resolved:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pedido não encontrado.")

    restaurante_id, conversation_id, pedido_id, _closed_at = resolved
    with tenant_session_scope(db, restaurante_id):
        consume_rate_limit(
            db,
            restaurante_id=restaurante_id,
            scope="order_chat_customer_conversation",
            raw_key=conversation_id,
            max_requests=20,
            window_seconds=60,
            detail="Muitas mensagens em pouco tempo. Aguarde um instante para continuar.",
        )
        db.commit()
        consume_rate_limit(
            db,
            restaurante_id=restaurante_id,
            scope="order_chat_customer_ip",
            raw_key=client_ip(request),
            max_requests=60,
            window_seconds=5 * 60,
            detail="Muitas mensagens em pouco tempo. Aguarde um instante para continuar.",
        )
        db.commit()

        msg = send_customer_message(
            db,
            restaurante_id=restaurante_id,
            conversation_id=conversation_id,
            pedido_id=pedido_id,
            raw_body=payload.body,
            client_message_id=payload.client_message_id,
        )
        db.commit()
        db.refresh(msg)
        return serialize_message(msg)


@router.post("/{token}/read", summary="Marca mensagens como lidas pelo cliente")
def marcar_mensagens_lidas_cliente(token: str, db: Session = Depends(get_db)):
    resolved = resolve_public_tracking(db, token)
    if not resolved:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pedido não encontrado.")
    restaurante_id, conversation_id, _pedido_id, _closed_at = resolved
    with tenant_session_scope(db, restaurante_id):
        changed = mark_customer_read(db, restaurante_id, conversation_id)
        db.commit()
        return {"status": "ok", "changed": changed}


@router.get("/{token}/push-config", summary="Configuração pública de Web Push para este pedido")
def obter_configuracao_push(token: str, db: Session = Depends(get_db)):
    resolved = resolve_public_tracking(db, token)
    if not resolved:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pedido não encontrado.")
    config = get_web_push_config()
    return {
        "enabled": config.ready,
        "publicKey": config.public_key if config.ready else "",
    }


@router.put("/{token}/push-subscription", summary="Ativa avisos Web Push para o pedido")
def ativar_push_do_pedido(
    token: str,
    payload: PushSubscriptionPayload,
    request: Request,
    db: Session = Depends(get_db),
):
    resolved = resolve_public_tracking(db, token)
    if not resolved:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pedido não encontrado.")
    config = get_web_push_config()
    if not config.ready:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Notificações fora do navegador ainda não estão disponíveis.",
        )

    restaurante_id, conversation_id, pedido_id, _closed_at = resolved
    with tenant_session_scope(db, restaurante_id):
        consume_rate_limit(
            db,
            restaurante_id=restaurante_id,
            scope="order_push_subscription_conversation",
            raw_key=conversation_id,
            max_requests=10,
            window_seconds=5 * 60,
            detail="Muitas alterações de notificação. Aguarde alguns instantes.",
        )
        db.commit()
        consume_rate_limit(
            db,
            restaurante_id=restaurante_id,
            scope="order_push_subscription_ip",
            raw_key=client_ip(request),
            max_requests=30,
            window_seconds=10 * 60,
            detail="Muitas alterações de notificação. Aguarde alguns instantes.",
        )
        db.commit()
        upsert_order_push_subscription(
            db,
            restaurante_id=restaurante_id,
            conversation_id=conversation_id,
            pedido_id=pedido_id,
            endpoint=payload.endpoint,
            p256dh=payload.keys.p256dh,
            auth=payload.keys.auth,
        )
        db.commit()
        return {"status": "enabled"}


@router.delete("/{token}/push-subscription", summary="Desativa avisos Web Push para o pedido")
def desativar_push_do_pedido(
    token: str,
    payload: PushUnsubscribePayload,
    request: Request,
    db: Session = Depends(get_db),
):
    resolved = resolve_public_tracking(db, token)
    if not resolved:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pedido não encontrado.")
    restaurante_id, conversation_id, _pedido_id, _closed_at = resolved
    with tenant_session_scope(db, restaurante_id):
        consume_rate_limit(
            db,
            restaurante_id=restaurante_id,
            scope="order_push_unsubscribe_ip",
            raw_key=client_ip(request),
            max_requests=30,
            window_seconds=10 * 60,
            detail="Muitas alterações de notificação. Aguarde alguns instantes.",
        )
        db.commit()
        disabled = disable_order_push_subscription(
            db,
            restaurante_id=restaurante_id,
            conversation_id=conversation_id,
            endpoint=payload.endpoint,
        )
        db.commit()
        return {"status": "disabled", "changed": disabled}


@router.get("/{token}/events", summary="Stream SSE de status e chat do pedido")
async def stream_eventos_pedido(
    token: str,
    request: Request,
):
    # SSE é uma resposta potencialmente longa. Nunca mantenha a sessão HTTP
    # (e portanto uma conexão do pool) viva durante o streaming. O capability
    # token é resolvido em uma sessão curta que é fechada antes de criar o
    # StreamingResponse; a partir daí o hub trabalha somente em memória/Redis.
    db = SessionLocal()
    try:
        resolved = resolve_public_tracking(db, token)
    finally:
        db.close()
    if not resolved:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pedido não encontrado.")
    _restaurante_id, conversation_id, _pedido_id, _closed_at = resolved

    async def event_generator():
        sub_id, queue = order_chat_hub.subscribe_conversation(conversation_id)
        try:
            if not await order_chat_hub.wait_ready():
                return
            generation = order_chat_hub.generation
            yield _sse_event("connected", {"conversation_id": conversation_id})
            while not await request.is_disconnected():
                if not order_chat_hub.ready or generation != order_chat_hub.generation:
                    return
                try:
                    event_payload = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield _sse_event(event_payload["event"], event_payload["data"])
                except asyncio.TimeoutError:
                    if not order_chat_hub.ready or generation != order_chat_hub.generation:
                        return
                    yield ": keepalive\n\n"
        finally:
            order_chat_hub.unsubscribe_conversation(conversation_id, sub_id)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )

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
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db, tenant_session_scope
from ..models import Comanda, Restaurante
from ..order_chat_models import OrderConversation, OrderMessage
from ..services.order_chat_archive_service import reopen_completed_conversation_if_needed
from ..services.order_chat_hub import order_chat_hub
from ..services.order_chat_service import (
    compute_comanda_total,
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


def _effective_tracking_status(comanda: Comanda) -> str:
    raw_status = (comanda.delivery_status or "pendente").strip().lower()
    if raw_status in {"recusado", "rejected", "cancelado", "cancelled"}:
        return raw_status
    if comanda.fechada:
        return "finalizado"
    return raw_status


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

        closed_at_iso = closed_at.isoformat() if closed_at else None
        effective_status = _effective_tracking_status(comanda)
        state_contract = build_order_state_contract(
            effective_status,
            comanda.tipo,
            conversation_closed=closed_at is not None,
        )
        # Pedido concluído mantém o histórico arquivado, mas o cliente pode
        # iniciar um atendimento de pós-venda sem reabrir o pedido.
        if effective_status == "finalizado":
            state_contract["can_chat"] = True
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
        messages = (
            db.query(OrderMessage)
            .filter(
                OrderMessage.restaurante_id == restaurante_id,
                OrderMessage.conversation_id == conversation_id,
            )
            .order_by(OrderMessage.created_at.asc())
            .all()
        )
        return [serialize_message(msg) for msg in messages]


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

        reopen_completed_conversation_if_needed(
            db,
            restaurante_id=restaurante_id,
            conversation_id=conversation_id,
        )
        msg = send_customer_message(
            db,
            restaurante_id=restaurante_id,
            conversation_id=conversation_id,
            pedido_id=pedido_id,
            raw_body=payload.body,
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
        mark_customer_read(db, restaurante_id, conversation_id)
        db.commit()
        return {"status": "ok"}


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
    db: Session = Depends(get_db),
):
    resolved = resolve_public_tracking(db, token)
    if not resolved:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pedido não encontrado.")
    _restaurante_id, conversation_id, _pedido_id, _closed_at = resolved

    async def event_generator():
        sub_id, queue = order_chat_hub.subscribe_conversation(conversation_id)
        try:
            yield _sse_event("connected", {"conversation_id": conversation_id})
            while not await request.is_disconnected():
                try:
                    event_payload = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield _sse_event(event_payload["event"], event_payload["data"])
                except asyncio.TimeoutError:
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

"""Rotas do Caixa / Operação para Chat com Clientes sobre Pedidos.

Segurança P0:
- Acesso restrito a operadores com permissão de Caixa (caixa:operar).
- Isolamento multi-tenant intransponível: operários só acessam conversas do próprio restaurante_id.
- Atualização em tempo real via Server-Sent Events (SSE).
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db, tenant_session_scope
from ..models import Usuario
from ..order_chat_models import OrderConversation
from ..security import require_permission
from ..services.order_chat_hub import order_chat_hub
from ..services.order_chat_service import (
    get_caixa_unread_summary,
    list_feed_page,
    list_caixa_conversations,
    list_recent_messages,
    mark_staff_read,
    send_staff_message,
    serialize_message,
)

router = APIRouter(prefix="/api/caixa/conversas", tags=["Caixa - Chat"])


class StaffMessagePayload(BaseModel):
    body: str = Field(..., min_length=1, max_length=1000, description="Texto da resposta do operador")
    client_message_id: str | None = Field(default=None, min_length=36, max_length=36)


def _sse_event(event_name: str, payload: dict[str, Any]) -> str:
    return f"event: {event_name}\ndata: {json.dumps(payload, separators=(',', ':'))}\n\n"


def _get_tenant_id(user: Usuario) -> int:
    rid = getattr(user, "restaurante_id", None)
    if not rid or not isinstance(rid, int) or rid <= 0:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sessão sem tenant identificado. Faça login novamente.",
        )
    return int(rid)


@router.get("", summary="Lista as conversas de pedidos do restaurante")
def listar_conversas(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("caixa:operar")),
):
    """Retorna somente conversas operacionais ativas do restaurante."""
    restaurante_id = _get_tenant_id(current_user)
    with tenant_session_scope(db, restaurante_id):
        return list_caixa_conversations(db, restaurante_id)


@router.get("/unread-count", summary="Total global de mensagens não lidas no Caixa")
def obter_total_nao_lidas(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("caixa:operar")),
):
    """Retorna a contagem global de mensagens de clientes não lidas para exibição do badge."""
    restaurante_id = _get_tenant_id(current_user)
    with tenant_session_scope(db, restaurante_id):
        total = get_caixa_unread_summary(db, restaurante_id)
        return {"total_unread": total}


@router.get("/{conversation_id}/messages", summary="Histórico de mensagens de uma conversa")
def obter_mensagens_conversa(
    conversation_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("caixa:operar")),
):
    """Retorna o histórico cronológico completo de mensagens de um pedido."""
    restaurante_id = _get_tenant_id(current_user)
    with tenant_session_scope(db, restaurante_id):
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

        return list_recent_messages(
            db,
            restaurante_id=restaurante_id,
            conversation_id=conversation_id,
        )


@router.get("/{conversation_id}/feed", summary="Feed paginado de uma conversa")
def obter_feed_conversa(
    conversation_id: str, limit: int = Query(50, ge=1, le=100),
    before_seq: int | None = Query(None, ge=1), after_seq: int | None = Query(None, ge=0),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("caixa:operar")),
):
    restaurante_id = _get_tenant_id(current_user)
    with tenant_session_scope(db, restaurante_id):
        conv = db.query(OrderConversation).filter_by(
            restaurante_id=restaurante_id, id=conversation_id,
        ).first()
        if not conv:
            raise HTTPException(status_code=404, detail="Conversa não encontrada.")
        return list_feed_page(db, restaurante_id=restaurante_id,
                              conversation_id=conversation_id, limit=limit,
                              before_seq=before_seq, after_seq=after_seq)


@router.post("/{conversation_id}/messages", summary="Operador responde mensagem do cliente")
def responder_cliente(
    conversation_id: str,
    payload: StaffMessagePayload,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("caixa:operar")),
):
    """Envia uma resposta oficial do restaurante para o cliente."""
    restaurante_id = _get_tenant_id(current_user)
    with tenant_session_scope(db, restaurante_id):
        msg = send_staff_message(
            db,
            restaurante_id=restaurante_id,
            conversation_id=conversation_id,
            user_id=current_user.id,
            raw_body=payload.body,
            client_message_id=payload.client_message_id,
        )
        db.commit()
        db.refresh(msg)
        return serialize_message(msg)


@router.post("/{conversation_id}/read", summary="Marca conversa como lida pelo operador")
def marcar_lida_operador(
    conversation_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("caixa:operar")),
):
    """Atualiza o timestamp de leitura da equipe para zerar as notificações pendentes."""
    restaurante_id = _get_tenant_id(current_user)
    with tenant_session_scope(db, restaurante_id):
        changed = mark_staff_read(db, restaurante_id, conversation_id)
        db.commit()
        return {"status": "ok", "changed": changed}


@router.get("/events", summary="Stream SSE de novas mensagens e atualizações para o Caixa")
async def stream_eventos_caixa(
    request: Request,
    current_user: Usuario = Depends(require_permission("caixa:operar")),
):
    """Conexão Server-Sent Events (SSE) para atualização instantânea do painel do Caixa."""
    restaurante_id = _get_tenant_id(current_user)

    async def event_generator():
        sub_id, queue = order_chat_hub.subscribe_caixa(restaurante_id)
        try:
            if not await order_chat_hub.wait_ready():
                return
            generation = order_chat_hub.generation
            yield _sse_event("connected", {"restaurante_id": restaurante_id})

            while not await request.is_disconnected():
                if not order_chat_hub.ready or generation != order_chat_hub.generation:
                    return
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield _sse_event(payload["event"], payload["data"])
                except asyncio.TimeoutError:
                    if not order_chat_hub.ready or generation != order_chat_hub.generation:
                        return
                    yield ": keepalive\n\n"
        finally:
            order_chat_hub.unsubscribe_caixa(restaurante_id, sub_id)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )

"""Rotas públicas do Cardápio para Acompanhamento de Pedidos e Chat com o Restaurante.

Segurança P0:
- Consulta exclusivamente por token de alta entropia (/acompanhar/{token}).
- Nenhuma exposição de IDs sequenciais ou enumeração de pedidos.
- Zero dependência de autenticação do cliente.
- Isolamento multi-tenant garantido por tenant_session_scope.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db, tenant_session_scope
from ..models import Comanda, Restaurante
from ..order_chat_models import OrderConversation, OrderMessage
from ..services.order_chat_hub import order_chat_hub
from ..services.order_chat_service import (
    compute_comanda_total,
    mark_customer_read,
    resolve_public_tracking,
    send_customer_message,
    serialize_message,
)

router = APIRouter(prefix="/api/cardapio/pedidos/acompanhar", tags=["Cardapio - Acompanhamento"])


class CustomerMessagePayload(BaseModel):
    body: str = Field(..., min_length=1, max_length=1000, description="Texto da mensagem")


def _sse_event(event_name: str, payload: dict[str, Any]) -> str:
    return f"event: {event_name}\ndata: {json.dumps(payload, separators=(',', ':'))}\n\n"


@router.get("/{token}", summary="Consulta segura dos dados de acompanhamento do pedido")
def consultar_pedido_por_token(
    token: str,
    db: Session = Depends(get_db),
):
    """Retorna os dados consolidados do pedido para a página pública de acompanhamento.

    Retorna 404 (sem vazar se o pedido existe ou não) caso o token seja inválido.
    """
    resolved = resolve_public_tracking(db, token)
    if not resolved:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pedido não encontrado.",
        )

    restaurante_id, conversation_id, pedido_id, closed_at = resolved

    with tenant_session_scope(db, restaurante_id):
        comanda = (
            db.query(Comanda)
            .filter(
                Comanda.restaurante_id == restaurante_id,
                Comanda.id == pedido_id,
            )
            .first()
        )
        if not comanda:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Pedido não encontrado.",
            )

        restaurante = (
            db.query(Restaurante)
            .filter(Restaurante.id == restaurante_id)
            .first()
        )

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
        return {
            "id": comanda.id,
            "numero_pedido": comanda.numero_pedido,
            "status": comanda.delivery_status or "pendente",
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
            },
        }


@router.get("/{token}/messages", summary="Histórico de mensagens da conversa do pedido")
def listar_mensagens_do_pedido(
    token: str,
    db: Session = Depends(get_db),
):
    """Retorna as mensagens (cliente, restaurante e sistema) da conversa do pedido."""
    resolved = resolve_public_tracking(db, token)
    if not resolved:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pedido não encontrado.",
        )

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
    db: Session = Depends(get_db),
):
    """Envia uma mensagem de texto do cliente final para a comanda."""
    resolved = resolve_public_tracking(db, token)
    if not resolved:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pedido não encontrado.",
        )

    restaurante_id, conversation_id, pedido_id, _closed_at = resolved

    with tenant_session_scope(db, restaurante_id):
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
def marcar_mensagens_lidas_cliente(
    token: str,
    db: Session = Depends(get_db),
):
    """Atualiza o timestamp de leitura do cliente na conversa."""
    resolved = resolve_public_tracking(db, token)
    if not resolved:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pedido não encontrado.",
        )

    restaurante_id, conversation_id, _pedido_id, _closed_at = resolved

    with tenant_session_scope(db, restaurante_id):
        mark_customer_read(db, restaurante_id, conversation_id)
        db.commit()
        return {"status": "ok"}


@router.get("/{token}/events", summary="Stream SSE de status e chat do pedido")
async def stream_eventos_pedido(
    token: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Conexão Server-Sent Events (SSE) para atualização instantânea de mensagens e status."""
    resolved = resolve_public_tracking(db, token)
    if not resolved:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pedido não encontrado.",
        )

    _restaurante_id, conversation_id, _pedido_id, _closed_at = resolved

    async def event_generator():
        sub_id, queue = order_chat_hub.subscribe_conversation(conversation_id)
        try:
            yield _sse_event("connected", {"conversation_id": conversation_id})

            while not await request.is_disconnected():
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield _sse_event(payload["event"], payload["data"])
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

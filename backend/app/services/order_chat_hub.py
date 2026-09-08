"""Hub em memória para Server-Sent Events (SSE) do Chat e Acompanhamento de Pedidos.

Permite que:
1. O cliente final acompanhe o status e converse em tempo real via stream (/acompanhar/{token}/events).
2. O operador do Caixa receba notificações instantâneas de novas mensagens e atualizações (/caixa/conversas/events).
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

logger = logging.getLogger(__name__)


class OrderChatHub:
    """Gerenciador pub/sub assíncrono para streaming SSE de eventos de pedidos e chat."""

    def __init__(self) -> None:
        # conversation_id -> {sub_id: Queue}
        self._conversation_subscribers: dict[str, dict[str, asyncio.Queue]] = {}
        # restaurante_id -> {sub_id: Queue}
        self._caixa_subscribers: dict[int, dict[str, asyncio.Queue]] = {}

    def subscribe_conversation(self, conversation_id: str) -> tuple[str, asyncio.Queue]:
        sub_id = str(uuid.uuid4())
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        if conversation_id not in self._conversation_subscribers:
            self._conversation_subscribers[conversation_id] = {}
        self._conversation_subscribers[conversation_id][sub_id] = queue
        return sub_id, queue

    def unsubscribe_conversation(self, conversation_id: str, sub_id: str) -> None:
        subscribers = self._conversation_subscribers.get(conversation_id)
        if subscribers and sub_id in subscribers:
            del subscribers[sub_id]
            if not subscribers:
                self._conversation_subscribers.pop(conversation_id, None)

    def subscribe_caixa(self, restaurante_id: int) -> tuple[str, asyncio.Queue]:
        sub_id = str(uuid.uuid4())
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        if restaurante_id not in self._caixa_subscribers:
            self._caixa_subscribers[restaurante_id] = {}
        self._caixa_subscribers[restaurante_id][sub_id] = queue
        return sub_id, queue

    def unsubscribe_caixa(self, restaurante_id: int, sub_id: str) -> None:
        subscribers = self._caixa_subscribers.get(restaurante_id)
        if subscribers and sub_id in subscribers:
            del subscribers[sub_id]
            if not subscribers:
                self._caixa_subscribers.pop(restaurante_id, None)

    def _safe_put(self, queue: asyncio.Queue, item: dict[str, Any]) -> None:
        try:
            queue.put_nowait(item)
        except asyncio.QueueFull:
            try:
                queue.get_nowait()
                queue.put_nowait(item)
            except Exception:
                pass

    def broadcast_to_conversation(self, conversation_id: str, event_type: str, data: dict[str, Any]) -> None:
        subscribers = self._conversation_subscribers.get(conversation_id, {})
        payload = {"event": event_type, "data": data}
        for queue in list(subscribers.values()):
            self._safe_put(queue, payload)

    def broadcast_to_caixa(self, restaurante_id: int, event_type: str, data: dict[str, Any]) -> None:
        subscribers = self._caixa_subscribers.get(restaurante_id, {})
        payload = {"event": event_type, "data": data}
        for queue in list(subscribers.values()):
            self._safe_put(queue, payload)

    def publish_message(
        self,
        restaurante_id: int,
        conversation_id: str,
        message_data: dict[str, Any],
    ) -> None:
        enriched = {**message_data, "conversation_id": conversation_id}
        self.broadcast_to_conversation(conversation_id, "message", enriched)
        self.broadcast_to_caixa(restaurante_id, "new_message", enriched)

    def publish_status(
        self,
        restaurante_id: int,
        conversation_id: str,
        status_data: dict[str, Any],
    ) -> None:
        enriched = {**status_data, "conversation_id": conversation_id}
        self.broadcast_to_conversation(conversation_id, "status", enriched)
        self.broadcast_to_caixa(restaurante_id, "status_changed", enriched)

    def publish_read(
        self,
        restaurante_id: int,
        conversation_id: str,
        read_data: dict[str, Any],
    ) -> None:
        enriched = {**read_data, "conversation_id": conversation_id}
        self.broadcast_to_conversation(conversation_id, "read_update", enriched)
        self.broadcast_to_caixa(restaurante_id, "read_update", enriched)


order_chat_hub = OrderChatHub()

"""Publicador transacional de eventos para a tabela IntegrationOutbox."""

from __future__ import annotations

import datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Optional
import uuid
from sqlalchemy.orm import Session

from ...domain.orders.events import OrderDomainEvent
from ...models import IntegrationOutbox


def _serialize_event_value(val: Any) -> Any:
    """Converte valores do evento para tipos primitivos JSON seguros."""
    if isinstance(val, Decimal):
        return str(val)
    if isinstance(val, (datetime.datetime, datetime.date)):
        return val.isoformat()
    if isinstance(val, Enum):
        return val.value
    if isinstance(val, dict):
        return {k: _serialize_event_value(v) for k, v in val.items()}
    if isinstance(val, (list, tuple, set)):
        return [_serialize_event_value(v) for v in val]
    return val


def domain_event_to_payload(event: Any) -> dict[str, Any]:
    """Serializa um evento de domínio em um dicionário canônico limpo."""
    if hasattr(event, "__dataclass_fields__"):
        import dataclasses
        raw_dict = dataclasses.asdict(event)
        return {k: _serialize_event_value(v) for k, v in raw_dict.items()}
    if hasattr(event, "dict"):
        return {k: _serialize_event_value(v) for k, v in event.dict().items()}
    if isinstance(event, dict):
        return {k: _serialize_event_value(v) for k, v in event.items()}
    raise ValueError(f"Não é possível serializar evento do tipo: {type(event)}")


def resolve_event_name(event: Any) -> str:
    """Determina o nome canônico do evento a partir do tipo de classe."""
    class_name = event.__class__.__name__
    name_map = {
        "OrderCreated": "koma.order.created",
        "OrderAccepted": "koma.order.accepted",
        "OrderPreparing": "koma.order.preparing",
        "OrderReady": "koma.order.ready",
        "OrderDispatched": "koma.order.dispatched",
        "OrderCompleted": "koma.order.completed",
        "OrderRejected": "koma.order.rejected",
        "OrderCancelled": "koma.order.cancelled",
    }
    return name_map.get(class_name, f"koma.{class_name.lower()}")


def enqueue_outbox_event_in_session(
    db: Session,
    event: Any,
    *,
    aggregate_type: str = "order",
    aggregate_id: Optional[str] = None,
    event_name: Optional[str] = None,
) -> IntegrationOutbox:
    """Grava o evento na tabela IntegrationOutbox na mesma sessão/transação ACID do domínio.

    Garante atomicidade estrita: se a transação der rollback, o evento da outbox é descartado.
    Se a transação comitar, o evento fica garantido para entrega assíncrona com garantia at-least-once.

    Semântica de entrega:
    - O KÔMA garante entrega AT-LEAST-ONCE. Não há garantia de zero-duplicatas na rede.
    - O campo ``event_id`` (UUID estável) DEVE ser usado pelo consumidor / webhook receiver
      como chave de idempotência e deduplicação.
    - ``aggregate_id`` e ``payload.order_id`` apontam para a mesma entidade (o Pedido / Lançamento).
    """
    payload = domain_event_to_payload(event)
    ev_name = event_name or resolve_event_name(event)
    ev_id = getattr(event, "event_id", str(uuid.uuid4()))
    rest_id = getattr(event, "restaurant_id", payload.get("restaurant_id"))

    if not rest_id:
        raise ValueError("Evento de outbox precisa conter restaurant_id explícito.")

    agg_id = str(aggregate_id or getattr(event, "order_id", payload.get("order_id", "")))

    outbox_record = IntegrationOutbox(
        id=str(uuid.uuid4()),
        restaurante_id=int(rest_id),
        event_id=str(ev_id),
        event_name=ev_name,
        aggregate_type=aggregate_type,
        aggregate_id=agg_id,
        payload=payload,
        status="pending",
        attempts=0,
        max_attempts=5,
        created_at=datetime.datetime.now(datetime.timezone.utc),
    )

    db.add(outbox_record)
    db.info["outbox_pending_notification"] = True
    return outbox_record

from __future__ import annotations

import datetime
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ..domain.orders.events import OrderCreated
from ..domain.orders.types import FulfillmentType, OrderChannel
from ..models import Comanda, Lancamento
from ..scheduled_models import ScheduledOrder
from .capabilities import has_capability
from .outbox import enqueue_outbox_event_in_session


SCHEDULED_ORDERS_CAPABILITY = "scheduled_orders"
MIN_SCHEDULE_LEAD = datetime.timedelta(minutes=30)
MAX_SCHEDULE_HORIZON = datetime.timedelta(days=7)


def _utc_now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _as_aware_utc(value: datetime.datetime) -> datetime.datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=datetime.timezone.utc)
    return value.astimezone(datetime.timezone.utc)


def validate_schedule_request(
    db: Session,
    *,
    restaurante_id: int,
    scheduled_for: datetime.datetime,
) -> datetime.datetime:
    if not has_capability(db, restaurante_id, SCHEDULED_ORDERS_CAPABILITY):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este restaurante não habilitou pedidos agendados.",
        )

    target = _as_aware_utc(scheduled_for)
    now = _utc_now()
    if target < now + MIN_SCHEDULE_LEAD:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Escolha um horário com pelo menos 30 minutos de antecedência.",
        )
    if target > now + MAX_SCHEDULE_HORIZON:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="O pedido pode ser agendado com no máximo 7 dias de antecedência.",
        )
    return target


def schedule_order_in_session(
    db: Session,
    *,
    restaurante_id: int,
    comanda_id: str,
    scheduled_for: datetime.datetime,
) -> ScheduledOrder:
    target = validate_schedule_request(
        db,
        restaurante_id=restaurante_id,
        scheduled_for=scheduled_for,
    )
    existing = db.query(ScheduledOrder).filter(
        ScheduledOrder.restaurante_id == restaurante_id,
        ScheduledOrder.comanda_id == comanda_id,
    ).first()
    if existing is not None:
        return existing

    comanda = db.query(Comanda).filter(
        Comanda.restaurante_id == restaurante_id,
        Comanda.id == comanda_id,
    ).with_for_update().one()
    # Reutiliza a barreira operacional já aplicada por Caixa/KDS/SmartPOS.
    # Não existe OnlinePaymentIntent para este caso; na liberação voltamos a NULL.
    comanda.online_payment_status = "pending"

    record = ScheduledOrder(
        restaurante_id=restaurante_id,
        comanda_id=comanda_id,
        scheduled_for=target,
    )
    db.add(record)
    db.flush()
    return record


def _order_total(comanda: Comanda) -> Decimal:
    items_total = sum(
        Decimal(str(item.preco_unit or 0))
        for item in comanda.itens
        if item.status != "cancelado"
    )
    return max(
        Decimal("0.00"),
        items_total
        + Decimal(str(comanda.delivery_taxa or 0))
        - Decimal(str(comanda.valor_desconto_cupom or 0))
        - Decimal(str(comanda.valor_desconto_cashback or 0)),
    )


def _publish_created_event(db: Session, comanda: Comanda) -> None:
    lancamento = db.query(Lancamento).filter(
        Lancamento.restaurante_id == comanda.restaurante_id,
        Lancamento.comanda_id == comanda.id,
    ).order_by(Lancamento.timestamp.asc()).first()
    if lancamento is None:
        return

    event = OrderCreated(
        restaurant_id=comanda.restaurante_id,
        order_id=lancamento.id,
        check_id=comanda.id,
        display_number=str(comanda.numero_pedido),
        check_number=comanda.numero_pedido,
        channel=OrderChannel.WEB_CARDAPIO,
        fulfillment=(
            FulfillmentType.PICKUP
            if comanda.tipo == "Retirada"
            else FulfillmentType.DELIVERY
        ),
        total=_order_total(comanda),
        items_count=len([item for item in comanda.itens if item.status != "cancelado"]),
        customer_name=comanda.identificador,
        customer_phone=comanda.delivery_telefone,
        idempotency_key=comanda.idempotency_key,
    )
    enqueue_outbox_event_in_session(
        db,
        event,
        aggregate_type="order",
        aggregate_id=str(lancamento.id),
    )


def release_due_scheduled_orders_in_session(
    db: Session,
    *,
    restaurante_id: int,
) -> int:
    now = _utc_now()
    due = db.query(ScheduledOrder).filter(
        ScheduledOrder.restaurante_id == restaurante_id,
        ScheduledOrder.released_at.is_(None),
        ScheduledOrder.scheduled_for <= now,
    ).with_for_update().all()

    released = 0
    for record in due:
        comanda = db.query(Comanda).filter(
            Comanda.restaurante_id == restaurante_id,
            Comanda.id == record.comanda_id,
            Comanda.fechada.is_(False),
        ).with_for_update().first()
        if comanda is None:
            record.released_at = now
            continue

        comanda.online_payment_status = None
        _publish_created_event(db, comanda)
        record.released_at = now
        released += 1

    if released:
        db.flush()
    return released


def scheduled_for_order(
    db: Session,
    *,
    restaurante_id: int,
    comanda_id: str,
) -> ScheduledOrder | None:
    return db.query(ScheduledOrder).filter(
        ScheduledOrder.restaurante_id == restaurante_id,
        ScheduledOrder.comanda_id == comanda_id,
    ).first()

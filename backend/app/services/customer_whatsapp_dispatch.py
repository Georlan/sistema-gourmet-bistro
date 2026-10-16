"""Opted-in order notices through the existing central outbox, rollout off by default.

No polling or private contact/message text is added to the outbox. A shared
Business session is reused, restricted to explicitly released restaurants. Provider acceptance is not evidence of delivery to the device.
"""
from __future__ import annotations

import datetime as dt
import os
import uuid
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_UP

from sqlalchemy.orm import Session

from ..domain.orders.events import OrderCreated
from ..domain.orders.types import OrderChannel
from ..models import Cliente, Comanda, ConfiguracaoRestaurante, IntegrationOutbox, Lancamento, Restaurante, WhatsAppContactOptOut
from .central_whatsapp import allowed_restaurants, enabled_for, pilot_configuration, recipient_fingerprint, registered_operator_phone
from .customer_status_whatsapp import eligible_order_status_recipient
from .whatsapp_notice_policy import NoticeKind, customer_notice_for_event, still_relevant

EVENT_NAME = "koma.whatsapp.customer_status"
_NAMESPACE = uuid.UUID("b12f3264-1333-4a8d-9bdb-c511353d07a0")


@dataclass(frozen=True)
class CustomerNotice:
    restaurant_id: int
    order_id: str  # Comanda, not Lancamento.
    source_order_id: str
    kind: str
    recipient_hash: str
    event_id: str


def limits() -> tuple[int, Decimal, Decimal] | None:
    """Tariff must be supplied explicitly; message ceiling also applies at zero tariff."""
    try:
        count = int(os.getenv("KOMA_CUSTOMER_WA_MONTHLY_MESSAGE_LIMIT", "0"))
        unit = Decimal(os.environ["KOMA_CUSTOMER_WA_UNIT_COST_BRL"])
        budget = Decimal(os.getenv("KOMA_CUSTOMER_WA_MONTHLY_BUDGET_BRL", "10"))
        if count < 1 or not unit.is_finite() or not budget.is_finite() or unit < 0 or budget <= 0:
            return None
        return count, unit.quantize(Decimal("0.0001"), rounding=ROUND_UP), budget
    except (KeyError, ValueError, InvalidOperation):
        return None


def customer_notices_enabled(restaurant_id: int, tenant: ConfiguracaoRestaurante | None) -> bool:
    config = pilot_configuration()
    return bool(
        os.getenv("KOMA_CUSTOMER_WA_ENABLED", "false").strip().lower() == "true"
        and restaurant_id in allowed_restaurants("KOMA_CUSTOMER_WA_ALLOWED_RESTAURANT_IDS")
        and enabled_for(restaurant_id) and config and limits()
        and registered_operator_phone(tenant, config.sender)
    )


def opted_out(db: Session, rid: int, digest: str) -> bool:
    return db.query(WhatsAppContactOptOut).filter_by(restaurante_id=rid, phone_hash=digest).first() is not None


def _recipient(db: Session, rid: int, order: Comanda) -> str | None:
    customer = db.query(Cliente).filter_by(restaurante_id=rid, id=order.cliente_id).one_or_none() if order.cliente_id else None
    if not eligible_order_status_recipient(restaurant_id=rid, order=order, customer=customer):
        return None
    digest = recipient_fingerprint(rid, order.delivery_telefone)
    if opted_out(db, rid, digest):
        return None
    from .tenant_order_whatsapp import normalize_phone
    return normalize_phone(order.delivery_telefone)


def _released(db: Session, rid: int, source_id: str) -> bool:
    # Consent can only be persisted by the web adapter, but also validate the
    # canonical origin and release event (scheduled/Pix orders publish later).
    source = db.query(Lancamento).filter_by(restaurante_id=rid, id=source_id, origem="cardapio").one_or_none()
    if source is None:
        return False
    for pending in db.new:
        if isinstance(pending, IntegrationOutbox) and pending.restaurante_id == rid and pending.event_name == "koma.order.created" and pending.aggregate_id == source_id:
            return True
    return db.query(IntegrationOutbox.id).filter_by(
        restaurante_id=rid, event_name="koma.order.created", aggregate_id=source_id,
    ).first() is not None


def enqueue_customer_notice(db: Session, event, event_name: str):
    rid = int(event.restaurant_id)
    # The default-off path must add no query to the operational transaction.
    if os.getenv("KOMA_CUSTOMER_WA_ENABLED", "false").strip().lower() != "true" or not enabled_for(rid) or limits() is None:
        return None
    tenant = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=rid).one_or_none()
    if not customer_notices_enabled(rid, tenant) or not event.check_id:
        return None
    order = db.query(Comanda).filter_by(restaurante_id=rid, id=str(event.check_id)).one_or_none()
    if order is None or not _released(db, rid, str(event.order_id)):
        return None
    if isinstance(event, OrderCreated) and event.channel != OrderChannel.WEB_CARDAPIO:
        return None
    kind = customer_notice_for_event(event_name=event_name, fulfillment=order.tipo, online_order=True, operationally_released=True)
    if kind is None:
        return None
    now = dt.datetime.now(dt.timezone.utc)
    if not still_relevant(kind=kind, latest_status=order.delivery_status, fulfillment=order.tipo, queued_at=now, now=now):
        return None
    target = _recipient(db, rid, order)
    if target is None:
        return None
    notice = CustomerNotice(
        restaurant_id=rid, order_id=str(order.id), source_order_id=str(event.order_id),
        kind=kind.value, recipient_hash=recipient_fingerprint(rid, target),
        event_id=str(uuid.uuid5(_NAMESPACE, f"{rid}:{order.id}:{kind.value}")),
    )
    # Multiple Lancamentos/duplicate canonical events generate only one notice
    # per Comanda milestone. Preserve the first immutable contact snapshot.
    for pending in db.new:
        if isinstance(pending, IntegrationOutbox) and pending.restaurante_id == rid and pending.event_id == notice.event_id:
            return pending
    existing = db.query(IntegrationOutbox).filter_by(restaurante_id=rid, event_id=notice.event_id).first()
    if existing:
        return existing
    from .outbox.publisher import enqueue_outbox_event_in_session
    record = enqueue_outbox_event_in_session(db, notice, event_name=EVENT_NAME,
        aggregate_type="customer_whatsapp", aggregate_id=str(order.id))
    record.max_attempts = 2
    return record


def snapshot_time(snapshot: dict) -> dt.datetime:
    value = snapshot.get("created_at")
    if isinstance(value, str):
        try:
            value = dt.datetime.fromisoformat(value)
        except ValueError:
            value = None
    if not isinstance(value, dt.datetime):
        return dt.datetime.min.replace(tzinfo=dt.timezone.utc)
    return value.replace(tzinfo=dt.timezone.utc) if value.tzinfo is None else value


def resolve_customer_notice(db: Session, snapshot: dict) -> tuple[str, str] | None:
    rid = int(snapshot["restaurante_id"])
    payload = snapshot.get("payload") or {}
    tenant = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=rid).one_or_none()
    if payload.get("restaurant_id") != rid or not customer_notices_enabled(rid, tenant):
        return None
    order = db.query(Comanda).filter_by(restaurante_id=rid, id=str(payload.get("order_id"))).one_or_none()
    if order is None:
        return None
    source = db.query(Lancamento).filter_by(restaurante_id=rid, id=str(payload.get("source_order_id")), comanda_id=order.id, origem="cardapio").one_or_none()
    if source is None or not _released(db, rid, source.id):
        return None
    target = _recipient(db, rid, order)
    if target is None or recipient_fingerprint(rid, target) != payload.get("recipient_hash"):
        return None
    try:
        kind = NoticeKind(payload["kind"])
    except (ValueError, KeyError):
        return None
    if not still_relevant(kind=kind, latest_status=order.delivery_status,
            fulfillment=order.tipo, queued_at=snapshot_time(snapshot), now=dt.datetime.now(dt.timezone.utc)):
        return None
    restaurant = db.query(Restaurante).filter_by(id=rid).one_or_none()
    label = " ".join((restaurant.nome if restaurant else "Restaurante").split())[:60]
    description = {
        NoticeKind.CUSTOMER_RECEIVED: "Pedido recebido pelo restaurante.",
        NoticeKind.CUSTOMER_READY_PICKUP: "Seu pedido está pronto para retirada.",
        NoticeKind.CUSTOMER_DISPATCHED: "Seu pedido saiu para entrega.",
        NoticeKind.CUSTOMER_CANCELLED: "Seu pedido foi cancelado ou recusado. Consulte o acompanhamento para detalhes.",
    }.get(kind)
    if description is None:
        return None
    from .whatsapp_opt_out import opt_out_url
    message = f"KÔMA | {label}\nPedido #{order.numero_pedido}\n{description}\n\nParar avisos deste restaurante: {opt_out_url(rid, target)}"
    return target, message


def budget_available(tenant: ConfiguracaoRestaurante) -> bool:
    configured = limits()
    if configured is None:
        return False
    cap, unit, budget = configured
    month = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m")
    used = int(tenant.whatsapp_budget_attempts or 0) if tenant.whatsapp_budget_month == month else 0
    spent = Decimal(str(tenant.whatsapp_budget_cost or 0)) if tenant.whatsapp_budget_month == month else Decimal("0")
    return used < cap and spent + unit <= budget


def reserve_budget(tenant: ConfiguracaoRestaurante) -> None:
    # Caller holds the central transport's settings row lock until commit.
    # Reserved attempts include unavailable/ambiguous provider requests and are
    # never refunded automatically. Re-registering a phone cannot reset spend.
    month = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m")
    if tenant.whatsapp_budget_month != month:
        tenant.whatsapp_budget_month = month
        tenant.whatsapp_budget_attempts = 0
        tenant.whatsapp_budget_cost = Decimal("0")
    tenant.whatsapp_budget_attempts = int(tenant.whatsapp_budget_attempts or 0) + 1
    tenant.whatsapp_budget_cost = Decimal(str(tenant.whatsapp_budget_cost or 0)) + limits()[1]


def dispatch_customer_notice(db: Session, snapshot: dict) -> bool:
    resolved = resolve_customer_notice(db, snapshot)
    if resolved is None:
        from .outbox.dispatcher import settle_outbox_event
        settle_outbox_event(db, str(snapshot["id"]), status="dead_letter",
            last_error="Aviso expirado, revogado, não liberado ou contato/estado divergente.", worker_id=snapshot.get("locked_by"))
        return False
    from .central_whatsapp import dispatch_registered_message
    return dispatch_registered_message(db, snapshot, pilot_configuration(), *resolved, customer=True)

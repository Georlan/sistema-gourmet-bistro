"""Opted-in order notices through the existing central outbox, rollout off by default.

No polling or private contact/message text is added to the outbox. A shared
Business session is reused, restricted to explicitly released restaurants. Provider acceptance is not evidence of delivery to the device.
"""
from __future__ import annotations

import datetime as dt
import os
import uuid
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy.orm import Session

from ..domain.orders.events import OrderCreated
from ..domain.orders.types import OrderChannel
from ..models import Cliente, Comanda, ConfiguracaoRestaurante, IntegrationOutbox, Lancamento, Restaurante, WhatsAppContactOptOut
from .central_whatsapp import allowed_restaurants, transport_configuration, recipient_fingerprint
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


def customer_notice_transport_config(
    restaurant_id: int, tenant: ConfiguracaoRestaurante | None = None,
):
    """Global kill switch plus explicit tenant-scoped platform rollout."""
    if os.getenv("KOMA_CUSTOMER_WA_ENABLED", "false").strip().lower() != "true":
        return None
    config = transport_configuration()
    if config is None:
        return None
    if tenant is not None and tenant.whatsapp_platform_managed is True:
        if tenant.whatsapp_platform_customer_allowed is not True:
            return None
    elif restaurant_id not in allowed_restaurants("KOMA_CUSTOMER_WA_ALLOWED_RESTAURANT_IDS") or restaurant_id not in config.restaurant_ids:
        return None
    return config


def customer_notices_enabled(restaurant_id: int, tenant: ConfiguracaoRestaurante | None) -> bool:
    config = customer_notice_transport_config(restaurant_id, tenant)
    return bool(config and tenant is not None and tenant.whatsapp_customer_notices_enabled is True)


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
    if os.getenv("KOMA_CUSTOMER_WA_ENABLED", "false").strip().lower() != "true":
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
    # A legacy tenant may still be named "Kôma" internally even though its
    # public menu has a restaurant-specific slug (e.g. d8-burger).
    # Prefer the public identifier only when the registered name is just the
    # platform name; never hardcode tenant IDs or names of individual stores.
    import re
    import unicodedata
    label = " ".join((restaurant.nome if restaurant else "Restaurante").split())[:60]
    normalized_name = unicodedata.normalize("NFKD", label).encode("ascii", "ignore").decode().casefold()
    if normalized_name == "koma" and restaurant and restaurant.slug:
        public_slug = str(restaurant.slug).strip()
        if re.fullmatch(r"[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*", public_slug):
            label = public_slug.replace("-", " ").title()[:60]
    safe_label = re.sub(r"[*_~\x60\\r\\n]", "", label).strip() or "Restaurante"
    description = {
        NoticeKind.CUSTOMER_RECEIVED: "Pedido recebido pelo restaurante.",
        NoticeKind.CUSTOMER_READY_PICKUP: "Seu pedido está pronto para retirada.",
        NoticeKind.CUSTOMER_DISPATCHED: "Seu pedido saiu para entrega.",
        NoticeKind.CUSTOMER_CANCELLED: "Seu pedido foi cancelado ou recusado. Consulte o acompanhamento para detalhes.",
    }.get(kind)
    if description is None:
        return None
    from .whatsapp_opt_out import opt_out_url
    # Native WhatsApp bold, one clear header, minimal transactional content.
    # No buyer name: voluntary checkout consent is not phone ownership proof.
    message = (
        f"*KÔMA | {safe_label}*\\n"
        f"Pedido #{order.numero_pedido}\\n\\n"
        f"*{description}*\\n\\n"
        "Aviso automático. Este número não é o WhatsApp do restaurante.\\n\\n"
        "Não quer mais receber avisos deste restaurante?\\n"
        f"Desative: {opt_out_url(rid, target)}"
    )
    return target, message


def budget_available(tenant: ConfiguracaoRestaurante) -> bool:
    """Legacy compatibility: budgets are observability only, never an order gate."""
    return True


def reserve_budget(tenant: ConfiguracaoRestaurante) -> None:
    """Preserve historical UTC-monthly estimate/attempts without blocking sends."""
    from .whatsapp_usage import estimated_customer_unit_cost
    month = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m")
    if tenant.whatsapp_budget_month != month:
        tenant.whatsapp_budget_month = month
        tenant.whatsapp_budget_attempts = 0
        tenant.whatsapp_budget_cost = Decimal("0")
    tenant.whatsapp_budget_attempts = int(tenant.whatsapp_budget_attempts or 0) + 1
    tenant.whatsapp_budget_cost = (
        Decimal(str(tenant.whatsapp_budget_cost or 0))
        + (estimated_customer_unit_cost() or Decimal("0"))
    )


def dispatch_customer_notice(db: Session, snapshot: dict) -> bool:
    resolved = resolve_customer_notice(db, snapshot)
    if resolved is None:
        from .outbox.dispatcher import settle_outbox_event
        settle_outbox_event(db, str(snapshot["id"]), status="dead_letter",
            last_error="Aviso expirado, revogado, não liberado ou contato/estado divergente.", worker_id=snapshot.get("locked_by"))
        return False
    from .central_whatsapp import dispatch_registered_message
    return dispatch_registered_message(db, snapshot, transport_configuration(), *resolved, customer=True)

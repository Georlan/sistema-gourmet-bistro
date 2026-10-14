"""Pilot-only central WhatsApp comanda channel; never an order source of truth.

This channel uses one explicitly authorized restaurant and one explicitly
authorized operator. It is independent of tenant-linked WhatsApp instances.
All rollout variables are empty/off by default; never copy operator or sender
phones into code, commits, logs or outbox payloads.
"""
from __future__ import annotations

import datetime as dt
import os
import re
import uuid
from dataclasses import dataclass
from decimal import Decimal
from urllib.parse import quote

import httpx
from sqlalchemy.orm import Session

from ..domain.orders.events import OrderCreated
from ..domain.orders.types import OrderChannel
from ..models import Comanda, ConfiguracaoRestaurante
from .outbox.publisher import enqueue_outbox_event_in_session
from .tenant_order_whatsapp import _locked_whatsapp_config_query, _snapshot_alert_items, normalize_phone

EVENT_NAME = "koma.whatsapp.central_operator_order"
EVENT_NAMESPACE = uuid.UUID("51a975e6-81d3-49b2-8dba-48d8c39d9897")
_INSTANCE_RE = re.compile(r"^[a-zA-Z0-9._-]{1,100}$")


@dataclass(frozen=True)
class CentralOperatorAlert:
    restaurant_id: int
    order_id: str
    event_id: str
    check_id: str | None
    display_number: str
    fulfillment: str
    total: str


def pilot_configuration() -> tuple[int, str, str, str, str] | None:
    """Fail closed; one restaurant and two verified telephone values, never mass fanout."""
    if os.getenv("KOMA_CENTRAL_WA_ENABLED", "false").strip().lower() != "true":
        return None
    rid_text = os.getenv("KOMA_CENTRAL_WA_PILOT_RESTAURANT_ID", "").strip()
    target = os.getenv("KOMA_CENTRAL_WA_OPERATOR_PHONE", "").strip()
    sender = os.getenv("KOMA_CENTRAL_WA_SENDER_PHONE", "").strip()
    instance = os.getenv("KOMA_CENTRAL_WA_INSTANCE_NAME", "").strip()
    test_customer = os.getenv("KOMA_CENTRAL_WA_PILOT_CUSTOMER_PHONE", "").strip()
    if not rid_text.isdecimal() or int(rid_text) < 1 or not _INSTANCE_RE.fullmatch(instance):
        return None
    if instance.startswith("koma-restaurant-"):
        return None
    try:
        target_phone = normalize_phone(target)
        sender_phone = normalize_phone(sender)
        customer_phone = normalize_phone(test_customer)
    except ValueError:
        return None
    if target_phone == sender_phone:
        return None
    return int(rid_text), target_phone, sender_phone, instance, customer_phone


def enabled_for(restaurant_id: int) -> bool:
    config = pilot_configuration()
    return config is not None and config[0] == int(restaurant_id)


def enqueue_operator_alert(db: Session, order: OrderCreated):
    """Only register at the same transaction boundary as a released online order."""
    if order.channel != OrderChannel.WEB_CARDAPIO or not enabled_for(order.restaurant_id):
        return None
    config = pilot_configuration()
    try:
        # Restrict pilot sends to an explicitly authorized test checkout phone.
        if config is None or normalize_phone(order.customer_phone or "") != config[4]:
            return None
    except ValueError:
        return None
    tenant = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=order.restaurant_id).one_or_none()
    if tenant is None or tenant.whatsapp_alerts_enabled:
        # One WhatsApp operator channel at a time; never duplicate with the tenant instance.
        return None
    event = CentralOperatorAlert(
        restaurant_id=order.restaurant_id,
        order_id=str(order.order_id),
        event_id=str(uuid.uuid5(EVENT_NAMESPACE, f"{order.restaurant_id}:{order.order_id}:operator")),
        check_id=str(order.check_id) if order.check_id is not None else None,
        display_number=str(order.check_number or order.display_number or order.order_id)[:32],
        fulfillment=getattr(order.fulfillment, "value", str(order.fulfillment)),
        total=str(Decimal(str(order.total)).quantize(Decimal("0.01"))),
    )
    record = enqueue_outbox_event_in_session(
        db, event, event_name=EVENT_NAME,
        aggregate_type="central_whatsapp_operator", aggregate_id=event.order_id,
    )
    record.max_attempts = 2
    return record


def render_operator_message(db: Session, payload: dict) -> str:
    """Derive the comanda from tenant-scoped records, not stored WhatsApp PII."""
    rid = int(payload["restaurant_id"])
    check_id = payload.get("check_id")
    comanda = (
        db.query(Comanda)
        .filter(Comanda.restaurante_id == rid, Comanda.id == check_id)
        .one_or_none()
        if check_id else None
    )
    name = "Cliente"
    if comanda and comanda.identificador:
        name = " ".join(str(comanda.identificador).split())[:70]
    kind = {"delivery": "Entrega", "pickup": "Retirada", "dine_in": "Local"}.get(
        str(payload.get("fulfillment")), "Pedido online"
    )
    number = re.sub(r"[^a-zA-Z0-9#_-]", "", str(payload.get("display_number") or ""))[:32]
    total = Decimal(str(payload["total"])).quantize(Decimal("0.01"))
    lines = [
        "KÔMA | Nova comanda online",
        f"Pedido #{number}",
        f"Cliente: {name}",
        f"Modalidade: {kind}",
        "",
        "Itens:",
    ]
    items = _snapshot_alert_items(
        db, restaurant_id=rid, order_id=str(payload["order_id"])
    )
    for item in items:
        lines.append(f"{item.quantity}x {item.name}")
        if item.modifiers:
            lines.append("  + " + ", ".join(item.modifiers))
        if item.notes:
            lines.append("  Obs.: " + item.notes)
    if not items:
        lines.append("Confira os itens no KÔMA.")
    lines += ["", f"Total: R$ {str(total).replace('.', ',')}", "", "Abra o KÔMA para conferir e aceitar. Não responda a esta mensagem para aceitar."]
    message = "\n".join(lines)
    return message if len(message) <= 3000 else message[:2890].rstrip() + "\n…\nConfira o pedido completo no KÔMA."


def _provider_sender_matches(client: httpx.Client, base: str, headers: dict, instance: str, sender: str) -> bool:
    instance_path = quote(instance, safe="")
    status = client.get(f"{base}/instance/connectionState/{instance_path}", headers=headers)
    status.raise_for_status()
    state = status.json()
    instance_status = state.get("instance") if isinstance(state, dict) else None
    if not isinstance(instance_status, dict) or instance_status.get("state") != "open":
        return False
    response = client.get(f"{base}/instance/fetchInstances", params={"instanceName": instance}, headers=headers)
    response.raise_for_status()
    data = response.json()
    for entry in data if isinstance(data, list) else [data]:
        if not isinstance(entry, dict) or entry.get("name", entry.get("instanceName")) != instance:
            continue
        jid = entry.get("ownerJid") or entry.get("owner")
        if not isinstance(jid, str):
            continue
        raw = jid.split("@", 1)[0].split(":", 1)[0]
        try:
            return normalize_phone(raw) == sender
        except ValueError:
            return False
    return False


def dispatch_operator_alert(db: Session, snapshot: dict) -> bool:
    """One send attempt. Ambiguous results never cause automatic duplicate sends."""
    from .outbox.dispatcher import settle_outbox_event

    rid = int(snapshot["restaurante_id"])
    outbox_id = str(snapshot["id"])
    worker_id = snapshot.get("locked_by")

    def settle(status: str, reason: str, *, attempts: int | None = None, retry_at=None, code=None) -> bool:
        settle_outbox_event(
            db, outbox_id, status=status,
            attempts=attempts if attempts is not None else int(snapshot["attempts"]),
            next_retry_at=retry_at, response_status_code=code,
            last_error=reason, worker_id=worker_id,
        )
        return status == "delivered"

    config = pilot_configuration()
    if config is None or config[0] != rid:
        return settle("delivered", "Piloto central desativado ou restaurante não autorizado.")
    if int(snapshot["payload"].get("restaurant_id", -1)) != rid:
        return settle("dead_letter", "Evento e restaurante divergentes.")

    check_id = snapshot["payload"].get("check_id")
    check = (
        db.query(Comanda)
        .filter(Comanda.restaurante_id == rid, Comanda.id == str(check_id))
        .one_or_none()
        if check_id else None
    )
    try:
        if check is None or normalize_phone(check.delivery_telefone or "") != config[4]:
            return settle("delivered", "Pedido não autorizado para teste do canal central.")
    except ValueError:
        return settle("delivered", "Telefone de teste indisponível.")

    settings = _locked_whatsapp_config_query(db, rid).one_or_none()
    if settings is None:
        return settle("dead_letter", "Configuração operacional ausente.")
    if settings.whatsapp_alerts_enabled:
        return settle("delivered", "WhatsApp individual ativo; aviso central dispensado.")
    now = dt.datetime.now(dt.timezone.utc)
    due = settings.whatsapp_next_send_at
    if due and (due.replace(tzinfo=dt.timezone.utc) if due.tzinfo is None else due) > now:
        return settle("failed", "Limite de vazão do piloto.", retry_at=due)

    base = os.getenv("EVOLUTION_API_URL", "").strip().rstrip("/")
    key = os.getenv("EVOLUTION_API_KEY", "").strip()
    if not (base.startswith("https://") or base.startswith("http://")) or not key:
        return settle("dead_letter", "Evolution não configurada.")

    pilot_rid, target, sender, instance, _test_customer = config
    headers = {"apikey": key, "Accept": "application/json"}
    message = render_operator_message(db, snapshot["payload"])
    # Hold the tenant config lock only while reserving the next send slot.
    # A single pilot tenant makes this reservation global for the central number.
    settings.whatsapp_next_send_at = now + dt.timedelta(seconds=15)
    from ..models import IntegrationOutbox
    event = db.query(IntegrationOutbox).filter(
        IntegrationOutbox.id == outbox_id,
        IntegrationOutbox.restaurante_id == pilot_rid,
        IntegrationOutbox.locked_by == worker_id,
    ).one_or_none()
    if event is None:
        return False
    attempt_number = int(snapshot["attempts"]) + 1
    event.attempts = attempt_number
    db.commit()  # Release all SQL locks BEFORE provider HTTP requests.

    def unavailable(reason: str) -> bool:
        if attempt_number >= int(snapshot["max_attempts"]):
            return settle("dead_letter", reason, attempts=attempt_number)
        return settle(
            "failed", reason, attempts=attempt_number,
            retry_at=dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5),
        )

    try:
        with httpx.Client(timeout=4.0) as client:
            if not _provider_sender_matches(client, base, headers, instance, sender):
                return unavailable("Remetente não conectado ou identidade incompatível.")
    except (httpx.HTTPError, ValueError, TypeError, AttributeError):
        return unavailable("Estado do remetente indisponível.")

    try:
        with httpx.Client(timeout=4.0) as client:
            response = client.post(
                f"{base}/message/sendText/{quote(instance, safe='')}",
                headers={**headers, "Content-Type": "application/json"},
                json={"number": target, "text": message},
            )
        if 200 <= response.status_code < 300:
            return settle("delivered", "Aceito pelo conector; entrega no aparelho não verificada.",
                          attempts=attempt_number, code=response.status_code)
        # An HTTP 429 explicitly refuses the send; retry no sooner than five minutes.
        if response.status_code == 429 and attempt_number < int(snapshot["max_attempts"]):
            return settle("failed", "Limite do provedor.",
                          attempts=attempt_number,
                          retry_at=dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5),
                          code=429)
        return settle("dead_letter", f"Provedor recusou HTTP {response.status_code}.",
                      attempts=attempt_number, code=response.status_code)
    except httpx.RequestError:
        return settle("dead_letter", "Resultado de envio incerto; repetição automática bloqueada.",
                      attempts=attempt_number)

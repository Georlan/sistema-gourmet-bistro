"""Optional WhatsApp redundancy for online orders, isolated by restaurant."""

from __future__ import annotations

import datetime as dt
import re
import uuid
from dataclasses import dataclass
from decimal import Decimal
from urllib.parse import quote

import httpx
from sqlalchemy import and_
from sqlalchemy.orm import Session

from ..config import settings
from ..domain.orders.events import OrderCreated
from ..domain.orders.types import OrderChannel
from ..models import (
    ConfiguracaoRestaurante,
    IntegrationOutbox,
    Item,
    ItemModificador,
    OpcaoModificador,
    Produto,
)
from .outbox.publisher import enqueue_outbox_event_in_session

EVENT_NAME = "koma.whatsapp.order_created"
EVENT_NAMESPACE = uuid.UUID("9583d59f-6d89-4584-8c44-28182d7bc602")


def instance_name(restaurant_id: int) -> str:
    return f"koma-restaurant-{int(restaurant_id)}"


def normalize_phone(value: str) -> str:
    phone = re.sub(r"\D", "", value or "")
    if len(phone) in (10, 11):
        phone = "55" + phone
    if not re.fullmatch(r"55\d{10,11}", phone):
        raise ValueError("Informe um WhatsApp brasileiro com DDD.")
    return phone


def phones_match(left: str | None, right: str | None) -> bool:
    if not left or not right:
        return False
    try:
        left_normalized = normalize_phone(left)
        right_normalized = normalize_phone(right)
    except ValueError:
        return False
    if left_normalized == right_normalized:
        return True

    def legacy_mobile_form(value: str) -> str:
        national = value[2:]
        if len(national) == 11 and national[2] == "9":
            return value[:4] + national[3:]
        return value

    return legacy_mobile_form(left_normalized) == legacy_mobile_form(right_normalized)


@dataclass(frozen=True)
class _AlertItem:
    name: str
    quantity: int
    notes: str | None = None
    modifiers: tuple[str, ...] = ()


@dataclass(frozen=True)
class _AlertEvent:
    restaurant_id: int
    order_id: str
    event_id: str
    display_number: str
    fulfillment: str
    total: str
    items_count: int
    customer_name: str | None
    items: tuple[_AlertItem, ...]


def _clean_alert_text(value: object, *, max_length: int) -> str:
    cleaned = " ".join(str(value or "").split())
    return cleaned[:max_length]


def _snapshot_alert_items(
    db: Session,
    *,
    restaurant_id: int,
    order_id: str,
) -> tuple[_AlertItem, ...]:
    rows = (
        db.query(Item, Produto.nome)
        .join(
            Produto,
            and_(
                Produto.restaurante_id == Item.restaurante_id,
                Produto.id == Item.produto_id,
            ),
        )
        .filter(
            Item.restaurante_id == restaurant_id,
            Item.lancamento_id == str(order_id),
            Item.status != "cancelado",
        )
        .all()
    )
    if not rows:
        return ()

    item_ids = [item.id for item, _name in rows]
    modifier_names: dict[str, list[str]] = {}
    modifier_rows = (
        db.query(ItemModificador.item_id, OpcaoModificador.nome)
        .join(
            OpcaoModificador,
            and_(
                OpcaoModificador.restaurante_id == ItemModificador.restaurante_id,
                OpcaoModificador.id == ItemModificador.opcao_modificador_id,
            ),
        )
        .filter(
            ItemModificador.restaurante_id == restaurant_id,
            ItemModificador.item_id.in_(item_ids),
        )
        .order_by(ItemModificador.id.asc())
        .all()
    )
    for item_id, modifier_name in modifier_rows:
        modifier_names.setdefault(str(item_id), []).append(
            _clean_alert_text(modifier_name, max_length=80)
        )

    grouped: dict[tuple[str, str, tuple[str, ...]], int] = {}
    for item, product_name in rows:
        name = _clean_alert_text(product_name, max_length=120) or "Item"
        notes = _clean_alert_text(item.observacao, max_length=240)
        modifiers = tuple(modifier_names.get(str(item.id), ()))
        key = (name, notes, modifiers)
        grouped[key] = grouped.get(key, 0) + 1

    return tuple(
        _AlertItem(
            name=name,
            quantity=quantity,
            notes=notes or None,
            modifiers=modifiers,
        )
        for (name, notes, modifiers), quantity in grouped.items()
    )


def enqueue_order_alert(db: Session, order: OrderCreated) -> IntegrationOutbox | None:
    """Only a local DB write; never contacts WhatsApp in the order transaction."""
    if order.channel != OrderChannel.WEB_CARDAPIO:
        return None
    config = db.query(ConfiguracaoRestaurante).filter(
        ConfiguracaoRestaurante.restaurante_id == order.restaurant_id,
        ConfiguracaoRestaurante.whatsapp_alerts_enabled.is_(True),
    ).first()
    if not config or config.whatsapp_instance_name != instance_name(order.restaurant_id):
        return None
    event_id = str(uuid.uuid5(EVENT_NAMESPACE, f"{order.restaurant_id}:{order.order_id}"))
    for pending in db.new:
        if isinstance(pending, IntegrationOutbox) and pending.restaurante_id == order.restaurant_id and pending.event_id == event_id:
            return pending
    existing = db.query(IntegrationOutbox).filter(
        IntegrationOutbox.restaurante_id == order.restaurant_id,
        IntegrationOutbox.event_id == event_id,
    ).first()
    if existing:
        return existing
    items = _snapshot_alert_items(
        db,
        restaurant_id=order.restaurant_id,
        order_id=str(order.order_id),
    )
    event = _AlertEvent(
        restaurant_id=order.restaurant_id,
        order_id=str(order.order_id),
        event_id=event_id,
        display_number=str(order.check_number or order.display_number or order.order_id)[:32],
        fulfillment=str(order.fulfillment),
        total=str(Decimal(str(order.total)).quantize(Decimal("0.01"))),
        items_count=max(0, int(order.items_count)),
        customer_name=_clean_alert_text(order.customer_name, max_length=120) or None,
        items=items,
    )
    record = enqueue_outbox_event_in_session(
        db, event, event_name=EVENT_NAME, aggregate_type="order",
        aggregate_id=str(order.order_id),
    )
    record.max_attempts = 3
    return record


def _provider() -> tuple[str, dict[str, str]]:
    base = settings.EVOLUTION_API_URL.strip().rstrip("/")
    key = settings.EVOLUTION_API_KEY.strip()
    if not base or not key or not base.startswith(("https://", "http://")):
        raise RuntimeError("Evolution indisponível para integração do restaurante.")
    return base, {"apikey": key, "Accept": "application/json"}


def _request(
    method: str,
    path: str,
    *,
    body: dict | None = None,
    timeout_seconds: float = 4.0,
) -> dict:
    base, headers = _provider()
    with httpx.Client(timeout=timeout_seconds) as client:
        response = client.request(method, f"{base}{path}", headers=headers, json=body)
        response.raise_for_status()
        result = response.json()
    return result if isinstance(result, dict) else {}


def create_instance(restaurant_id: int, *, phone: str | None = None) -> dict:
    # Criar a sessão e preparar o QR/pairing code pode levar alguns segundos.
    # Na Evolution v2.3.7, o número precisa estar presente desde a criação para
    # o Baileys gerar um pairing code realmente utilizável no mesmo celular.
    body = {
        "instanceName": instance_name(restaurant_id),
        "integration": "WHATSAPP-BAILEYS",
        "qrcode": True,
    }
    if phone:
        body["number"] = normalize_phone(phone)
    return _request("POST", "/instance/create", body=body, timeout_seconds=15.0)


def connect_instance(restaurant_id: int) -> dict:
    # Gerar/renovar o QR também é uma operação de controle potencialmente lenta.
    return _request(
        "GET",
        f"/instance/connect/{quote(instance_name(restaurant_id))}",
        timeout_seconds=15.0,
    )


def _pairing_code(data: dict) -> str | None:
    candidates = [
        data.get("pairingCode"),
        data.get("pairing_code"),
    ]
    qrcode = data.get("qrcode")
    if isinstance(qrcode, dict):
        candidates.extend([
            qrcode.get("pairingCode"),
            qrcode.get("pairing_code"),
        ])
    for value in candidates:
        if not isinstance(value, str):
            continue
        cleaned = re.sub(r"[^A-Za-z0-9]", "", value).upper()
        if 6 <= len(cleaned) <= 12:
            return cleaned
    return None


def connect_instance_with_pairing_code(restaurant_id: int, phone: str) -> str:
    """Request a pairing code for an existing closed instance."""
    normalized = normalize_phone(phone)
    data = _request(
        "GET",
        f"/instance/connect/{quote(instance_name(restaurant_id))}?number={quote(normalized)}",
        timeout_seconds=15.0,
    )
    code = _pairing_code(data)
    if code:
        return code
    raise RuntimeError("Evolution não retornou um código de pareamento.")


def create_instance_with_pairing_code(restaurant_id: int, phone: str) -> tuple[dict, str]:
    """Create a fresh Evolution v2.3.7 session with the number from the first handshake."""
    data = create_instance(restaurant_id, phone=phone)
    code = _pairing_code(data)
    if code:
        return data, code
    # Defensive fallback for providers that return the QR payload before exposing
    # pairingCode but already stored the number in the freshly created session.
    return data, connect_instance_with_pairing_code(restaurant_id, phone)


def delete_instance(restaurant_id: int) -> None:
    _request(
        "DELETE",
        f"/instance/delete/{quote(instance_name(restaurant_id))}",
        timeout_seconds=15.0,
    )


def recreate_instance_with_pairing_code(restaurant_id: int, phone: str) -> tuple[dict, str]:
    """Rebuild a not-yet-connected session so v2.3.7 receives the number at creation."""
    try:
        if connection_state(restaurant_id) == "open":
            raise RuntimeError("WhatsApp já conectado.")
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code != 404:
            raise

    try:
        delete_instance(restaurant_id)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code != 404:
            raise
    return create_instance_with_pairing_code(restaurant_id, phone)


def logout_instance(restaurant_id: int) -> None:
    _request("DELETE", f"/instance/logout/{quote(instance_name(restaurant_id))}")


def connection_state(restaurant_id: int) -> str:
    result = _request("GET", f"/instance/connectionState/{quote(instance_name(restaurant_id))}")
    instance = result.get("instance")
    return str(instance.get("state", "unknown")) if isinstance(instance, dict) else "unknown"


def owner_phone(restaurant_id: int) -> str | None:
    base, headers = _provider()
    with httpx.Client(timeout=4.0) as client:
        response = client.get(
            f"{base}/instance/fetchInstances",
            params={"instanceName": instance_name(restaurant_id)}, headers=headers,
        )
        response.raise_for_status()
        data = response.json()
    entries = data if isinstance(data, list) else [data]
    for item in entries:
        if not isinstance(item, dict):
            continue
        if item.get("name") != instance_name(restaurant_id) and item.get("instanceName") != instance_name(restaurant_id):
            continue
        jid = item.get("ownerJid") or item.get("owner")
        if isinstance(jid, str):
            number = jid.split("@", 1)[0].split(":", 1)[0]
            return number if re.fullmatch(r"55\d{10,11}", number) else None
    return None


def render_alert(payload: dict) -> str:
    kind = {
        "delivery": "Delivery",
        "pickup": "Retirada",
        "dine_in": "Consumo no local",
    }.get(str(payload.get("fulfillment") or ""), "Pedido online")
    amount = Decimal(str(payload.get("total", "0"))).quantize(Decimal("0.01"))
    number = re.sub(r"[^\w-]", "", str(payload.get("display_number", "")))[:32]
    customer = _clean_alert_text(payload.get("customer_name"), max_length=120) or "Cliente"

    lines = [
        f"Novo pedido #{number}",
        f"Cliente: {customer}",
        f"{kind} · R$ {str(amount).replace('.', ',')}",
        "",
        "Pedido:",
    ]
    items = payload.get("items")
    if isinstance(items, list) and items:
        for raw_item in items:
            if not isinstance(raw_item, dict):
                continue
            quantity = max(1, int(raw_item.get("quantity", 1)))
            name = _clean_alert_text(raw_item.get("name"), max_length=120) or "Item"
            lines.append(f"{quantity}x {name}")
            modifiers = raw_item.get("modifiers")
            if isinstance(modifiers, list) and modifiers:
                clean_modifiers = [
                    _clean_alert_text(modifier, max_length=80)
                    for modifier in modifiers
                    if _clean_alert_text(modifier, max_length=80)
                ]
                if clean_modifiers:
                    lines.append("  + " + ", ".join(clean_modifiers))
            notes = _clean_alert_text(raw_item.get("notes"), max_length=240)
            if notes:
                lines.append(f"  Obs.: {notes}")
    else:
        count = max(0, int(payload.get("items_count", 0)))
        lines.append(f"{count} itens")

    lines.extend(["", "Abra o KÔMA para acompanhar e avançar o pedido."])
    message = "\n".join(lines)
    if len(message) <= 3500:
        return message
    return message[:3440].rstrip() + "\n…\nAbra o KÔMA para acompanhar."


def _aware(value: dt.datetime | None) -> dt.datetime | None:
    return value.replace(tzinfo=dt.timezone.utc) if value and value.tzinfo is None else value


def _record_failure(db: Session, config: ConfiguracaoRestaurante) -> None:
    config.whatsapp_consecutive_failures = int(config.whatsapp_consecutive_failures or 0) + 1
    if config.whatsapp_consecutive_failures >= 3:
        config.whatsapp_circuit_open_until = dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5)
    db.commit()


def _locked_whatsapp_config_query(db: Session, restaurant_id: int):
    # ConfiguracaoRestaurante has eager relationships that can generate a LEFT
    # OUTER JOIN. PostgreSQL rejects plain FOR UPDATE against the nullable side
    # of that join. Disable eager joins and explicitly lock only the config row.
    return (
        db.query(ConfiguracaoRestaurante)
        .enable_eagerloads(False)
        .filter(ConfiguracaoRestaurante.restaurante_id == restaurant_id)
        .with_for_update(of=ConfiguracaoRestaurante)
    )


def mark_terminal(db: Session, snapshot: dict, *, status: str, reason: str, http_status: int | None = None) -> bool:
    from .outbox.dispatcher import settle_outbox_event
    settled = settle_outbox_event(
        db, str(snapshot["id"]), status=status,
        attempts=int(snapshot["attempts"]) + 1,
        response_status_code=http_status,
        last_error=reason, worker_id=snapshot.get("locked_by"),
    )
    return settled and status == "delivered"


def dispatch_alert(db: Session, snapshot: dict) -> bool:
    """At most one uncertain provider attempt. A crash after send is dead-lettered."""
    from .outbox.dispatcher import settle_outbox_event

    rid = int(snapshot["restaurante_id"])
    config = _locked_whatsapp_config_query(db, rid).first()
    if not config or not config.whatsapp_alerts_enabled:
        return mark_terminal(db, snapshot, status="delivered", reason="Avisos desativados.")
    if config.whatsapp_instance_name != instance_name(rid) or not config.whatsapp_recipient_phone:
        return mark_terminal(db, snapshot, status="dead_letter", reason="Associação do restaurante incompleta.")

    now = dt.datetime.now(dt.timezone.utc)
    if _aware(config.whatsapp_circuit_open_until) and _aware(config.whatsapp_circuit_open_until) > now:
        settle_outbox_event(
            db, str(snapshot["id"]), status="failed", attempts=int(snapshot["attempts"]),
            next_retry_at=_aware(config.whatsapp_circuit_open_until),
            last_error="Circuito temporariamente aberto.", worker_id=snapshot.get("locked_by"),
        )
        return False
    if _aware(config.whatsapp_next_send_at) and _aware(config.whatsapp_next_send_at) > now:
        settle_outbox_event(
            db, str(snapshot["id"]), status="failed", attempts=int(snapshot["attempts"]),
            next_retry_at=_aware(config.whatsapp_next_send_at),
            last_error="Aguardando limite de envio.", worker_id=snapshot.get("locked_by"),
        )
        return False

    # WhatsApp is only a secondary operational alert channel. Pace automated
    # sends per restaurant so a rush never becomes a burst of near-simultaneous
    # messages. The Kanban remains immediate; only the redundant alert waits.
    config.whatsapp_next_send_at = now + dt.timedelta(
        seconds=settings.TENANT_WHATSAPP_MIN_SEND_INTERVAL_SECONDS
    )
    db.commit()

    # A disconnected provider has not accepted the message, so delayed retry is safe.
    try:
        if connection_state(rid) != "open" or not phones_match(
            owner_phone(rid),
            config.whatsapp_recipient_phone,
        ):
            raise RuntimeError("WhatsApp desconectado ou número vinculado diferente.")
    except Exception:
        _record_failure(db, config)
        attempts = int(snapshot["attempts"]) + 1
        terminal = attempts >= int(snapshot["max_attempts"])
        settle_outbox_event(
            db, str(snapshot["id"]),
            status="dead_letter" if terminal else "failed", attempts=attempts,
            next_retry_at=dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=min(300, 20 * 2 ** attempts)),
            last_error="Conexão indisponível antes do envio.", worker_id=snapshot.get("locked_by"),
        )
        return False

    # Persist the attempt before the network call. If the worker crashes or the
    # response is ambiguous, recovery must not send the same order twice.
    event = db.query(IntegrationOutbox).filter(
        IntegrationOutbox.id == snapshot["id"],
        IntegrationOutbox.restaurante_id == rid,
        IntegrationOutbox.locked_by == snapshot.get("locked_by"),
    ).first()
    if event is None:
        return False
    base, headers = _provider()
    event.attempts = int(snapshot["attempts"]) + 1
    db.commit()
    try:
        with httpx.Client(timeout=4.0) as client:
            response = client.post(
                f"{base}/message/sendText/{quote(instance_name(rid))}",
                headers=headers,
                json={"number": config.whatsapp_recipient_phone, "text": render_alert(snapshot["payload"])},
            )
        if 200 <= response.status_code < 300:
            config.whatsapp_consecutive_failures = 0
            config.whatsapp_circuit_open_until = None
            db.commit()
            return mark_terminal(db, snapshot, status="delivered", reason="Enviado.", http_status=response.status_code)
        if response.status_code == 429 and event.attempts < int(snapshot["max_attempts"]):
            _record_failure(db, config)
            settle_outbox_event(
                db, str(snapshot["id"]), status="failed", attempts=event.attempts,
                next_retry_at=dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=120),
                response_status_code=429, last_error="Limite do provedor; tentativa posterior.",
                worker_id=snapshot.get("locked_by"),
            )
            return False
        _record_failure(db, config)
        return mark_terminal(db, snapshot, status="dead_letter", reason=f"Provedor HTTP {response.status_code}.", http_status=response.status_code)
    except httpx.RequestError:
        _record_failure(db, config)
        return mark_terminal(db, snapshot, status="dead_letter", reason="Resposta incerta do provedor.")

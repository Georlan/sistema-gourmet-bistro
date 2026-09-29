"""Optional WhatsApp redundancy for online orders, isolated by restaurant."""

from __future__ import annotations

import datetime as dt
import re
import uuid
from dataclasses import dataclass
from decimal import Decimal
from urllib.parse import quote

import httpx
from sqlalchemy.orm import Session

from ..config import settings
from ..domain.orders.events import OrderCreated
from ..domain.orders.types import OrderChannel
from ..models import ConfiguracaoRestaurante, IntegrationOutbox
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


@dataclass(frozen=True)
class _AlertEvent:
    restaurant_id: int
    order_id: str
    event_id: str
    display_number: str
    fulfillment: str
    total: str
    items_count: int


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
    event = _AlertEvent(
        restaurant_id=order.restaurant_id,
        order_id=str(order.order_id),
        event_id=event_id,
        display_number=str(order.display_number or order.check_number or order.order_id)[:32],
        fulfillment=str(order.fulfillment),
        total=str(Decimal(str(order.total)).quantize(Decimal("0.01"))),
        items_count=max(0, int(order.items_count)),
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


def create_instance(restaurant_id: int) -> dict:
    # Criar a sessão e preparar o QR pode levar alguns segundos no Evolution.
    # O timeout curto de 4s usado para leituras/status fazia o cliente HTTP
    # encerrar a requisição antes de o provider responder, gerando 499 no Railway.
    return _request("POST", "/instance/create", body={
        "instanceName": instance_name(restaurant_id),
        "integration": "WHATSAPP-BAILEYS",
        "qrcode": True,
    }, timeout_seconds=15.0)


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
    """Request a same-device pairing code without exposing provider credentials."""
    normalized = normalize_phone(phone)
    name = quote(instance_name(restaurant_id))

    # Evolution v2 Baileys commonly accepts the number query parameter.
    # Some 2.3.x builds expose the newer pairingCode/phoneNumber spelling.
    # Try the compatible path first and only fall back when no code is returned.
    data = _request(
        "GET",
        f"/instance/connect/{name}?number={quote(normalized)}",
        timeout_seconds=15.0,
    )
    code = _pairing_code(data)
    if code:
        return code

    data = _request(
        "GET",
        f"/instance/connect/{name}?pairingCode=true&phoneNumber={quote(normalized)}",
        timeout_seconds=15.0,
    )
    code = _pairing_code(data)
    if code:
        return code
    raise RuntimeError("Evolution não retornou um código de pareamento.")


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
    kind = "Delivery" if payload.get("fulfillment") == "delivery" else "Retirada"
    amount = Decimal(str(payload.get("total", "0"))).quantize(Decimal("0.01"))
    number = re.sub(r"[^\w-]", "", str(payload.get("display_number", "")))[:32]
    count = max(0, int(payload.get("items_count", 0)))
    return f"Novo pedido #{number}\n{kind} · R$ {str(amount).replace('.', ',')}\n{count} itens\nAbra o KÔMA para acompanhar."


def _aware(value: dt.datetime | None) -> dt.datetime | None:
    return value.replace(tzinfo=dt.timezone.utc) if value and value.tzinfo is None else value


def _record_failure(db: Session, config: ConfiguracaoRestaurante) -> None:
    config.whatsapp_consecutive_failures = int(config.whatsapp_consecutive_failures or 0) + 1
    if config.whatsapp_consecutive_failures >= 3:
        config.whatsapp_circuit_open_until = dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5)
    db.commit()


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
    config = db.query(ConfiguracaoRestaurante).filter(
        ConfiguracaoRestaurante.restaurante_id == rid,
    ).with_for_update().first()
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
        if connection_state(rid) != "open" or owner_phone(rid) != config.whatsapp_recipient_phone:
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

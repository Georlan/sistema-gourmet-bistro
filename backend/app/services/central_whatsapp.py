"""Shared Business comanda transport with a dynamically registered tenant recipient.

Rollout remains explicitly allowlisted and default-off. Destinations always come from
the same restaurant registration, never an environment variable or buyer phone.
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
from .tenant_order_whatsapp import _locked_whatsapp_config_query, _snapshot_alert_items, normalize_phone, phones_match

CENTRAL_INSTANCE_MARKER = "koma-central"  # Tenant config marker; never an Evolution instance.
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


@dataclass(frozen=True)
class CentralConfiguration:
    restaurant_ids: frozenset[int]
    sender: str
    instance: str


def allowed_restaurants(variable: str) -> frozenset[int]:
    # Legacy single-tenant rollout remains compatible. No wildcard/all-tenants
    # mode and no fallback if an explicit allowlist is malformed or empty.
    raw = os.getenv(variable)
    if raw is None:
        raw = os.getenv("KOMA_CENTRAL_WA_PILOT_RESTAURANT_ID", "").strip()
        if not raw.isdecimal():
            return frozenset()
    parts = [part.strip() for part in raw.split(",")]
    if not parts or any(not part.isdecimal() or int(part) < 1 for part in parts):
        return frozenset()
    return frozenset(map(int, parts))


def pilot_configuration() -> CentralConfiguration | None:
    """Shared Business transport with an explicit tenant allowlist; default-off."""
    if os.getenv("KOMA_CENTRAL_WA_ENABLED", "false").strip().lower() != "true":
        return None
    allowed = allowed_restaurants("KOMA_CENTRAL_WA_ALLOWED_RESTAURANT_IDS")
    instance = os.getenv("KOMA_CENTRAL_WA_INSTANCE_NAME", "").strip()
    if not allowed or not _INSTANCE_RE.fullmatch(instance):
        return None
    if instance.startswith("koma-restaurant-"):
        return None
    try:
        sender = normalize_phone(os.getenv("KOMA_CENTRAL_WA_SENDER_PHONE", ""))
    except ValueError:
        return None
    return CentralConfiguration(allowed, sender, instance)


def enabled_for(restaurant_id: int) -> bool:
    config = pilot_configuration()
    return config is not None and int(restaurant_id) in config.restaurant_ids


def registered_operator_phone(tenant: ConfiguracaoRestaurante | None, sender: str) -> str | None:
    if tenant is None or tenant.whatsapp_instance_name != CENTRAL_INSTANCE_MARKER or tenant.whatsapp_alerts_enabled:
        return None
    try:
        phone = normalize_phone(tenant.whatsapp_recipient_phone or "")
    except ValueError:
        return None
    return phone if not phones_match(phone, sender) else None


def recipient_fingerprint(restaurant_id: int, phone: str) -> str:
    from .customer_auth import hash_public_rate_key
    # WhatsApp BR JIDs may omit the ninth mobile digit.
    value = normalize_phone(phone)
    if len(value) == 13 and value[4] == "9":
        value = value[:4] + value[5:]
    return hash_public_rate_key(restaurant_id, "whatsapp-recipient", value)


def enqueue_operator_alert(db: Session, order: OrderCreated):
    """Only register at the same transaction boundary as a released online order."""
    if order.channel != OrderChannel.WEB_CARDAPIO or not enabled_for(order.restaurant_id):
        return None
    config = pilot_configuration()
    tenant = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=order.restaurant_id).one_or_none()
    if config is None or registered_operator_phone(tenant, config.sender) is None:
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
        "*KÔMA | Nova comanda online*",
        f"*Pedido #{number}*",
        f"Cliente: {name}",
        f"Modalidade: {kind}",
        "",
        "*Itens:*",
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
    lines += ["", f"*Total: R$ {str(total).replace('.', ',')}*", "", "Aviso automático do KÔMA. Abra o painel para conferir e aceitar o pedido; esta conversa não recebe confirmações."]
    message = "\n".join(lines)
    return message if len(message) <= 3000 else message[:2890].rstrip() + "\n…\nConfira o pedido completo no KÔMA."


def _provider_sender_status(
    client: httpx.Client, base: str, headers: dict, instance: str, sender: str,
) -> str:
    """Read-only Evolution validation; never return/log phone numbers or JIDs.

    The Brazilian WhatsApp JID can omit the ninth mobile digit even when
    the paired Business account has the full E.164 number. Reuse the trusted
    tenant comparison rather than demanding identical textual representations.
    """
    instance_path = quote(instance, safe="")
    status = client.get(f"{base}/instance/connectionState/{instance_path}", headers=headers)
    status.raise_for_status()
    state = status.json()
    instance_status = state.get("instance") if isinstance(state, dict) else None
    if not isinstance(instance_status, dict) or instance_status.get("state") != "open":
        return "not_open"

    response = client.get(
        f"{base}/instance/fetchInstances",
        params={"instanceName": instance}, headers=headers,
    )
    response.raise_for_status()
    data = response.json()
    entries = data if isinstance(data, list) else [data]
    matched_instance = False
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        info = entry.get("instance")
        nested = info if isinstance(info, dict) else {}
        entry_name = entry.get("name") or entry.get("instanceName") or nested.get("instanceName")
        if entry_name != instance:
            continue
        matched_instance = True
        jid = entry.get("ownerJid") or entry.get("owner") or nested.get("ownerJid")
        if not isinstance(jid, str):
            continue
        raw = jid.split("@", 1)[0].split(":", 1)[0]
        if phones_match(raw, sender):
            return "matched"
        return "mismatch"
    return "owner_missing" if matched_instance else "instance_missing"


def _provider_sender_matches(
    client: httpx.Client, base: str, headers: dict, instance: str, sender: str,
) -> bool:
    """Backwards-compatible predicate for callers/tests."""
    return _provider_sender_status(client, base, headers, instance, sender) == "matched"


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
    if config is None or rid not in config.restaurant_ids:
        return settle("dead_letter", "Piloto central desativado ou restaurante não autorizado; nenhuma mensagem enviada.")
    if int(snapshot["payload"].get("restaurant_id", -1)) != rid:
        return settle("dead_letter", "Evento e restaurante divergentes.")

    from ..models import Lancamento
    check = db.query(Comanda).filter_by(restaurante_id=rid, id=str(snapshot["payload"].get("check_id"))).one_or_none()
    source = db.query(Lancamento).filter_by(restaurante_id=rid,
        id=str(snapshot["payload"].get("order_id")), comanda_id=check.id if check else "",
        origem="cardapio").one_or_none()
    if check is None or source is None or check.delivery_status in {"cancelado", "recusado", "finalizado"} or source.status in {"cancelado", "recusado"}:
        return settle("dead_letter", "Pedido ausente, encerrado ou divergente do restaurante.")
    from .customer_whatsapp_dispatch import snapshot_time
    age = dt.datetime.now(dt.timezone.utc) - snapshot_time(snapshot)
    if age < dt.timedelta(0) or age > dt.timedelta(minutes=10):
        return settle("dead_letter", "Aviso de comanda expirado; nenhuma mensagem enviada.")
    settings = _locked_whatsapp_config_query(db, rid).populate_existing().one_or_none()
    target = registered_operator_phone(settings, config.sender)
    if target is None:
        return settle("dead_letter", "Destinatário central ausente, removido ou não autorizado; nenhuma mensagem enviada.")
    return dispatch_registered_message(db, snapshot, config, target, render_operator_message(db, snapshot["payload"]))


def dispatch_registered_message(
    db: Session, snapshot: dict, config: CentralConfiguration, target: str, message: str,
    *, customer: bool = False,
) -> bool:
    """Persistent shared sender lane for operator and status notices.

    SQL locks are released before HTTP. A reserved/ambiguous attempt is never
    silently replayed. Every released tenant shares the same sender lock/clock.
    """
    from .outbox.dispatcher import settle_outbox_event
    rid = int(snapshot["restaurante_id"])
    outbox_id = str(snapshot["id"])
    worker_id = snapshot.get("locked_by")

    def settle(status: str, reason: str, *, attempts=None, retry_at=None, code=None):
        settle_outbox_event(db, outbox_id, status=status,
            attempts=int(snapshot["attempts"]) if attempts is None else attempts,
            next_retry_at=retry_at, response_status_code=code, last_error=reason, worker_id=worker_id)
        return status == "delivered"

    settings = _locked_whatsapp_config_query(db, rid).populate_existing().one_or_none()
    if settings is None:
        return settle("dead_letter", "Configuração do restaurante ausente.")
    if customer:
        from .customer_whatsapp_dispatch import customer_notices_enabled
        if not customer_notices_enabled(rid, settings):
            return settle("dead_letter", "Autorização para avisos ao cliente revogada.")
    elif registered_operator_phone(settings, config.sender) is None:
        return settle("dead_letter", "Cadastro central removido ou desativado.")
    from .whatsapp_sender_gate import lock_sender, wait_until
    sender_state = lock_sender(db, config)
    pause = wait_until(sender_state)
    if pause is not None:
        return settle("failed", "Remetente central em pausa; aviso mantido na fila.", retry_at=pause)
    if customer:
        from .customer_whatsapp_dispatch import budget_available
        if not budget_available(settings):
            return settle("dead_letter", "Cota de mensagens do restaurante atingida.")
    now = dt.datetime.now(dt.timezone.utc)
    due = settings.whatsapp_next_send_at
    if due and (due.replace(tzinfo=dt.timezone.utc) if due.tzinfo is None else due) > now:
        return settle("failed", "Limite de vazão do piloto.", retry_at=due)

    base = os.getenv("EVOLUTION_API_URL", "").strip().rstrip("/")
    key = os.getenv("EVOLUTION_API_KEY", "").strip()
    if not (base.startswith("https://") or base.startswith("http://")) or not key:
        return settle("dead_letter", "Evolution não configurada.")

    pilot_rid, sender, instance = rid, config.sender, config.instance
    headers = {"apikey": key, "Accept": "application/json"}
    # Reserve both the tenant lane and shared Business lane before HTTP.
    settings.whatsapp_next_send_at = now + dt.timedelta(seconds=15)
    sender_state.next_send_at = now + dt.timedelta(seconds=15)
    from ..models import IntegrationOutbox
    event = db.query(IntegrationOutbox).filter(
        IntegrationOutbox.id == outbox_id,
        IntegrationOutbox.restaurante_id == pilot_rid,
        IntegrationOutbox.locked_by == worker_id,
    ).one_or_none()
    if event is None:
        return False
    attempt_number = int(snapshot["attempts"]) + 1
    if customer:
        from .customer_whatsapp_dispatch import reserve_budget
        reserve_budget(settings)
    event.attempts = attempt_number
    event.processed_at = now  # Reservation time for conservative monthly accounting.
    db.commit()  # Release all SQL locks BEFORE provider HTTP requests.

    def unavailable(reason: str) -> bool:
        from .whatsapp_sender_gate import note_failure
        note_failure(db, config)
        if attempt_number >= int(snapshot["max_attempts"]):
            return settle("dead_letter", reason, attempts=attempt_number)
        return settle(
            "failed", reason, attempts=attempt_number,
            retry_at=dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5),
        )

    try:
        with httpx.Client(timeout=4.0) as client:
            verification = _provider_sender_status(client, base, headers, instance, sender)
            if verification != "matched":
                safe_reasons = {
                    "not_open": "Instância Business sem conexão aberta.",
                    "mismatch": "Número da sessão Business difere do remetente autorizado.",
                    "owner_missing": "Identidade do remetente não publicada pela Evolution.",
                    "instance_missing": "Instância Business esperada não consta na Evolution.",
                }
                return unavailable(safe_reasons.get(verification, "Remetente indisponível."))
    except (httpx.HTTPError, ValueError, TypeError, AttributeError):
        return unavailable("Estado do remetente indisponível.")

    # Provider validation can take seconds: reload consent and destination after it.
    db.expire_all()
    from ..models import IntegrationOutbox
    still_owned = db.query(IntegrationOutbox.id).filter_by(id=outbox_id, restaurante_id=rid,
        locked_by=worker_id, status="processing").first()
    if still_owned is None:
        db.rollback()
        return False
    current = pilot_configuration()
    latest_settings = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=rid).one_or_none()
    if current != config:
        return settle("dead_letter", "Liberação do remetente alterada antes do envio.", attempts=attempt_number)
    if customer:
        from .customer_whatsapp_dispatch import customer_notices_enabled
        if not customer_notices_enabled(rid, latest_settings):
            return settle("dead_letter", "Autorização do restaurante revogada antes do envio.", attempts=attempt_number)
    elif registered_operator_phone(latest_settings, config.sender) is None:
        return settle("dead_letter", "Cadastro do operador alterado antes do envio.", attempts=attempt_number)
    if customer:
        from .customer_whatsapp_dispatch import resolve_customer_notice
        resolved = resolve_customer_notice(db, snapshot)
        if resolved is None or not phones_match(resolved[0], target):
            return settle("dead_letter", "Consentimento, contato ou estado alterado antes do envio.", attempts=attempt_number)
    else:
        latest_target = registered_operator_phone(latest_settings, config.sender)
        if not phones_match(latest_target, target):
            return settle("dead_letter", "Destinatário alterado durante a tentativa; aguarde um novo pedido.", attempts=attempt_number)
    db.rollback()  # No read transaction held over the send.

    try:
        with httpx.Client(timeout=4.0) as client:
            response = client.post(
                f"{base}/message/sendText/{quote(instance, safe='')}",
                headers={**headers, "Content-Type": "application/json"},
                json={"number": target, "text": message},
            )
        if 200 <= response.status_code < 300:
            from .whatsapp_sender_gate import clear_failures
            clear_failures(db, config)
            return settle("delivered", "Aceito pelo conector; entrega no aparelho não verificada.",
                          attempts=attempt_number, code=response.status_code)
        # An HTTP 429 explicitly refuses the send; retry no sooner than five minutes.
        if response.status_code == 429:
            from .whatsapp_sender_gate import note_failure
            note_failure(db, config, immediate=True)
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

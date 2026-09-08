"""Web Push para acompanhamento de pedidos do Cardápio.

O browser endpoint e as chaves da PushSubscription são capabilities sensíveis:
ficam cifrados em repouso e nunca entram no payload da outbox/logs. O tracking
token continua sendo a autoridade pública para associar uma assinatura a um
pedido específico.
"""
from __future__ import annotations

import datetime
import hashlib
import json
import os
from dataclasses import dataclass
from urllib.parse import urlsplit

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ..crypt import decrypt_field, encrypt_field
from ..models import Comanda
from ..order_chat_models import OrderConversation, OrderPushSubscription
from .outbox.publisher import enqueue_outbox_event_in_session

PUSH_STATUS_EVENTS = frozenset({"producao", "pronto", "transito", "recusado", "finalizado"})


@dataclass(frozen=True)
class WebPushConfig:
    enabled: bool
    public_key: str
    private_key: str
    subject: str
    ttl_seconds: int

    @property
    def ready(self) -> bool:
        return bool(self.enabled and self.public_key and self.private_key and self.subject)


def get_web_push_config() -> WebPushConfig:
    ttl_raw = os.getenv("WEB_PUSH_TTL_SECONDS", "3600")
    try:
        ttl = max(60, min(int(ttl_raw), 86400))
    except ValueError:
        ttl = 3600
    return WebPushConfig(
        enabled=os.getenv("WEB_PUSH_ENABLED", "false").lower() == "true",
        public_key=os.getenv("WEB_PUSH_VAPID_PUBLIC_KEY", "").strip(),
        private_key=os.getenv("WEB_PUSH_VAPID_PRIVATE_KEY", "").strip().replace("\\n", "\n"),
        subject=os.getenv("WEB_PUSH_VAPID_SUBJECT", "").strip(),
        ttl_seconds=ttl,
    )


def web_push_ready() -> bool:
    return get_web_push_config().ready


def endpoint_hash(endpoint: str) -> str:
    return hashlib.sha256(endpoint.strip().encode("utf-8")).hexdigest()


def _validate_subscription_value(value: str, *, field: str, max_length: int) -> str:
    clean = (value or "").strip()
    if not clean or len(clean) > max_length:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Assinatura de notificações inválida ({field}).",
        )
    return clean


def validate_push_endpoint(raw_endpoint: str) -> str:
    endpoint = _validate_subscription_value(raw_endpoint, field="endpoint", max_length=4096)
    try:
        parsed = urlsplit(endpoint)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Endpoint de notificação inválido.",
        ) from exc
    if parsed.scheme.lower() != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Endpoint de notificação inválido.",
        )
    return endpoint


def upsert_order_push_subscription(
    db: Session,
    *,
    restaurante_id: int,
    conversation_id: str,
    pedido_id: str,
    endpoint: str,
    p256dh: str,
    auth: str,
) -> OrderPushSubscription:
    endpoint = validate_push_endpoint(endpoint)
    p256dh = _validate_subscription_value(p256dh, field="p256dh", max_length=512)
    auth = _validate_subscription_value(auth, field="auth", max_length=256)
    digest = endpoint_hash(endpoint)

    record = (
        db.query(OrderPushSubscription)
        .filter(
            OrderPushSubscription.restaurante_id == restaurante_id,
            OrderPushSubscription.conversation_id == conversation_id,
            OrderPushSubscription.endpoint_hash == digest,
        )
        .first()
    )
    now = datetime.datetime.now(datetime.timezone.utc)
    if record is None:
        record = OrderPushSubscription(
            restaurante_id=restaurante_id,
            conversation_id=conversation_id,
            pedido_id=pedido_id,
            endpoint_hash=digest,
            endpoint_ciphertext=encrypt_field(endpoint),
            p256dh_ciphertext=encrypt_field(p256dh),
            auth_ciphertext=encrypt_field(auth),
            enabled=True,
            created_at=now,
            updated_at=now,
        )
        db.add(record)
    else:
        record.pedido_id = pedido_id
        record.endpoint_ciphertext = encrypt_field(endpoint)
        record.p256dh_ciphertext = encrypt_field(p256dh)
        record.auth_ciphertext = encrypt_field(auth)
        record.enabled = True
        record.updated_at = now
    db.flush()
    return record


def disable_order_push_subscription(
    db: Session,
    *,
    restaurante_id: int,
    conversation_id: str,
    endpoint: str,
) -> bool:
    digest = endpoint_hash(validate_push_endpoint(endpoint))
    record = (
        db.query(OrderPushSubscription)
        .filter(
            OrderPushSubscription.restaurante_id == restaurante_id,
            OrderPushSubscription.conversation_id == conversation_id,
            OrderPushSubscription.endpoint_hash == digest,
        )
        .first()
    )
    if record is None:
        return False
    record.enabled = False
    record.updated_at = datetime.datetime.now(datetime.timezone.utc)
    db.flush()
    return True


def enqueue_order_push_event(
    db: Session,
    *,
    restaurante_id: int,
    pedido_id: str,
    conversation_id: str | None = None,
    kind: str,
    order_status: str | None = None,
) -> bool:
    """Grava intenção de push na outbox da mesma transação do evento original."""
    if not web_push_ready():
        return False
    normalized_kind = (kind or "").strip().lower()
    normalized_status = (order_status or "").strip().lower() or None
    if normalized_kind == "status" and normalized_status not in PUSH_STATUS_EVENTS:
        return False
    if normalized_kind not in {"status", "message"}:
        return False

    if not conversation_id:
        conversation_id = db.query(OrderConversation.id).filter(
            OrderConversation.restaurante_id == restaurante_id,
            OrderConversation.pedido_id == str(pedido_id),
        ).scalar()
    if not conversation_id:
        return False

    payload = {
        "restaurant_id": int(restaurante_id),
        "order_id": str(pedido_id),
        "conversation_id": str(conversation_id),
        "kind": normalized_kind,
        "status": normalized_status,
    }
    enqueue_outbox_event_in_session(
        db,
        payload,
        aggregate_type="order_push",
        aggregate_id=str(pedido_id),
        event_name=f"koma.push.order_{normalized_kind}",
    )
    return True


def _notification_for(snapshot: dict, comanda: Comanda) -> dict:
    payload = snapshot.get("payload") or {}
    kind = str(payload.get("kind") or "status")
    status_value = str(payload.get("status") or "")
    display_number = getattr(comanda, "numero_pedido", None) or "pedido"
    fulfillment = (getattr(comanda, "tipo", "") or "").strip().lower()

    if kind == "message":
        body = "O restaurante enviou uma nova mensagem."
    else:
        bodies = {
            "producao": "O restaurante confirmou seu pedido e já está preparando.",
            "pronto": (
                "Seu pedido está pronto e aguardando saída."
                if fulfillment in {"delivery", "entrega"}
                else "Seu pedido está pronto para retirada."
            ),
            "transito": "Seu pedido saiu para entrega.",
            "recusado": "O restaurante não conseguiu aceitar seu pedido.",
            "finalizado": "Pedido concluído. Bom apetite!",
        }
        body = bodies.get(status_value, "O status do seu pedido foi atualizado.")

    order_hash = hashlib.sha256(str(comanda.id).encode("utf-8")).hexdigest()[:12]
    return {
        "title": f"KÔMA • Pedido #{display_number}",
        "body": body,
        "tag": f"koma-order-{order_hash}-{'message' if kind == 'message' else 'status'}",
        "data": {
            "restaurantId": int(comanda.restaurante_id),
            "pedidoId": str(comanda.id),
            "conversationId": str(payload.get("conversation_id") or ""),
        },
    }


def dispatch_order_push_event(db: Session, snapshot: dict) -> int:
    """Entrega um evento interno de push; 404/410 desativam inscrição expirada."""
    config = get_web_push_config()
    if not config.ready:
        return 0

    payload = snapshot.get("payload") or {}
    restaurante_id = int(payload.get("restaurant_id") or snapshot.get("restaurante_id") or 0)
    pedido_id = str(payload.get("order_id") or snapshot.get("aggregate_id") or "")
    if restaurante_id <= 0 or not pedido_id:
        return 0

    comanda = db.query(Comanda).filter(
        Comanda.restaurante_id == restaurante_id,
        Comanda.id == pedido_id,
    ).first()
    if comanda is None:
        return 0

    subscriptions = db.query(OrderPushSubscription).filter(
        OrderPushSubscription.restaurante_id == restaurante_id,
        OrderPushSubscription.pedido_id == pedido_id,
        OrderPushSubscription.enabled.is_(True),
    ).all()
    if not subscriptions:
        return 0

    notification = _notification_for(snapshot, comanda)
    data = json.dumps(notification, ensure_ascii=False, separators=(",", ":"))

    from pywebpush import WebPushException, webpush

    delivered = 0
    now = datetime.datetime.now(datetime.timezone.utc)
    for subscription in subscriptions:
        subscription_info = {
            "endpoint": decrypt_field(subscription.endpoint_ciphertext),
            "keys": {
                "p256dh": decrypt_field(subscription.p256dh_ciphertext),
                "auth": decrypt_field(subscription.auth_ciphertext),
            },
        }
        try:
            webpush(
                subscription_info=subscription_info,
                data=data,
                vapid_private_key=config.private_key,
                vapid_claims={"sub": config.subject},
                ttl=config.ttl_seconds,
                headers={"Urgency": "high" if payload.get("kind") == "message" or payload.get("status") in {"pronto", "transito"} else "normal"},
            )
            subscription.last_sent_at = now
            subscription.updated_at = now
            delivered += 1
        except WebPushException as exc:
            response = getattr(exc, "response", None)
            status_code = getattr(response, "status_code", None)
            if status_code in {404, 410}:
                subscription.enabled = False
                subscription.updated_at = now
                continue
            raise

    db.flush()
    return delivered

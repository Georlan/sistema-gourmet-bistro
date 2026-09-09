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
import re
from dataclasses import dataclass
from urllib.parse import urlsplit

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ..crypt import decrypt_field, encrypt_field
from ..models import Comanda
from ..order_chat_models import OrderConversation, OrderMessage, OrderPushSubscription
from .outbox.publisher import enqueue_outbox_event_in_session

PUSH_STATUS_EVENTS = frozenset({"producao", "pronto", "transito", "recusado", "finalizado"})
MESSAGE_PREVIEW_MAX_CHARS = 140


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


def sanitize_message_preview(raw_body: str | None) -> str:
    """Cria preview útil para lock screen sem repetir dados evidentemente sensíveis."""
    text = " ".join(str(raw_body or "").split()).strip()
    if not text:
        return ""

    # Capability/credenciais e links nunca devem aparecer na tela bloqueada.
    text = re.sub(r"https?://\S+|www\.\S+", "[link]", text, flags=re.IGNORECASE)
    text = re.sub(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b", "[e-mail]", text)
    text = re.sub(r"\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b", "[dado protegido]", text)

    # Telefones, documentos/cartões e chaves/identificadores longos.
    text = re.sub(r"(?<!\w)(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}(?!\w)", "[telefone]", text)
    text = re.sub(r"(?<!\d)(?:\d[ .-]?){11,19}(?!\d)", "[dado protegido]", text)
    text = re.sub(r"\b(?:pix|chave\s+pix)\s*[:=-]?\s*\S+", "Pix [dado protegido]", text, flags=re.IGNORECASE)

    # Endereços explícitos comuns: preserva o contexto da frase sem expor o local.
    text = re.sub(
        r"\b(?:rua|r\.|avenida|av\.|travessa|alameda|rodovia|estrada)\s+[^,.;]{3,80}",
        "[endereço]",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\s{2,}", " ", text).strip()

    if len(text) > MESSAGE_PREVIEW_MAX_CHARS:
        text = text[: MESSAGE_PREVIEW_MAX_CHARS - 1].rstrip() + "…"
    return text


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
    message_id: str | None = None,
) -> bool:
    """Grava intenção de push na outbox da mesma transação do evento original.

    Mensagens entram na outbox somente por ID. O texto é lido da tabela de chat
    já existente apenas no momento da entrega, evitando duplicar conteúdo privado.
    """
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
    if normalized_kind == "message" and message_id:
        payload["message_id"] = str(message_id)

    enqueue_outbox_event_in_session(
        db,
        payload,
        aggregate_type="order_push",
        aggregate_id=str(pedido_id),
        event_name=f"koma.push.order_{normalized_kind}",
    )
    return True


def _notification_for(snapshot: dict, comanda: Comanda, *, message_body: str | None = None) -> dict:
    payload = snapshot.get("payload") or {}
    kind = str(payload.get("kind") or "status")
    status_value = str(payload.get("status") or "")
    display_number = getattr(comanda, "numero_pedido", None) or "pedido"
    fulfillment = (getattr(comanda, "tipo", "") or "").strip().lower()

    if kind == "message":
        preview = sanitize_message_preview(message_body)
        title = f"Nova mensagem • Pedido #{display_number}"
        body = preview or "O restaurante enviou uma nova mensagem."
        action_title = "Abrir conversa"
        vibration = [120, 60, 120]
    else:
        status_titles = {
            "producao": "Em preparo 👨‍🍳",
            "pronto": "Pronto ✅",
            "transito": "Saiu para entrega 🛵",
            "recusado": "Pedido não aceito",
            "finalizado": "Concluído",
        }
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
        title = f"Pedido #{display_number} • {status_titles.get(status_value, 'Atualização')}"
        body = bodies.get(status_value, "O status do seu pedido foi atualizado.")
        action_title = "Acompanhar pedido"
        vibration = [180, 80, 180] if status_value in {"pronto", "transito"} else [90]

    order_hash = hashlib.sha256(str(comanda.id).encode("utf-8")).hexdigest()[:12]
    return {
        "title": title,
        "body": body,
        # Status e chat nunca se sobrescrevem. O status usa uma tag estável para
        # evoluir como uma única notificação ao longo do fluxo do pedido.
        "tag": f"koma-order-{order_hash}-{'message' if kind == 'message' else 'status'}",
        "renotify": True,
        "vibrate": vibration,
        "actions": [{"action": "open", "title": action_title}],
        "data": {
            "restaurantId": int(comanda.restaurante_id),
            "pedidoId": str(comanda.id),
            "conversationId": str(payload.get("conversation_id") or ""),
            "kind": kind,
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

    message_body = None
    if str(payload.get("kind") or "") == "message" and payload.get("message_id"):
        message = db.query(OrderMessage).filter(
            OrderMessage.id == str(payload["message_id"]),
            OrderMessage.restaurante_id == restaurante_id,
            OrderMessage.pedido_id == pedido_id,
            OrderMessage.conversation_id == str(payload.get("conversation_id") or ""),
            OrderMessage.sender_type == "staff",
        ).first()
        if message is not None:
            message_body = message.body

    notification = _notification_for(snapshot, comanda, message_body=message_body)
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

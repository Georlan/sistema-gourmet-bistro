"""Optional staff alerts. No provider call occurs in the order transaction."""
import datetime as dt
import json
import os
import uuid
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..crypt import decrypt_field, encrypt_field
from ..domain.orders.types import OrderChannel
from ..models import Usuario, Comanda
from ..order_chat_models import StaffPushSubscription
from ..security import ensure_permission
from .outbox.publisher import enqueue_outbox_event_in_session
from .web_push import get_web_push_config, endpoint_hash, validate_push_endpoint, _validate_subscription_value

EVENT = "koma.staff_push.order_created"
NAMESPACE = uuid.UUID("69fb33c7-5559-479d-b1cd-6ec3e67c8693")


def enabled_for(restaurant_id: int) -> bool:
    # Explicit rollout: an empty list never changes a running restaurant.
    ids = {v.strip() for v in os.getenv("STAFF_PUSH_RESTAURANT_IDS", "").split(",") if v.strip()}
    return str(restaurant_id) in ids and get_web_push_config().ready


def save_subscription(db: Session, user: Usuario, endpoint: str, p256dh: str, auth: str):
    endpoint = validate_push_endpoint(endpoint)
    p256dh = _validate_subscription_value(p256dh, field="p256dh", max_length=512)
    auth = _validate_subscription_value(auth, field="auth", max_length=256)
    values = {
        "id": str(uuid.uuid4()), "restaurante_id": user.restaurante_id,
        "usuario_id": user.id, "endpoint_hash": endpoint_hash(endpoint),
        "endpoint_ciphertext": encrypt_field(endpoint),
        "p256dh_ciphertext": encrypt_field(p256dh), "auth_ciphertext": encrypt_field(auth),
        "enabled": True, "updated_at": dt.datetime.now(dt.timezone.utc),
    }
    # Concurrent opt-ins on the same device share one row. Explicit activation
    # assigns a shared device to its current operator without duplicate inserts.
    if db.get_bind().dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    statement = insert(StaffPushSubscription).values(**values)
    db.execute(statement.on_conflict_do_update(
        index_elements=["restaurante_id", "endpoint_hash"],
        set_={key: value for key, value in values.items() if key not in {"id", "restaurante_id", "endpoint_hash"}},
    ))
    return db.query(StaffPushSubscription).filter_by(
        restaurante_id=user.restaurante_id, endpoint_hash=values["endpoint_hash"],
    ).populate_existing().one()



@dataclass(frozen=True)
class StaffOrderAlert:
    restaurant_id: int
    order_id: str
    display_number: str
    event_id: str


def enqueue_staff_order_alert(db: Session, order) -> bool:
    if order.channel != OrderChannel.WEB_CARDAPIO or not enabled_for(order.restaurant_id):
        return False
    if getattr(order, "check_id", None):
        check = db.query(Comanda).filter_by(id=str(order.check_id), restaurante_id=order.restaurant_id).first()
        if check is None or check.online_payment_status not in {None, "approved"}:
            return False
    event = StaffOrderAlert(order.restaurant_id, str(order.order_id), str(order.display_number),
        str(uuid.uuid5(NAMESPACE, f"{order.restaurant_id}:{order.order_id}")))
    enqueue_outbox_event_in_session(db, event, aggregate_type="staff_push", aggregate_id=event.order_id, event_name=EVENT)
    return True


def notification_for(payload: dict) -> dict:
    return {"title": "Novo pedido no KÔMA", "body": f"Pedido #{payload.get('display_number', '')}. Abra os pedidos para conferir.",
        "tag": f"koma-staff-{payload['restaurant_id']}-{payload['order_id']}",
        "data": {"kind": "staff-order", "restaurantId": payload["restaurant_id"]},
        "renotify": False, "actions": [{"action": "open", "title": "Abrir pedidos"}], "vibrate": [200, 100, 200]}


def dispatch_staff_push(db: Session, snapshot: dict) -> int:
    payload = snapshot["payload"]
    rid = int(snapshot["restaurante_id"])
    if int(payload["restaurant_id"]) != rid:
        raise ValueError("Staff push tenant mismatch")
    if not enabled_for(rid):
        return 0
    config = get_web_push_config()
    rows = db.query(StaffPushSubscription).filter_by(restaurante_id=rid, enabled=True).all()
    targets = []
    for row in rows:
        user = db.query(Usuario).filter_by(id=row.usuario_id, restaurante_id=rid, removed_at=None).first()
        try:
            ensure_permission(user, "caixa:operar")
        except HTTPException:
            row.enabled = False
            continue
        info = {"endpoint": decrypt_field(row.endpoint_ciphertext), "keys": {
            "p256dh": decrypt_field(row.p256dh_ciphertext), "auth": decrypt_field(row.auth_ciphertext)}}
        targets.append((row.id, info))
    db.commit()
    # End the database transaction before waiting on external push services.
    data = json.dumps(notification_for(payload), ensure_ascii=False)
    from pywebpush import WebPushException, webpush
    results = []
    failure = None
    for row_id, info in targets:
        try:
            webpush(subscription_info=info, data=data, vapid_private_key=config.private_key,
                vapid_claims={"sub": config.subject}, ttl=min(config.ttl_seconds, 600), timeout=5, headers={"Urgency": "high"})
            results.append((row_id, True))
        except WebPushException as exc:
            if getattr(getattr(exc, "response", None), "status_code", None) in {404, 410}:
                results.append((row_id, False))
            else:
                failure = True
    now = dt.datetime.now(dt.timezone.utc)
    for row_id, delivered in results:
        row = db.query(StaffPushSubscription).filter_by(id=row_id, restaurante_id=rid).first()
        if row:
            if not delivered:
                row.enabled = False
            row.updated_at = now
            if delivered:
                row.last_sent_at = now
    db.commit()
    if failure:
        raise RuntimeError("Serviço de notificações indisponível; nova tentativa pendente.") from None
    return sum(delivered for _, delivered in results)

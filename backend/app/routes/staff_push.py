"""Authenticated, opt-in alerts for the operator's current device."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Usuario
from ..order_chat_models import StaffPushSubscription
from ..security import require_permission
from ..services import staff_push
from ..services.web_push import endpoint_hash, get_web_push_config, validate_push_endpoint

router = APIRouter(prefix="/caixa/notificacoes", tags=["Notificações da equipe"])


class Keys(BaseModel):
    p256dh: str = Field(min_length=1, max_length=512)
    auth: str = Field(min_length=1, max_length=256)


class Subscription(BaseModel):
    endpoint: str = Field(min_length=1, max_length=4096)
    keys: Keys


class Endpoint(BaseModel):
    endpoint: str = Field(min_length=1, max_length=4096)


@router.get("/config")
def config(user: Usuario = Depends(require_permission("caixa:operar"))):
    enabled = staff_push.enabled_for(user.restaurante_id)
    return {"enabled": enabled, "publicKey": get_web_push_config().public_key if enabled else ""}


@router.put("/subscription")
def subscribe(body: Subscription, db: Session = Depends(get_db), user: Usuario = Depends(require_permission("caixa:operar"))):
    if not staff_push.enabled_for(user.restaurante_id):
        raise HTTPException(409, "Avisos fora do KÔMA ainda não foram habilitados para esta loja.")
    staff_push.save_subscription(db, user, body.endpoint, body.keys.p256dh, body.keys.auth)
    db.commit()
    return {"enabled": True}


@router.post("/status")
def subscription_status(body: Endpoint, db: Session = Depends(get_db), user: Usuario = Depends(require_permission("caixa:operar"))):
    if not staff_push.enabled_for(user.restaurante_id):
        return {"enabled": False}
    row = db.query(StaffPushSubscription).filter_by(restaurante_id=user.restaurante_id, usuario_id=user.id,
        endpoint_hash=endpoint_hash(validate_push_endpoint(body.endpoint)), enabled=True).first()
    return {"enabled": row is not None}


@router.delete("/subscription")
def unsubscribe(body: Endpoint, db: Session = Depends(get_db), user: Usuario = Depends(require_permission("caixa:operar"))):
    # Allow revocation even if rollout was turned off.
    db.query(StaffPushSubscription).filter_by(restaurante_id=user.restaurante_id, usuario_id=user.id,
        endpoint_hash=endpoint_hash(validate_push_endpoint(body.endpoint))).update({"enabled": False})
    db.commit()
    return {"enabled": False}

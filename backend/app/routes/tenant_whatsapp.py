"""Tenant-owned operational WhatsApp connection. No global instance access."""

from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ConfiguracaoRestaurante, Usuario
from ..security import require_permission
from ..services import tenant_order_whatsapp as wa

router = APIRouter(prefix="/caixa/configuracoes/whatsapp", tags=["WhatsApp operacional"])


class ConfigureRequest(BaseModel):
    phone: str


def _config(db: Session, user: Usuario) -> ConfiguracaoRestaurante:
    config = db.query(ConfiguracaoRestaurante).filter(
        ConfiguracaoRestaurante.restaurante_id == user.restaurante_id,
    ).first()
    if config is None:
        config = ConfiguracaoRestaurante(restaurante_id=user.restaurante_id)
        db.add(config)
        db.flush()
    return config


def _provider_error(exc: Exception) -> HTTPException:
    if isinstance(exc, httpx.TimeoutException):
        detail = "Evolution demorou a responder. Tente verificar a conexão novamente."
    else:
        detail = "Integração WhatsApp indisponível. Tente novamente mais tarde."
    return HTTPException(status_code=502, detail=detail)


def _safe_qr(data: dict) -> str | None:
    qr = data.get("qrcode")
    if isinstance(qr, dict):
        code = qr.get("code")
        return code[:4096] if isinstance(code, str) else None
    code = data.get("code")
    return code[:4096] if isinstance(code, str) else None


@router.get("")
def get_status(
    db: Session = Depends(get_db),
    user: Usuario = Depends(require_permission("configuracoes:administrar")),
):
    config = _config(db, user)
    if not config.whatsapp_instance_name:
        return {"state": "not_configured", "enabled": False, "phone_ending": None}
    state = "error"
    try:
        provider_state = wa.connection_state(user.restaurante_id)
        if provider_state == "open":
            state = "connected" if wa.owner_phone(user.restaurante_id) == config.whatsapp_recipient_phone else "error"
        elif provider_state in {"connecting", "close"}:
            state = "connecting" if provider_state == "connecting" else "disconnected"
        else:
            state = "waiting_qr"
    except Exception:
        state = "error"
    phone = config.whatsapp_recipient_phone or ""
    return {"state": state, "enabled": bool(config.whatsapp_alerts_enabled), "phone_ending": phone[-4:] or None}


@router.post("/configure")
def configure(
    body: ConfigureRequest,
    db: Session = Depends(get_db),
    user: Usuario = Depends(require_permission("configuracoes:administrar")),
):
    try:
        phone = wa.normalize_phone(body.phone)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    config = _config(db, user)
    if config.whatsapp_instance_name and config.whatsapp_recipient_phone != phone:
        raise HTTPException(status_code=409, detail="Desconecte o número atual antes de configurar outro.")
    try:
        data = wa.create_instance(user.restaurante_id) if not config.whatsapp_instance_name else wa.connect_instance(user.restaurante_id)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in {400, 403, 409}:
            try:
                data = wa.connect_instance(user.restaurante_id)
            except Exception as connect_exc:
                raise _provider_error(connect_exc) from connect_exc
        else:
            raise _provider_error(exc) from exc
    except Exception as exc:
        raise _provider_error(exc) from exc
    config.whatsapp_instance_name = wa.instance_name(user.restaurante_id)
    config.whatsapp_recipient_phone = phone
    config.whatsapp_alerts_enabled = False
    db.commit()
    return {"state": "waiting_qr", "enabled": False, "qr_code": _safe_qr(data)}


@router.post("/qr")
def refresh_qr(
    db: Session = Depends(get_db),
    user: Usuario = Depends(require_permission("configuracoes:administrar")),
):
    config = _config(db, user)
    if config.whatsapp_instance_name != wa.instance_name(user.restaurante_id):
        raise HTTPException(status_code=409, detail="Configure primeiro o WhatsApp deste restaurante.")
    try:
        data = wa.connect_instance(user.restaurante_id)
    except Exception as exc:
        raise _provider_error(exc) from exc
    return {"state": "waiting_qr", "qr_code": _safe_qr(data)}


@router.post("/enable")
def enable(
    db: Session = Depends(get_db),
    user: Usuario = Depends(require_permission("configuracoes:administrar")),
):
    config = _config(db, user)
    try:
        valid = (
            config.whatsapp_instance_name == wa.instance_name(user.restaurante_id)
            and wa.connection_state(user.restaurante_id) == "open"
            and wa.owner_phone(user.restaurante_id) == config.whatsapp_recipient_phone
        )
    except Exception as exc:
        raise _provider_error(exc) from exc
    if not valid:
        raise HTTPException(status_code=409, detail="Conecte o WhatsApp do número informado antes de ativar os avisos.")
    config.whatsapp_alerts_enabled = True
    db.commit()
    return {"enabled": True}


@router.post("/disable")
def disable(
    db: Session = Depends(get_db),
    user: Usuario = Depends(require_permission("configuracoes:administrar")),
):
    config = _config(db, user)
    config.whatsapp_alerts_enabled = False
    db.commit()
    return {"enabled": False}


@router.post("/disconnect")
def disconnect(
    db: Session = Depends(get_db),
    user: Usuario = Depends(require_permission("configuracoes:administrar")),
):
    config = _config(db, user)
    config.whatsapp_alerts_enabled = False
    db.commit()
    if config.whatsapp_instance_name == wa.instance_name(user.restaurante_id):
        try:
            wa.logout_instance(user.restaurante_id)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code != 404:
                raise _provider_error(exc) from exc
        except Exception as exc:
            raise _provider_error(exc) from exc
    config.whatsapp_instance_name = None
    config.whatsapp_recipient_phone = None
    db.commit()
    return {"enabled": False, "state": "not_configured"}

"""Tenant-owned operational WhatsApp connection. No global instance access."""

from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, StrictBool
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ConfiguracaoRestaurante, Usuario, IntegrationOutbox
from ..security import require_permission
from ..services import tenant_order_whatsapp as wa
from ..services.central_whatsapp import CENTRAL_INSTANCE_MARKER, enabled_for, transport_configuration, registered_operator_phone
from ..services.customer_whatsapp_dispatch import customer_notice_transport_config, customer_notices_enabled

router = APIRouter(prefix="/caixa/configuracoes/whatsapp", tags=["WhatsApp operacional"])


class ConfigureRequest(BaseModel):
    phone: str
    mode: str = "qr"


class RecipientRegistrationRequest(BaseModel):
    phone: str
    confirm_receiving: bool = False


class CustomerNoticesRequest(BaseModel):
    enabled: StrictBool


def _config(db: Session, user: Usuario) -> ConfiguracaoRestaurante:
    config = db.query(ConfiguracaoRestaurante).filter(
        ConfiguracaoRestaurante.restaurante_id == user.restaurante_id,
    ).first()
    if config is None:
        config = ConfiguracaoRestaurante(restaurante_id=user.restaurante_id)
        db.add(config)
        db.flush()
    return config


def _release_before_provider(db: Session, config: ConfiguracaoRestaurante) -> None:
    # Snapshot the loaded scalar configuration, release the read transaction,
    # and reattach only after the provider has finished if writes are needed.
    db.expunge(config)
    db.rollback()


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
    customer_fields = {
        "customer_notices_available": customer_notice_transport_config(user.restaurante_id, config) is not None,
        "customer_notices_enabled": customer_notices_enabled(user.restaurante_id, config),
        "customer_notices_requested": config.whatsapp_customer_notices_enabled is True,
    }
    if not config.whatsapp_instance_name:
        return {"state": "not_configured", "enabled": False, "phone_ending": None,
                "mode": "central", **customer_fields}
    if config.whatsapp_instance_name == CENTRAL_INSTANCE_MARKER:
        phone = config.whatsapp_recipient_phone or ""
        return {
            "state": "registered" if phone else "not_configured",
            "enabled": bool(enabled_for(user.restaurante_id, config) and (transport := transport_configuration()) and registered_operator_phone(config, transport.sender)),
            "phone_ending": phone[-4:] or None,
            "mode": "central", **customer_fields,
        }
    _release_before_provider(db, config)
    state = "error"
    try:
        provider_state = wa.connection_state(user.restaurante_id)
        if provider_state == "open":
            state = "connected" if wa.phones_match(
                wa.owner_phone(user.restaurante_id),
                config.whatsapp_recipient_phone,
            ) else "error"
        elif provider_state in {"connecting", "close"}:
            state = "connecting" if provider_state == "connecting" else "disconnected"
        else:
            state = "waiting_qr"
    except Exception:
        state = "error"
    phone = config.whatsapp_recipient_phone or ""
    return {"state": state, "enabled": bool(config.whatsapp_alerts_enabled), "phone_ending": phone[-4:] or None, "mode": "individual", **customer_fields}


def _cancel_pending_central_notices(db: Session, restaurant_id: int) -> None:
    changed = db.query(IntegrationOutbox).filter(
        IntegrationOutbox.restaurante_id == restaurant_id,
        IntegrationOutbox.event_name == "koma.whatsapp.central_operator_order",
        IntegrationOutbox.status.in_(["pending", "failed", "processing"]),
    ).update({"status": "dead_letter", "locked_by": None, "locked_at": None,
        "last_error": "Cadastro de recebimento alterado; aguardando novos pedidos."}, synchronize_session=False)
    if changed:
        from ..services.whatsapp_usage import increment
        increment(db, restaurant_id, discarded=changed)


def _cancel_pending_customer_notices(db: Session, restaurant_id: int) -> None:
    # Claimed attempts must also be invalidated before the sender's ownership
    # check. Account for the bulk discard even though settle_outbox_event is
    # deliberately bypassed; preserve history, operator notices and opt-outs.
    changed = db.query(IntegrationOutbox).filter(
        IntegrationOutbox.restaurante_id == restaurant_id,
        IntegrationOutbox.event_name == "koma.whatsapp.customer_status",
        IntegrationOutbox.status.in_(["pending", "failed", "processing"]),
    ).update({"status": "dead_letter", "locked_by": None, "locked_at": None,
              "last_error": "Restaurante desativou avisos ao cliente; sem envio."}, synchronize_session=False)
    if changed:
        from ..services.whatsapp_usage import increment
        increment(db, restaurant_id, discarded=changed)


@router.post("/customer-notices")
def set_customer_notices(
    body: CustomerNoticesRequest,
    db: Session = Depends(get_db),
    user: Usuario = Depends(require_permission("configuracoes:administrar")),
):
    # Platform/transport permission and tenant owner's permission are separate.
    # Disabling must always work, even if the shared Business is offline.
    config = _config(db, user)
    config = wa._locked_whatsapp_config_query(db, user.restaurante_id).populate_existing().one()
    if body.enabled and customer_notice_transport_config(user.restaurante_id, config) is None:
        raise HTTPException(status_code=409, detail="Avisos ao cliente indisponíveis para este restaurante.")
    config.whatsapp_customer_notices_enabled = body.enabled
    if not body.enabled:
        _cancel_pending_customer_notices(db, user.restaurante_id)
    db.commit()
    return {
        "customer_notices_enabled": customer_notices_enabled(user.restaurante_id, config),
        "customer_notices_requested": config.whatsapp_customer_notices_enabled is True,
    }


@router.post("/recipient")
def register_central_recipient(
    body: RecipientRegistrationRequest,
    db: Session = Depends(get_db),
    user: Usuario = Depends(require_permission("configuracoes:administrar")),
):
    """Record an explicitly authorized destination; NO Evolution session or send.

    Registering is independent of the operator's own WhatsApp account and
    never enables delivery implicitly. Existing individual connections must
    be disconnected explicitly, so no live session is silently replaced.
    """
    if not body.confirm_receiving:
        raise HTTPException(
            status_code=422,
            detail="Confirme que o responsável pelo telefone autorizou receber comandas.",
        )
    try:
        phone = wa.normalize_phone(body.phone)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    config = _config(db, user)
    config = wa._locked_whatsapp_config_query(db, user.restaurante_id).populate_existing().one()
    if config.whatsapp_instance_name not in (None, CENTRAL_INSTANCE_MARKER):
        raise HTTPException(
            status_code=409,
            detail="Desconecte a integração individual antes de cadastrar o destinatário central.",
        )
    _cancel_pending_central_notices(db, user.restaurante_id)
    config.whatsapp_instance_name = CENTRAL_INSTANCE_MARKER
    config.whatsapp_recipient_phone = phone
    config.whatsapp_alerts_enabled = False
    db.commit()
    return {
        "state": "registered",
        "mode": "central",
        "enabled": False,
        "phone_ending": phone[-4:],
    }


@router.post("/recipient/remove")
def remove_central_recipient(
    db: Session = Depends(get_db),
    user: Usuario = Depends(require_permission("configuracoes:administrar")),
):
    config = _config(db, user)
    config = wa._locked_whatsapp_config_query(db, user.restaurante_id).populate_existing().one()
    if config.whatsapp_instance_name != CENTRAL_INSTANCE_MARKER:
        raise HTTPException(status_code=409, detail="Nenhum destinatário central cadastrado.")
    config.whatsapp_alerts_enabled = False
    _cancel_pending_central_notices(db, user.restaurante_id)
    config.whatsapp_instance_name = None
    config.whatsapp_recipient_phone = None
    db.commit()
    return {"state": "not_configured", "mode": "central", "enabled": False}


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
    mode = (body.mode or "qr").strip().lower()
    if mode not in {"qr", "pairing_code"}:
        raise HTTPException(status_code=422, detail="Modo de conexão inválido.")

    config = _config(db, user)
    if config.whatsapp_instance_name == CENTRAL_INSTANCE_MARKER:
        raise HTTPException(status_code=409, detail="Remova o cadastro central antes de usar a conexão individual.")
    if config.whatsapp_instance_name and config.whatsapp_recipient_phone != phone:
        raise HTTPException(status_code=409, detail="Desconecte o número atual antes de configurar outro.")

    _release_before_provider(db, config)
    pairing_code = None
    try:
        if mode == "pairing_code":
            if config.whatsapp_instance_name:
                data, pairing_code = wa.recreate_instance_with_pairing_code(
                    user.restaurante_id,
                    phone,
                )
            else:
                try:
                    data, pairing_code = wa.create_instance_with_pairing_code(
                        user.restaurante_id,
                        phone,
                    )
                except httpx.HTTPStatusError as exc:
                    # Evolution keeps a logged-out instance name until it is
                    # explicitly deleted. Recover that stale provider state
                    # instead of surfacing a 502 to a freshly configured tenant.
                    if exc.response.status_code not in {403, 409}:
                        raise
                    data, pairing_code = wa.recreate_instance_with_pairing_code(
                        user.restaurante_id,
                        phone,
                    )
        else:
            data = (
                wa.create_instance(user.restaurante_id)
                if not config.whatsapp_instance_name
                else wa.connect_instance(user.restaurante_id)
            )
    except httpx.HTTPStatusError as exc:
        if mode == "qr" and exc.response.status_code in {400, 403, 409}:
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
    db.add(config)
    db.commit()
    return {
        "state": "connecting" if pairing_code else "waiting_qr",
        "enabled": False,
        "qr_code": _safe_qr(data) if not pairing_code else None,
        "pairing_code": pairing_code,
    }


@router.post("/qr")
def refresh_qr(
    db: Session = Depends(get_db),
    user: Usuario = Depends(require_permission("configuracoes:administrar")),
):
    config = _config(db, user)
    if config.whatsapp_instance_name != wa.instance_name(user.restaurante_id):
        raise HTTPException(status_code=409, detail="Configure primeiro o WhatsApp deste restaurante.")
    _release_before_provider(db, config)
    try:
        data = wa.connect_instance(user.restaurante_id)
    except Exception as exc:
        raise _provider_error(exc) from exc
    return {"state": "waiting_qr", "qr_code": _safe_qr(data)}


@router.post("/pairing-code")
def refresh_pairing_code(
    db: Session = Depends(get_db),
    user: Usuario = Depends(require_permission("configuracoes:administrar")),
):
    config = _config(db, user)
    if (
        config.whatsapp_instance_name != wa.instance_name(user.restaurante_id)
        or not config.whatsapp_recipient_phone
    ):
        raise HTTPException(status_code=409, detail="Configure primeiro o WhatsApp deste restaurante.")
    _release_before_provider(db, config)
    try:
        _, code = wa.recreate_instance_with_pairing_code(
            user.restaurante_id,
            config.whatsapp_recipient_phone,
        )
    except Exception as exc:
        raise _provider_error(exc) from exc
    return {"state": "connecting", "pairing_code": code}


@router.post("/enable")
def enable(
    db: Session = Depends(get_db),
    user: Usuario = Depends(require_permission("configuracoes:administrar")),
):
    config = _config(db, user)
    if config.whatsapp_instance_name == CENTRAL_INSTANCE_MARKER:
        raise HTTPException(status_code=409, detail="O canal central compartilhado ainda está em homologação.")
    _release_before_provider(db, config)
    try:
        valid = (
            config.whatsapp_instance_name == wa.instance_name(user.restaurante_id)
            and wa.connection_state(user.restaurante_id) == "open"
            and wa.phones_match(
                wa.owner_phone(user.restaurante_id),
                config.whatsapp_recipient_phone,
            )
        )
    except Exception as exc:
        raise _provider_error(exc) from exc
    if not valid:
        raise HTTPException(status_code=409, detail="Conecte o WhatsApp do número informado antes de ativar os avisos.")
    config.whatsapp_alerts_enabled = True
    db.add(config)
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
    owns_instance = config.whatsapp_instance_name == wa.instance_name(user.restaurante_id)
    config.whatsapp_alerts_enabled = False
    db.commit()
    if owns_instance:
        try:
            wa.logout_instance(user.restaurante_id)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code not in {400, 404}:
                raise _provider_error(exc) from exc
        except Exception as exc:
            raise _provider_error(exc) from exc
        try:
            wa.delete_instance(user.restaurante_id)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code != 404:
                raise _provider_error(exc) from exc
        except Exception as exc:
            raise _provider_error(exc) from exc
    config.whatsapp_instance_name = None
    config.whatsapp_recipient_phone = None
    db.commit()
    return {"enabled": False, "state": "not_configured"}

"""Privileged WhatsApp platform rollout and low-cost, RLS-scoped diagnostics.

No message content, phone, recipient hash, provider token or order identifier is exposed.
Actual handset delivery is not observable by the Evolution HTTP acceptance counter.
"""
from __future__ import annotations

import datetime as dt
import os
import time
import threading

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from decimal import Decimal
from sqlalchemy import func

from ..database import SessionLocal, tenant_session_scope
from ..models import (
    CentralWhatsAppSenderState, ConfiguracaoRestaurante,
    IntegrationOutbox, Restaurante, SuperAdminAuditLog, WhatsAppUsageMetric,
)
from ..services.central_whatsapp import (
    _provider_sender_status, allowed_restaurants, transport_configuration,
    platform_operator_enabled, registered_operator_phone,
)
from ..services.customer_whatsapp_dispatch import (
    customer_notice_transport_config, customer_notices_enabled,
)
from ..services.whatsapp_sender_gate import _key, minimum_interval_seconds
from .super_admin import _discover_restaurant_ids, get_current_admin

router = APIRouter(prefix="/super-admin/whatsapp", tags=["SuperAdmin - WhatsApp"])
_EVENTS = ("koma.whatsapp.central_operator_order", "koma.whatsapp.customer_status", "koma.whatsapp.campaign")
_PENDING = ("pending", "failed", "processing")


class PlatformPermissionUpdate(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)
    operator_allowed: bool | None = None
    customer_allowed: bool | None = None

    @model_validator(mode="after")
    def one_permission_required(self):
        if self.operator_allowed is None and self.customer_allowed is None:
            raise ValueError("Informe pelo menos um canal para alterar.")
        if len(self.reason.strip()) < 3:
            raise ValueError("Informe um motivo válido com pelo menos três caracteres.")
        return self


def _legacy_customer(rid: int) -> bool:
    # Preserve requested rollout even if the global transport kill switch is off.
    return (
        rid in allowed_restaurants("KOMA_CENTRAL_WA_ALLOWED_RESTAURANT_IDS")
        and rid in allowed_restaurants("KOMA_CUSTOMER_WA_ALLOWED_RESTAURANT_IDS")
    )


def _permissions(rid: int, cfg: ConfiguracaoRestaurante) -> dict:
    transport = transport_configuration()
    requested_customer = cfg.whatsapp_customer_notices_enabled is True
    return {
        "managed": cfg.whatsapp_platform_managed is True,
        "operator_allowed": (
            cfg.whatsapp_platform_operator_allowed is True if cfg.whatsapp_platform_managed is True
            else rid in allowed_restaurants("KOMA_CENTRAL_WA_ALLOWED_RESTAURANT_IDS")
        ),
        "customer_allowed": (
            cfg.whatsapp_platform_customer_allowed is True if cfg.whatsapp_platform_managed is True
            else _legacy_customer(rid)
        ),
        "operator_registered": bool(
            transport and registered_operator_phone(cfg, transport.sender)
        ),
        "customer_requested": requested_customer,
        "customer_effective": customer_notices_enabled(rid, cfg),
        "operator_effective": bool(
            transport and platform_operator_enabled(rid, cfg)
            and registered_operator_phone(cfg, transport.sender)
        ),
    }


def _as_utc(value: dt.datetime | None) -> dt.datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=dt.timezone.utc) if value.tzinfo is None else value.astimezone(dt.timezone.utc)


def _iso(value: dt.datetime | None) -> str | None:
    converted = _as_utc(value)
    return converted.isoformat() if converted else None


def _queue_summary(db, rid: int, now: dt.datetime) -> dict:
    kind = IntegrationOutbox.payload["kind"].as_string()
    rows = (
        db.query(
            IntegrationOutbox.event_name,
            IntegrationOutbox.status,
            kind,
            func.count(IntegrationOutbox.id),
            func.min(IntegrationOutbox.created_at),
        )
        .filter(
            IntegrationOutbox.restaurante_id == rid,
            IntegrationOutbox.event_name.in_(_EVENTS),
            IntegrationOutbox.status.in_(_PENDING),
        )
        .group_by(IntegrationOutbox.event_name, IntegrationOutbox.status, kind)
        .all()
    )
    by_kind: dict[str, int] = {}
    pending = 0
    oldest_seconds = 0
    near_expiry = 0
    for event_name, status, notice_kind, count, oldest in rows:
        label = "campanha" if event_name == "koma.whatsapp.campaign" else "operador" if event_name == _EVENTS[0] else str(notice_kind or "cliente")
        by_kind[label] = by_kind.get(label, 0) + int(count)
        pending += int(count)
        age = max(0, int((now - (_as_utc(oldest) or now)).total_seconds()))
        oldest_seconds = max(oldest_seconds, age)
        ttl = 172800 if label == "campanha" else 600 if label in ("operador", "customer_received") else 1800
        if age >= int(ttl * 0.8):
            # Lower bound: grouping retains the oldest timestamp, not each age.
            near_expiry += 1
    recent_429 = (
        db.query(func.count(IntegrationOutbox.id))
        .filter(
            IntegrationOutbox.restaurante_id == rid,
            IntegrationOutbox.event_name.in_(_EVENTS),
            IntegrationOutbox.response_status_code == 429,
            IntegrationOutbox.created_at >= now - dt.timedelta(days=1),
        ).scalar() or 0
    )
    return {
        "total": pending,
        "by_kind": by_kind,
        "oldest_seconds": oldest_seconds if pending else None,
        "groups_near_expiry": near_expiry,
        "ttl_risk": near_expiry > 0,
        "http429_last_24h_in_outbox": int(recent_429),
    }


def _usage(db, rid: int, month: str) -> dict:
    row = db.query(WhatsAppUsageMetric).filter_by(restaurante_id=rid, month_utc=month).one_or_none()
    if row is None:
        return dict(attempts=0, accepted=0, failed=0, discarded=0, deferred=0,
                    average_queue_ms=None, estimated_customer_cost_brl=None)
    from ..services.whatsapp_usage import estimated_customer_unit_cost
    measured_cost = Decimal(str(row.estimated_customer_cost_brl))
    cost = str(measured_cost) if measured_cost != 0 or estimated_customer_unit_cost() is not None else None
    samples = int(row.queue_latency_samples)
    return {
        "attempts": int(row.attempts),
        "accepted": int(row.accepted),  # HTTP 2xx, not WhatsApp delivery.
        "failed": int(row.failed),
        "discarded": int(row.discarded),
        "deferred": int(row.deferred),
        "average_queue_ms": round(int(row.queue_latency_total_ms) / samples) if samples else None,
        "estimated_customer_cost_brl": cost,
    }


def _sender_snapshot(db, cfg) -> dict:
    if cfg is None:
        return {"state": "disabled", "connection": "not_verified"}
    state = db.query(CentralWhatsAppSenderState).filter_by(sender_key=_key(cfg)).one_or_none()
    return {
        "state": "suspended" if state and state.suspended_at else "configured", "connection": "not_verified",
        "suspended_at": _iso(state.suspended_at) if state else None,
        "accept_events_after": _iso(state.accept_events_after) if state else None,
        "interval_seconds": minimum_interval_seconds(),
        "failures": int(state.failures) if state else 0,
        "next_send_at": _iso(state.next_send_at) if state else None,
        "circuit_open_until": _iso(state.circuit_open_until) if state else None,
    }


_verification_cache = None
_verification_lock = threading.Lock()


def _verify_connection(cfg) -> str:
    global _verification_cache
    key = (cfg, os.getenv("EVOLUTION_API_URL", ""), os.getenv("EVOLUTION_API_KEY", ""))
    with _verification_lock:
        cached = _verification_cache
        if cached and cached[0] == key and time.monotonic() - cached[1] < 30:
            return cached[2]
        result = _probe_connection(cfg)
        _verification_cache = (key, time.monotonic(), result)
        return result


def _probe_connection(cfg) -> str:
    """Explicit-only probe: never poll the provider for a dashboard refresh."""
    if cfg is None:
        return "disabled"
    base = os.getenv("EVOLUTION_API_URL", "").strip().rstrip("/")
    key = os.getenv("EVOLUTION_API_KEY", "").strip()
    if not base.startswith(("https://", "http://")) or not key:
        return "not_configured"
    try:
        with httpx.Client(timeout=3.0) as client:
            result = _provider_sender_status(
                client, base, {"apikey": key, "Accept": "application/json"},
                cfg.instance, cfg.sender,
            )
        return result if result in {"matched", "mismatch", "not_open", "owner_missing", "instance_missing"} else "unavailable"
    except (httpx.HTTPError, ValueError, TypeError, AttributeError):
        return "unavailable"


@router.get("/overview")
def whatsapp_platform_overview(
    limit: int = Query(25, ge=1, le=50),
    offset: int = Query(0, ge=0),
    verify_sender: bool = Query(False),
    admin: dict = Depends(get_current_admin),
):
    """Tenant-scoped reads. No table-wide access to FORCE RLS rows."""
    db = SessionLocal()
    try:
        ids = _discover_restaurant_ids(db)
        now = dt.datetime.now(dt.timezone.utc)
        month = now.strftime("%Y-%m")
        transport = transport_configuration()
        sender = {"state": "unavailable", "connection": "not_verified"}
        if ids:
            with tenant_session_scope(db, ids[0]):
                sender = _sender_snapshot(db, transport)
        if verify_sender:
            sender["connection"] = _verify_connection(transport)
        tenants = []
        totals = {"attempts": 0, "accepted": 0, "failed": 0, "discarded": 0, "deferred": 0, "waiting": 0}
        page_estimated_cost = Decimal("0")
        cost_estimate_complete = True
        for rid in ids[offset:offset + limit]:
            with tenant_session_scope(db, rid):
                restaurant = db.query(Restaurante).filter_by(id=rid).one_or_none()
                cfg = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=rid).one_or_none()
                if restaurant is None:
                    continue
                permissions = _permissions(rid, cfg) if cfg is not None else None
                usage = _usage(db, rid, month)
                queue = _queue_summary(db, rid, now)
                for key in totals:
                    totals[key] += queue["total"] if key == "waiting" else usage[key]
                if usage["estimated_customer_cost_brl"] is None:
                    cost_estimate_complete = False
                else:
                    page_estimated_cost += Decimal(usage["estimated_customer_cost_brl"])
                tenants.append({
                    "restaurant_id": rid, "restaurant_name": restaurant.nome,
                    "saas_status": restaurant.saas_status,
                    "permissions": permissions,
                    "usage": usage,
                    "queue": queue,
                })
        return {
            "checked_at": now.isoformat(),
            "month_utc": month,
            "total_restaurants": len(ids),
            "page_offset": offset,
            "page_limit": limit,
            "sender": sender,
            "page_totals": {**totals, "estimated_customer_cost_brl": str(page_estimated_cost) if cost_estimate_complete else None},
            "tenants": tenants,
            "note": "Aceite HTTP não comprova entrega no celular. Totais são da página exibida.",
        }
    finally:
        db.close()


@router.patch("/restaurantes/{restaurant_id}/permissions")
def update_platform_permissions(
    restaurant_id: int,
    body: PlatformPermissionUpdate,
    admin: dict = Depends(get_current_admin),
):
    """One tenant, one transaction, one immutable audit log; no provider sends."""
    if restaurant_id < 1:
        raise HTTPException(status_code=422, detail="Restaurante inválido.")
    db = SessionLocal()
    try:
        with tenant_session_scope(db, restaurant_id):
            restaurant = db.query(Restaurante).filter_by(id=restaurant_id).one_or_none()
            cfg = (
                db.query(ConfiguracaoRestaurante)
                .filter_by(restaurante_id=restaurant_id)
                .with_for_update()
                .one_or_none()
            )
            if restaurant is None or cfg is None:
                raise HTTPException(status_code=404, detail="Restaurante não encontrado.")
            before = {
                "managed": cfg.whatsapp_platform_managed is True,
                "operator_allowed": (
                    cfg.whatsapp_platform_operator_allowed is True if cfg.whatsapp_platform_managed is True
                    else restaurant_id in allowed_restaurants("KOMA_CENTRAL_WA_ALLOWED_RESTAURANT_IDS")
                ),
                "customer_allowed": (
                    cfg.whatsapp_platform_customer_allowed is True if cfg.whatsapp_platform_managed is True
                    else _legacy_customer(restaurant_id)
                ),
            }
            # Convert from legacy mode without changing the other channel.
            old_operator = before["operator_allowed"]
            old_customer = before["customer_allowed"]
            new_operator = old_operator if body.operator_allowed is None else body.operator_allowed
            new_customer = old_customer if body.customer_allowed is None else body.customer_allowed
            cfg.whatsapp_platform_managed = True
            cfg.whatsapp_platform_operator_allowed = new_operator
            cfg.whatsapp_platform_customer_allowed = new_customer

            if old_operator and not new_operator:
                from .tenant_whatsapp import _cancel_pending_central_notices
                _cancel_pending_central_notices(db, restaurant_id)
            if old_customer and not new_customer:
                from .tenant_whatsapp import _cancel_pending_customer_notices
                _cancel_pending_customer_notices(db, restaurant_id)

            after = {"managed": True, "operator_allowed": new_operator, "customer_allowed": new_customer}
            db.add(SuperAdminAuditLog(
                restaurante_id=restaurant_id,
                actor=str(admin.get("user") or "superadmin"),
                action="SUPERADMIN_WHATSAPP_PLATFORM_PERMISSION",
                reason=body.reason.strip(),
                before_data=before,
                after_data=after,
            ))
            db.commit()
            return {"restaurant_id": restaurant_id, "permissions": _permissions(restaurant_id, cfg), "updated": True}
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        raise HTTPException(status_code=503, detail="Não foi possível atualizar a autorização.")
    finally:
        db.close()


@router.post("/sender/resume")
def resume_central_sender(admin: dict = Depends(get_current_admin)):
    """Explicit admin action; a fresh provider proof precedes new-event resumption."""
    cfg = transport_configuration()
    if cfg is None:
        raise HTTPException(status_code=409, detail="Canal central desativado.")
    # Never reuse the overview's 30-second cache for a state-changing operation.
    if _probe_connection(cfg) != "matched":
        raise HTTPException(status_code=409, detail="Reconecte o WhatsApp do KÔMA e confira o número antes de retomar.")
    db = SessionLocal()
    try:
        from ..services.whatsapp_sender_gate import resume_sender
        if cfg != transport_configuration():
            raise HTTPException(status_code=409, detail="Configuração do canal alterada; verifique novamente.")
        resumed = resume_sender(db, cfg)
        db.commit()
        import logging
        logging.getLogger("koma.whatsapp").info("Central WhatsApp resumed by %r; new events only", admin.get("user", "superadmin"))
        return {"resumed": resumed, "new_events_only": True}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db, require_tenant_id
from ..models import (
    CaixaTurno,
    Comanda,
    OnlinePaymentIntent,
    Pagamento,
    Usuario,
)
from ..security import require_permission
from ..services.online_payments import OnlinePaymentService
from ..services.online_payments.pending_review import (
    _classify_intents_batch,
    build_pending_review_payload,
    close_creation_failure_audited,
    format_intent_error,
    has_definitive_creation_failure_evidence,
    log_payment_event,
)
from ..websocket_manager import manager

router = APIRouter(prefix="/payments", tags=["pagamentos-revisao"])


class CloseCreationFailureRequest(BaseModel):
    reason: str = Field(..., min_length=5, max_length=500)
    confirmed_no_charge: bool = Field(default=False)


def _current_shift_id(db: Session, restaurant_id: int) -> int | None:
    row = (
        db.query(CaixaTurno.id)
        .filter(
            CaixaTurno.restaurante_id == restaurant_id,
            CaixaTurno.status == "aberto",
        )
        .order_by(CaixaTurno.id.desc())
        .first()
    )
    return int(row[0]) if row is not None else None


@router.get("/pending-review")
def list_pending_review(
    provider: str | None = Query(default=None),
    shift_scope: str | None = Query(default=None),
    include_resolved: bool = Query(default=True),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("caixa:operar")),
):
    """Unified Financial Pending Center queue scoped strictly to the caller tenant."""
    rid = require_tenant_id()
    return build_pending_review_payload(
        db,
        restaurant_id=rid,
        include_resolved=include_resolved,
        provider=provider,
        shift_scope=shift_scope,
    )


@router.post("/pending-review/{intent_id}/reconcile")
def reconcile_pending_intent(
    intent_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("caixa:operar")),
):
    """Query the provider authoritatively for an external Pix intent."""
    rid = require_tenant_id()
    intent = (
        db.query(OnlinePaymentIntent)
        .filter(
            OnlinePaymentIntent.restaurante_id == rid,
            OnlinePaymentIntent.id == intent_id,
        )
        .first()
    )
    if intent is None:
        raise HTTPException(status_code=404, detail="Pendência financeira não encontrada.")

    if intent.provider == "direct_pix":
        raise HTTPException(
            status_code=409,
            detail={
                "code": "DIRECT_PIX_MANUAL_REVIEW",
                "message": "Pix com chave própria exige conferência manual no extrato bancário. Use Confirmar pagamento ou Cancelar tentativa.",
            },
        )

    if not intent.external_payment_id:
        comanda = (
            db.query(Comanda)
            .filter(Comanda.restaurante_id == rid, Comanda.id == intent.comanda_id)
            .first()
        )
        active_payments = int(
            db.query(func.count(Pagamento.id))
            .filter(
                Pagamento.restaurante_id == rid,
                Pagamento.comanda_id == intent.comanda_id,
                Pagamento.status.in_(("aprovado", "pendente")),
            )
            .scalar()
            or 0
        )
        eligible, evidence_code, evidence_summary = has_definitive_creation_failure_evidence(
            intent=intent,
            comanda=comanda,
            webhook_count=0,
            active_payment_count=active_payments,
        )
        raise HTTPException(
            status_code=409,
            detail={
                "code": (
                    "CREATION_FAILURE_RECONCILE_NOT_NEEDED"
                    if eligible
                    else "MISSING_EXTERNAL_PAYMENT_ID"
                ),
                "message": (
                    "Esta tentativa falhou antes de gerar cobrança no provedor. Use 'Encerrar falha de criação' após confirmar."
                    if eligible
                    else evidence_summary
                ),
                "evidence_code": evidence_code,
            },
        )

    shift_id = _current_shift_id(db, rid)
    if not OnlinePaymentService.claim_poll_reconciliation(db, intent):
        db.refresh(intent)
        classified = _classify_intents_batch(
            db,
            restaurant_id=rid,
            intents=[intent],
            current_shift_id=shift_id,
        )
        return {
            "status": intent.status,
            "queried": False,
            "approved": intent.status == "approved",
            "item": classified[0] if classified else None,
        }

    try:
        account = OnlinePaymentService.account_for_intent(db, intent)
        result, approved = OnlinePaymentService.reconcile_provider_payment(
            db,
            account=account,
            external_payment_id=intent.external_payment_id,
        )
    except Exception as exc:
        db.rollback()
        locked = (
            db.query(OnlinePaymentIntent)
            .filter(
                OnlinePaymentIntent.restaurante_id == rid,
                OnlinePaymentIntent.id == intent_id,
            )
            .first()
        )
        if locked is not None:
            if not getattr(exc, "error_stage", None):
                try:
                    setattr(exc, "error_stage", "reconcile_failed")
                except Exception:
                    pass
            locked.last_error = format_intent_error(exc)
            db.commit()
        log_payment_event(
            "online_payment_reconcile_failed",
            level=logging.WARNING,
            tenant_id=rid,
            intent_id=intent.id,
            comanda_id=intent.comanda_id,
            provider=intent.provider,
            error_stage=getattr(exc, "error_stage", "reconcile_failed"),
            http_status=getattr(exc, "status_code", None),
            provider_request_id=getattr(exc, "provider_request_id", None),
            actor_user_id=str(current_user.id),
            outcome="reconcile_503",
        )
        raise HTTPException(
            status_code=503,
            detail="Consulta ao provedor indisponível no momento; a pendência foi mantida para nova tentativa ou conferência manual.",
        ) from exc

    if approved:
        manager.queue_committed_broadcast(db, {"event": "tables_updated"}, int(rid))
        manager.queue_committed_broadcast(db, {"event": "new_delivery_order"}, int(rid))
        db.commit()

    refreshed = (
        db.query(OnlinePaymentIntent)
        .filter(
            OnlinePaymentIntent.restaurante_id == rid,
            OnlinePaymentIntent.id == intent_id,
        )
        .first()
    )
    items = (
        _classify_intents_batch(
            db,
            restaurant_id=rid,
            intents=[refreshed],
            current_shift_id=shift_id,
        )
        if refreshed is not None
        else []
    )
    final_status = result.status if result else (refreshed.status if refreshed else intent.status)
    log_payment_event(
        "online_payment_reconcile_completed",
        tenant_id=rid,
        intent_id=intent.id,
        comanda_id=intent.comanda_id,
        provider=intent.provider,
        actor_user_id=str(current_user.id),
        outcome="approved" if approved else final_status,
    )
    return {
        "status": final_status,
        "queried": True,
        "approved": bool(approved),
        "item": items[0] if items else None,
    }


@router.post("/pending-review/{intent_id}/close-creation-failure")
def close_creation_failure(
    intent_id: str,
    payload: CloseCreationFailureRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("configuracoes:administrar")),
):
    """Close only creation-refused attempts backed by positive evidence and audit."""
    rid = require_tenant_id()
    return close_creation_failure_audited(
        db,
        restaurant_id=rid,
        intent_id=intent_id,
        actor_user_id=str(current_user.id),
        reason=payload.reason,
        confirmed_no_charge=payload.confirmed_no_charge,
    )

"""Serviço de investigação automática, deduplicação e correlação de incidentes KÔMA."""

from __future__ import annotations

import datetime
import hashlib
import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ..support_models import SupportInvestigation
from .incident_service import _diagnose_tenant_incidents
from .support_diagnostics import build_tenant_self_diagnosis, classify_support_feedback

_DEDUP_WINDOW_HOURS = 6
_OPEN_STATUSES = ("queued", "collecting", "prepared", "analyzing")


def _utc_now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _as_utc(value: datetime.datetime | None) -> datetime.datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=datetime.timezone.utc)
    return value.astimezone(datetime.timezone.utc)


def _build_dedup_key(
    *,
    restaurante_id: int | None,
    source: str,
    domain: str,
    evidence_status: str | None,
    support_code: str | None,
) -> str:
    raw = "|".join([
        str(restaurante_id or 0),
        source.strip().lower(),
        domain.strip().lower(),
        str(evidence_status or "").strip().lower(),
        str(support_code or "").strip().lower(),
    ])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def _resolve_severity(
    *,
    classification_priority: str,
    evidence_status: str | None,
    suspected_bug: bool,
    correlated_incidents: list[dict[str, Any]],
    last_error_status: int | None,
) -> str:
    if any(item.get("severity") == "critical" for item in correlated_incidents):
        return "critical"
    if evidence_status == "api_error_detected" or (isinstance(last_error_status, int) and last_error_status >= 500):
        return "high"
    if suspected_bug or classification_priority == "high":
        return "high"
    if any(item.get("severity") == "high" for item in correlated_incidents) or classification_priority == "medium":
        return "medium"
    return "low"


def open_or_deduplicate_investigation(
    db: Session,
    *,
    restaurante_id: int | None,
    source: str = "customer_support",
    feedback_id: str | None = None,
    kind: str = "problem",
    message: str = "",
    raw_context: dict[str, Any] | None = None,
    reporter_role: str | None = None,
    external_evidence: dict[str, Any] | None = None,
) -> tuple[SupportInvestigation, bool]:
    """Cria ou deduplica uma investigação durável fora dos hotpaths operacionais."""
    ctx = dict(raw_context or {})
    classification = classify_support_feedback(kind, message, ctx)
    domain = str(ctx.get("interpreted_domain") or classification["area"] or "geral").strip().lower()
    evidence_status = str(ctx.get("evidence_status") or "").strip().lower() or None
    suspected_bug = bool(ctx.get("suspected_bug")) or bool(ctx.get("last_support_code"))
    support_code = str(ctx.get("last_support_code") or "").strip() or None
    last_error_status = ctx.get("last_error_status")

    now = _utc_now()
    dedup_key = _build_dedup_key(
        restaurante_id=restaurante_id,
        source=source,
        domain=domain,
        evidence_status=evidence_status,
        support_code=support_code,
    )
    window_start = now - datetime.timedelta(hours=_DEDUP_WINDOW_HOURS)

    query = db.query(SupportInvestigation).filter(
        SupportInvestigation.dedup_key == dedup_key,
        SupportInvestigation.status.in_(_OPEN_STATUSES),
    )
    if restaurante_id is not None:
        query = query.filter(SupportInvestigation.restaurante_id == restaurante_id)
    else:
        query = query.filter(SupportInvestigation.restaurante_id.is_(None))

    existing = query.order_by(SupportInvestigation.created_at.desc()).with_for_update().first()
    if existing is not None:
        last_seen = _as_utc(existing.last_seen_at) or _as_utc(existing.created_at)
        if last_seen is not None and last_seen >= window_start:
            existing.occurrence_count = int(existing.occurrence_count or 1) + 1
            existing.last_seen_at = now
            if feedback_id and not existing.feedback_id:
                existing.feedback_id = feedback_id
            db.flush()
            return existing, True

    tenant_diag: dict[str, Any] | None = None
    correlated_incidents: list[dict[str, Any]] = []
    if restaurante_id is not None and restaurante_id > 0:
        try:
            tenant_diag = build_tenant_self_diagnosis(
                db,
                restaurante_id,
                user_role=reporter_role or "admin",
                now=now,
            )
        except HTTPException:
            tenant_diag = None
        try:
            raw_incidents = _diagnose_tenant_incidents(db, tenant_id=restaurante_id)
            correlated_incidents = [
                {
                    "id": inc.id,
                    "source": inc.source.value,
                    "severity": inc.severity.value,
                    "title": inc.title,
                    "recommended_action": inc.recommended_action,
                }
                for inc in raw_incidents[:5]
            ]
        except Exception:
            correlated_incidents = []

    severity = _resolve_severity(
        classification_priority=classification["priority"],
        evidence_status=evidence_status,
        suspected_bug=suspected_bug,
        correlated_incidents=correlated_incidents,
        last_error_status=last_error_status if isinstance(last_error_status, int) else None,
    )
    if source == "availability_worker":
        severity = "critical" if (external_evidence or {}).get("status") == "DOWN" else "high"

    untrusted_summary = str(message or "").strip()[:1200] or None
    evidence_snapshot = {
        "captured_at": now.isoformat(),
        "classification": classification,
        "context": {
            "surface": ctx.get("surface"),
            "navigation_id": ctx.get("navigation_id"),
            "frontend_version": ctx.get("frontend_version"),
            "last_support_code": support_code,
            "last_error_status": last_error_status,
            "last_error_area": ctx.get("last_error_area"),
            "last_error_endpoint": ctx.get("last_error_endpoint"),
            "detected_issue_codes": ctx.get("detected_issue_codes") or [],
        },
        "tenant_diagnosis": {
            "summary_status": tenant_diag.get("summary_status"),
            "accepting_online_orders": tenant_diag.get("accepting_online_orders"),
            "online_policy_source": tenant_diag.get("online_policy_source"),
            "operational_qa_active": tenant_diag.get("operational_qa_active"),
            "issues": tenant_diag.get("issues") or [],
        } if tenant_diag else None,
        "correlated_incidents": correlated_incidents,
        "external_evidence": external_evidence,
    }

    initial_diagnosis = {
        "domain": domain,
        "severity": severity,
        "evidence_status": evidence_status or ("external_probe" if source == "availability_worker" else "reported_problem"),
        "suspected_bug": suspected_bug,
        "correlated_incident_count": len(correlated_incidents),
        "triage_command": f"npm run ops:triage -- --investigation {{id}} --json",
    }

    inv_id = f"INV-{uuid.uuid4().hex[:12]}"
    initial_diagnosis["triage_command"] = f"npm run ops:triage -- --investigation {inv_id} --json"

    record = SupportInvestigation(
        id=inv_id,
        restaurante_id=restaurante_id,
        feedback_id=feedback_id,
        source=source,
        dedup_key=dedup_key,
        domain=domain,
        severity=severity,
        status="prepared",
        evidence_status=evidence_status,
        suspected_bug=suspected_bug,
        occurrence_count=1,
        attempts=0,
        max_attempts=3,
        untrusted_summary=untrusted_summary,
        evidence_snapshot=evidence_snapshot,
        initial_diagnosis=initial_diagnosis,
        last_seen_at=now,
    )
    db.add(record)
    db.flush()
    return record, False


def build_investigation_triage_bundle(inv: SupportInvestigation) -> dict[str, Any]:
    """Serializa o pacote estruturado e delimitado para consumo por CLI e agentes."""
    return {
        "schema_version": "1.0",
        "investigation_id": str(inv.id),
        "restaurante_id": inv.restaurante_id,
        "feedback_id": inv.feedback_id,
        "source": str(inv.source),
        "domain": str(inv.domain),
        "severity": str(inv.severity),
        "status": str(inv.status),
        "evidence_status": inv.evidence_status,
        "suspected_bug": bool(inv.suspected_bug),
        "occurrence_count": int(inv.occurrence_count or 1),
        "attempts": int(inv.attempts or 0),
        "max_attempts": int(inv.max_attempts or 3),
        "untrusted_customer_message": (
            {"untrusted": True, "value": inv.untrusted_summary}
            if inv.untrusted_summary
            else None
        ),
        "evidence_snapshot": inv.evidence_snapshot or {},
        "initial_diagnosis": inv.initial_diagnosis or {},
        "agent_result": inv.agent_result,
        "last_error": inv.last_error,
        "last_seen_at": inv.last_seen_at.isoformat() if inv.last_seen_at else None,
        "created_at": inv.created_at.isoformat() if inv.created_at else None,
        "security_boundaries": {
            "read_only_triage": True,
            "customer_input_untrusted": True,
            "disallowed_actions": [
                "modify_payments",
                "privileged_sql",
                "mutate_commercial_data",
                "bypass_pr_checks",
            ],
        },
    }


def record_investigation_agent_result(
    db: Session,
    inv: SupportInvestigation,
    *,
    result_payload: dict[str, Any],
    next_status: str = "completed",
    error_message: str | None = None,
) -> SupportInvestigation:
    """Registra resultado estruturado de execução de agente respeitando max_attempts."""
    attempts = int(inv.attempts or 0)
    max_attempts = int(inv.max_attempts or 3)
    if attempts >= max_attempts:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Limite máximo de tentativas ({max_attempts}) atingido para {inv.id}.",
        )
    inv.attempts = attempts + 1
    inv.agent_result = result_payload
    inv.status = next_status
    inv.last_error = error_message
    inv.updated_at = _utc_now()
    db.flush()
    return inv

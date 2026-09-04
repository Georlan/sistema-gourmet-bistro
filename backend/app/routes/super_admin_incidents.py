import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from ..database import SessionLocal, tenant_session_scope
from ..services.incident_service import (
    IncidentItem,
    IncidentSeverity,
    IncidentSource,
    diagnose_all_incidents,
    execute_incident_action,
)
from .super_admin import _discover_restaurant_ids, get_current_admin

logger = logging.getLogger("koma.super_admin.incidents")
router = APIRouter(prefix="/incidents", tags=["SuperAdminIncidents"])


class IncidentActionRequest(BaseModel):
    tenant_id: int = Field(gt=0)
    action_type: str = Field(min_length=3, max_length=64)
    target_id: str = Field(min_length=1, max_length=128)
    reason: str = Field(min_length=3, max_length=1000)

    model_config = ConfigDict(extra="forbid")


class IncidentSummaryResponse(BaseModel):
    total: int
    by_severity: Dict[str, int]
    by_source: Dict[str, int]


def _incident_tenant_ids(db, requested_tenant_id: Optional[int]) -> List[int]:
    discovered_ids = _discover_restaurant_ids(db)
    if requested_tenant_id is None:
        return discovered_ids
    if requested_tenant_id not in discovered_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Restaurante '{requested_tenant_id}' não encontrado.",
        )
    return [requested_tenant_id]


@router.get("", response_model=List[IncidentItem])
def list_incidents(
    tenant_id: Optional[int] = Query(None, description="Filtrar por ID do restaurante"),
    source: Optional[str] = Query(None, description="Filtrar por origem (outbox, mercado_pago, impressao, acesso, tenant)"),
    severity: Optional[str] = Query(None, description="Filtrar por severidade (critical, high, medium, low, info)"),
    admin: dict = Depends(get_current_admin),
):
    """Diagnostica e lista incidentes operacionais reais do KÔMA."""
    if source and source not in [s.value for s in IncidentSource]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Origem inválida: {source}",
        )
    if severity and severity not in [s.value for s in IncidentSeverity]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Severidade inválida: {severity}",
        )

    db = SessionLocal()
    try:
        return diagnose_all_incidents(
            db,
            tenant_ids=_incident_tenant_ids(db, tenant_id),
            filter_source=source,
            filter_severity=severity,
        )
    finally:
        db.close()


@router.get("/summary", response_model=IncidentSummaryResponse)
def get_incidents_summary(
    tenant_id: Optional[int] = Query(None),
    admin: dict = Depends(get_current_admin),
):
    """Retorna contadores consolidados de incidentes por severidade e origem."""
    db = SessionLocal()
    try:
        all_incidents = diagnose_all_incidents(
            db,
            tenant_ids=_incident_tenant_ids(db, tenant_id),
        )
    finally:
        db.close()

    by_severity = {sev.value: 0 for sev in IncidentSeverity}
    by_source = {src.value: 0 for src in IncidentSource}

    for inc in all_incidents:
        by_severity[inc.severity.value] = by_severity.get(inc.severity.value, 0) + 1
        by_source[inc.source.value] = by_source.get(inc.source.value, 0) + 1

    return IncidentSummaryResponse(
        total=len(all_incidents),
        by_severity=by_severity,
        by_source=by_source,
    )


@router.post("/action")
def perform_incident_action(
    payload: IncidentActionRequest,
    admin: dict = Depends(get_current_admin),
):
    """Executa ação corretiva canônica auditada sobre um incidente operacional."""
    operator = str(admin.get("user") or "superadmin")
    db = SessionLocal()
    try:
        _incident_tenant_ids(db, payload.tenant_id)
        with tenant_session_scope(db, payload.tenant_id):
            return execute_incident_action(
                db,
                tenant_id=payload.tenant_id,
                action_type=payload.action_type,
                target_id=payload.target_id,
                reason=payload.reason,
                operator=operator,
            )
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(err),
        )
    finally:
        db.close()

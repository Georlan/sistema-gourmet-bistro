from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..application.printing import (
    PrintAction,
    PrintIntent,
    PrintSourceType,
    PrintingApplicationService,
    UniversalPrintingError,
)
from ..database import get_db, require_tenant_id
from ..models import Usuario
from ..security import ensure_permission, get_current_user, require_permission
from ..waiter_permissions import require_waiter_permission


router = APIRouter(prefix="/impressao", tags=["Impressão"])


class UniversalPrintRequest(BaseModel):
    source_type: PrintSourceType
    source_id: str = Field(min_length=1, max_length=128)
    action: PrintAction = PrintAction.PRINT
    table_id: Optional[int] = Field(default=None, gt=0)
    values_only: bool = False
    courier_name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    quantity_added: int = Field(default=0, ge=0, le=999)
    idempotency_key: Optional[str] = Field(default=None, min_length=8, max_length=180)


def _authorize_universal_print(
    db: Session,
    current_user: Usuario,
    source_type: PrintSourceType,
) -> None:
    if source_type == PrintSourceType.CASH_SHIFT:
        ensure_permission(current_user, "caixa:operar")
        return
    require_waiter_permission(db, current_user, "perm_garcom_print")


def _execute_print(
    db: Session,
    current_user: Usuario,
    payload: UniversalPrintRequest,
) -> list:
    _authorize_universal_print(db, current_user, payload.source_type)
    restaurante_id = require_tenant_id()
    try:
        jobs = PrintingApplicationService.request_print(
            db,
            PrintIntent(
                restaurant_id=restaurante_id,
                source_type=payload.source_type,
                source_id=payload.source_id,
                action=payload.action,
                table_id=payload.table_id,
                values_only=payload.values_only,
                requested_by=current_user.nome,
                courier_name=payload.courier_name,
                quantity_added=payload.quantity_added,
                idempotency_key=payload.idempotency_key,
            ),
        )
        db.commit()
    except UniversalPrintingError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Não foi possível processar a impressão solicitada.",
        ) from exc

    if not jobs:
        if (
            payload.source_type == PrintSourceType.ITEM
            and payload.action == PrintAction.ITEM_CHANGE
        ):
            return []
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="A impressão física não está disponível no plano atual.",
        )
    return jobs


@router.post("", status_code=status.HTTP_200_OK)
def imprimir_universal(
    payload: UniversalPrintRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Entrada canônica para qualquer solicitação interna de impressão.

    A rota recebe somente intenção/origem. O Core de Impressão resolve regra,
    motor, snapshot, documento, destino e PrintJob. URLs antigas permanecem
    temporariamente somente como aliases sem lógica própria enquanto o frontend
    termina a migração.
    """
    jobs = _execute_print(db, current_user, payload)
    return {
        "status": "success",
        "detail": (
            "Impressão enviada para a fila."
            if jobs
            else "Nenhuma via necessária para esta intenção."
        ),
        "job_ids": [job.id for job in jobs],
        "jobs": [
            {
                "id": job.id,
                "document_type": job.document_type,
                "destination": job.destination,
                "source_type": job.source_type,
                "source_id": job.source_id,
            }
            for job in jobs
        ],
    }


@router.post(
    "/caixa/turnos/{turno_id}/comprovante",
    status_code=status.HTTP_200_OK,
)
def imprimir_comprovante_fechamento_caixa(
    turno_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("caixa:operar")),
):
    """Alias compatível do fechamento para a entrada universal."""
    jobs = _execute_print(
        db,
        current_user,
        UniversalPrintRequest(
            source_type=PrintSourceType.CASH_SHIFT,
            source_id=str(turno_id),
            action=PrintAction.CLOSING,
        ),
    )
    return {
        "status": "success",
        "detail": "Comprovante de fechamento enviado para a fila de impressão.",
        "job_id": jobs[0].id,
    }

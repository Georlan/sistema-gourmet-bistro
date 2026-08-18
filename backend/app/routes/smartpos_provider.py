from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db, require_tenant_id
from ..models import Usuario
from ..security import require_permission
from ..services.capabilities import has_capability
from ..services.payment_providers.registry import ProviderUnavailable, get_configured_provider
from ..services.smartpos_provider_orchestrator import (
    SmartPosProviderError,
    execute_provider_payment,
)
from ..smartpos_models import SmartPosPaymentIntent


router = APIRouter(prefix="/smartpos", tags=["SmartPOS Provider"])


class SmartPosProviderProcessRequest(BaseModel):
    operation_key: str = Field(min_length=8, max_length=128)
    terminal_id: str = Field(min_length=1, max_length=64)


class SmartPosProviderProcessResponse(BaseModel):
    intent_id: str
    status: str
    provider: Optional[str] = None
    provider_reference: Optional[str] = None
    provider_outcome: Optional[str] = None
    provider_message: Optional[str] = None
    replayed: bool = False
    financial_effect: bool = False


@router.post(
    "/payment-intents/{intent_id}/processar-provider",
    response_model=SmartPosProviderProcessResponse,
)
def processar_payment_intent_provider(
    intent_id: str,
    payload: SmartPosProviderProcessRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("smartpos:receber")),
):
    """Processa/reconcilia o provider sem liquidar o financeiro do Kôma."""
    restaurante_id = require_tenant_id()
    if not has_capability(db, restaurante_id, "smartpos"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="SmartPOS não habilitado para este restaurante.",
        )

    intent = db.query(SmartPosPaymentIntent).filter(
        SmartPosPaymentIntent.restaurante_id == restaurante_id,
        SmartPosPaymentIntent.id == intent_id,
    ).first()
    if intent is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Intenção de pagamento não encontrada.",
        )

    try:
        provider = get_configured_provider()
        execution = execute_provider_payment(
            db,
            intent=intent,
            provider=provider,
            operation_key=payload.operation_key,
            terminal_id=payload.terminal_id,
            actor_id=current_user.id,
        )
    except ProviderUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except SmartPosProviderError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc

    result = execution.result
    return {
        "intent_id": execution.intent.id,
        "status": execution.intent.status,
        "provider": execution.intent.provider_name,
        "provider_reference": execution.intent.provider_reference,
        "provider_outcome": result.outcome.value if result else None,
        "provider_message": result.message if result else None,
        "replayed": execution.replayed,
        "financial_effect": False,
    }

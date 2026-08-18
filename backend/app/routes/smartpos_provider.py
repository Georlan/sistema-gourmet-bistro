from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db, require_tenant_id
from ..models import Usuario
from ..security import require_permission
from ..services.capabilities import has_capability
from ..services.payment_providers.base import ProviderOutcome
from ..services.payment_providers.registry import ProviderUnavailable, get_configured_provider
from ..services.smartpos_provider_orchestrator import (
    SmartPosProviderError,
    execute_provider_payment,
)
from ..services.smartpos_terminal_bridge import (
    SmartPosTerminalBridgeError,
    apply_terminal_result,
    prepare_terminal_command,
)
from ..smartpos_models import SmartPosPaymentIntent


router = APIRouter(prefix="/smartpos", tags=["SmartPOS Provider"])
_ACTIVE_PROVIDER_STATUSES = ("criada", "pendente", "processando")


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


class SmartPosPendingProviderIntentResponse(BaseModel):
    intent_id: str
    mesa_id: int
    amount: str
    method: str
    status: str
    created_at: str
    provider: Optional[str] = None
    terminal_id: Optional[str] = None


class SmartPosTerminalPrepareRequest(BaseModel):
    provider: Literal["pagbank"] = "pagbank"
    operation_key: str = Field(min_length=8, max_length=128)
    terminal_id: str = Field(min_length=1, max_length=64)


class SmartPosTerminalPrepareResponse(BaseModel):
    intent_id: str
    restaurante_id: int
    provider: str
    operation_key: str
    terminal_id: str
    amount: str
    method: str
    mode: Literal["charge", "reconcile", "terminal"]
    should_execute: bool
    financial_effect: bool = False


class SmartPosTerminalResultRequest(BaseModel):
    provider: Literal["pagbank"] = "pagbank"
    operation_key: str = Field(min_length=8, max_length=128)
    terminal_id: str = Field(min_length=1, max_length=64)
    outcome: Literal["approved", "declined", "pending", "timeout", "error"]
    reference: Optional[str] = Field(default=None, max_length=128)
    message: Optional[str] = Field(default=None, max_length=255)


class SmartPosTerminalResultResponse(BaseModel):
    intent_id: str
    status: str
    provider: Optional[str] = None
    terminal_id: Optional[str] = None
    provider_reference: Optional[str] = None
    replayed: bool = False
    financial_effect: bool = False


def _load_intent(db: Session, restaurante_id: int, intent_id: str) -> SmartPosPaymentIntent:
    intent = db.query(SmartPosPaymentIntent).filter(
        SmartPosPaymentIntent.restaurante_id == restaurante_id,
        SmartPosPaymentIntent.id == intent_id,
    ).first()
    if intent is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Intenção de pagamento não encontrada.",
        )
    return intent


def _require_smartpos(db: Session, restaurante_id: int) -> None:
    if not has_capability(db, restaurante_id, "smartpos"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="SmartPOS não habilitado para este restaurante.",
        )


def _load_pending_provider_intents(
    db: Session,
    *,
    restaurante_id: int,
    provider: str,
    terminal_id: str,
    limit: int = 50,
) -> list[SmartPosPaymentIntent]:
    """Fila operacional por tenant/provider/terminal, sem qualquer mutação financeira."""
    return (
        db.query(SmartPosPaymentIntent)
        .filter(
            SmartPosPaymentIntent.restaurante_id == restaurante_id,
            SmartPosPaymentIntent.captura == "provider_integrado",
            SmartPosPaymentIntent.status.in_(_ACTIVE_PROVIDER_STATUSES),
            or_(
                SmartPosPaymentIntent.provider_name.is_(None),
                SmartPosPaymentIntent.provider_name == provider,
            ),
            or_(
                SmartPosPaymentIntent.provider_terminal_id.is_(None),
                SmartPosPaymentIntent.provider_terminal_id == terminal_id,
            ),
        )
        .order_by(SmartPosPaymentIntent.criado_em.asc(), SmartPosPaymentIntent.id.asc())
        .limit(limit)
        .all()
    )


@router.get(
    "/payment-intents/pendentes-provider",
    response_model=list[SmartPosPendingProviderIntentResponse],
)
def listar_payment_intents_pendentes_provider(
    terminal_id: str = Query(min_length=1, max_length=64),
    provider: Literal["pagbank"] = "pagbank",
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("smartpos:receber")),
):
    """Lista somente intents integrados que este terminal pode iniciar ou reconciliar."""
    restaurante_id = require_tenant_id()
    _require_smartpos(db, restaurante_id)
    intents = _load_pending_provider_intents(
        db,
        restaurante_id=restaurante_id,
        provider=provider,
        terminal_id=terminal_id,
    )
    return [
        {
            "intent_id": intent.id,
            "mesa_id": intent.mesa_id,
            "amount": str(intent.valor),
            "method": intent.metodo,
            "status": intent.status,
            "created_at": intent.criado_em.isoformat(),
            "provider": intent.provider_name,
            "terminal_id": intent.provider_terminal_id,
        }
        for intent in intents
    ]


@router.post(
    "/payment-intents/{intent_id}/preparar-terminal",
    response_model=SmartPosTerminalPrepareResponse,
)
def preparar_payment_intent_terminal(
    intent_id: str,
    payload: SmartPosTerminalPrepareRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("smartpos:receber")),
):
    """Reserva a operação para um terminal; não chama o SDK Android pelo backend."""
    restaurante_id = require_tenant_id()
    _require_smartpos(db, restaurante_id)
    intent = _load_intent(db, restaurante_id, intent_id)
    try:
        command = prepare_terminal_command(
            db,
            intent=intent,
            provider=payload.provider,
            operation_key=payload.operation_key,
            terminal_id=payload.terminal_id,
            actor_id=current_user.id,
        )
    except SmartPosTerminalBridgeError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return {
        "intent_id": command.intent_id,
        "restaurante_id": command.restaurante_id,
        "provider": command.provider,
        "operation_key": command.operation_key,
        "terminal_id": command.terminal_id,
        "amount": str(command.amount),
        "method": command.method,
        "mode": command.mode,
        "should_execute": command.should_execute,
        "financial_effect": False,
    }


@router.post(
    "/payment-intents/{intent_id}/resultado-terminal",
    response_model=SmartPosTerminalResultResponse,
)
def registrar_resultado_terminal(
    intent_id: str,
    payload: SmartPosTerminalResultRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("smartpos:receber")),
):
    """Aplica retorno normalizado do bridge Android sem liquidar o financeiro."""
    restaurante_id = require_tenant_id()
    _require_smartpos(db, restaurante_id)
    intent = _load_intent(db, restaurante_id, intent_id)
    try:
        applied = apply_terminal_result(
            db,
            intent=intent,
            provider=payload.provider,
            operation_key=payload.operation_key,
            terminal_id=payload.terminal_id,
            outcome=ProviderOutcome(payload.outcome),
            reference=payload.reference,
            message=payload.message,
            actor_id=current_user.id,
        )
    except SmartPosTerminalBridgeError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return {
        "intent_id": applied.intent.id,
        "status": applied.intent.status,
        "provider": applied.intent.provider_name,
        "terminal_id": applied.intent.provider_terminal_id,
        "provider_reference": applied.intent.provider_reference,
        "replayed": applied.replayed,
        "financial_effect": False,
    }


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
    """Processa/reconcilia o provider simulado sem liquidar o financeiro do Kôma."""
    restaurante_id = require_tenant_id()
    _require_smartpos(db, restaurante_id)
    intent = _load_intent(db, restaurante_id, intent_id)

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

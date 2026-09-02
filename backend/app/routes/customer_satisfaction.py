from typing import Optional
from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db, require_tenant_id
from ..models import Usuario
from ..security import require_permission
from ..services.customer_satisfaction import (
    get_customer_satisfaction_data,
    record_customer_satisfaction,
)

router = APIRouter(tags=["Satisfação do Cliente"])


class CreateSatisfactionInput(BaseModel):
    cliente_id: str = Field(..., min_length=1, description="ID canônico do cliente")
    nota: int = Field(..., ge=1, le=5, description="Nota de satisfação de 1 a 5")
    comentario: Optional[str] = Field(None, max_length=1000, description="Comentário opcional")
    comanda_id: Optional[str] = Field(None, description="ID da comanda opcional")


@router.get("/clientes/satisfacao")
def get_customer_satisfaction(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("fidelidade:operar")),
):
    """
    Retorna o resumo agregado e a lista de avaliações recentes de satisfação do cliente
    no escopo do tenant autenticado.
    """
    restaurante_id = require_tenant_id()
    return get_customer_satisfaction_data(db, restaurante_id)


@router.post("/clientes/satisfacao", status_code=status.HTTP_201_CREATED)
def create_customer_satisfaction(
    payload: CreateSatisfactionInput,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("fidelidade:operar")),
):
    """
    Registra uma avaliação de satisfação validando tenant isolation e identidade do cliente.
    """
    restaurante_id = require_tenant_id()
    return record_customer_satisfaction(
        db=db,
        restaurante_id=restaurante_id,
        cliente_id=payload.cliente_id,
        nota=payload.nota,
        comentario=payload.comentario,
        comanda_id=payload.comanda_id,
    )

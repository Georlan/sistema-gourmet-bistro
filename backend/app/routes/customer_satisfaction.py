import os
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db, require_tenant_id
from ..models import Restaurante, Usuario
from ..security import get_current_user, require_permission
from ..services.customer_satisfaction import (
    get_customer_satisfaction_data,
    record_customer_satisfaction,
)
from ..services.signup_notifications import enqueue
from ..support_models import CustomerSupportFeedback

router = APIRouter(tags=["Satisfação do Cliente"])


class CreateSatisfactionInput(BaseModel):
    cliente_id: str = Field(..., min_length=1, description="ID canônico do cliente")
    nota: int = Field(..., ge=1, le=5, description="Nota de satisfação de 1 a 5")
    comentario: Optional[str] = Field(None, max_length=1000, description="Comentário opcional")
    comanda_id: Optional[str] = Field(None, description="ID da comanda opcional")


class CreateKomaSupportFeedbackInput(BaseModel):
    kind: Literal["question", "suggestion", "complaint", "problem"]
    message: str = Field(..., min_length=5, max_length=2000)
    page_path: Optional[str] = Field(None, max_length=300)


def _safe_feedback_page_path(value: Optional[str]) -> Optional[str]:
    """Mantém contexto de tela sem persistir query string ou fragmentos secretos."""
    path = (value or "").split("?", 1)[0].split("#", 1)[0].strip()
    if not path.startswith("/"):
        return None
    return path[:300] or None


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


@router.post("/api/support/feedback", status_code=status.HTTP_201_CREATED)
def create_koma_support_feedback(
    payload: CreateKomaSupportFeedbackInput,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Registra feedback do cliente KÔMA e avisa o operador pelos canais configurados."""
    restaurante_id = require_tenant_id()
    feedback_id = str(uuid.uuid4())
    page_path = _safe_feedback_page_path(payload.page_path)
    reporter_name = str(getattr(current_user, "nome", "") or "").strip() or None
    reporter_role = str(
        getattr(current_user, "role", None)
        or getattr(current_user, "cargo", None)
        or ""
    ).strip() or None
    reporter_user_id = str(getattr(current_user, "id", "") or "unknown")

    feedback = CustomerSupportFeedback(
        id=feedback_id,
        restaurante_id=restaurante_id,
        reporter_user_id=reporter_user_id,
        reporter_name=reporter_name,
        reporter_role=reporter_role,
        kind=payload.kind,
        message=payload.message.strip(),
        page_path=page_path,
        status="new",
    )
    db.add(feedback)

    restaurant_name = (
        db.query(Restaurante.nome)
        .filter(Restaurante.id == restaurante_id)
        .scalar()
        or f"Restaurante #{restaurante_id}"
    )
    kind_labels = {
        "question": "Dúvida",
        "suggestion": "Sugestão",
        "complaint": "Reclamação",
        "problem": "Problema",
    }
    kind_label = kind_labels[payload.kind]
    owner_email = (settings.KOMA_OWNER_EMAIL or "").strip()
    owner_phone = os.getenv("KOMA_OWNER_WHATSAPP_PHONE", "").strip()

    if owner_email or owner_phone:
        reporter = reporter_name or reporter_user_id
        role_suffix = f" ({reporter_role})" if reporter_role else ""
        page_suffix = f"\nTela: {page_path}" if page_path else ""
        enqueue(
            db,
            protocol=f"SUP-{feedback_id}",
            kind="customer-feedback",
            email=owner_email or None,
            phone=owner_phone or None,
            subject=f"{kind_label} de cliente — KÔMA",
            message=(
                f"Novo feedback KÔMA [{feedback_id}]\n"
                f"Tipo: {kind_label}\n"
                f"Restaurante: {restaurant_name} (ID {restaurante_id})\n"
                f"Enviado por: {reporter}{role_suffix}"
                f"{page_suffix}\n\n"
                f"Mensagem:\n{feedback.message}"
            ),
        )

    db.commit()
    return {"id": feedback_id, "status": "received"}

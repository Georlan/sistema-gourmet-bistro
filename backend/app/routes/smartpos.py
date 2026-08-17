from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db, require_tenant_id
from ..models import CaixaTurno, Usuario
from ..security import get_current_user
from ..services.capabilities import has_capability


router = APIRouter(prefix="/smartpos", tags=["SmartPOS"])
_ALLOWED_ROLES = {"garcom", "caixa", "gerente"}


@router.get("/contexto")
def obter_contexto_smartpos(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Contexto mínimo para navegação do SmartPOS, sem dados de caixa."""
    role = (current_user.role or current_user.cargo or "").strip().lower()
    if role not in _ALLOWED_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Este perfil não possui acesso operacional ao SmartPOS.",
        )

    restaurante_id = require_tenant_id()
    smartpos_enabled = has_capability(db, restaurante_id, "smartpos")
    turno = db.query(CaixaTurno).filter(
        CaixaTurno.restaurante_id == restaurante_id,
        CaixaTurno.status == "aberto",
    ).first()
    turno_aberto = turno is not None

    return {
        "smartpos_enabled": smartpos_enabled,
        "turno_aberto": turno_aberto,
        "turno_id": turno.id if turno else None,
        "mesas_disponiveis": smartpos_enabled and turno_aberto,
        "pedidos_disponiveis": smartpos_enabled and turno_aberto,
        "venda_rapida_disponivel": smartpos_enabled,
        "operador": {
            "id": current_user.id,
            "nome": current_user.nome,
            "role": role,
            "restaurante_id": restaurante_id,
        },
    }

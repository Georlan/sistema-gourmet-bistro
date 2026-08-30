"""Serviço de validação e controle de turnos de caixa (Cash Shifts)."""

from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ..database import require_tenant_id
from ..models import CaixaTurno


def require_open_cash_shift(
    db: Session,
    restaurante_id: Optional[int] = None,
) -> CaixaTurno:
    """Valida que o turno de caixa está aberto para o estabelecimento."""
    rid = restaurante_id if restaurante_id is not None else require_tenant_id()
    turno_aberto = (
        db.query(CaixaTurno)
        .filter(
            CaixaTurno.restaurante_id == rid,
            CaixaTurno.status == "aberto",
        )
        .first()
    )
    if not turno_aberto:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "O caixa precisa estar aberto para criar, aceitar ou imprimir "
                "pedidos. Abra o turno e tente novamente."
            ),
        )
    return turno_aberto

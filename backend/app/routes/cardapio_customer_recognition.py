"""Reconhecimento comercial mínimo de cliente no checkout público.

O endpoint informa somente se o telefone já possui uma ficha comercial no
restaurante. Nenhum nome, endereço, saldo, histórico ou identificador interno é
exposto: conhecer um telefone não equivale a autenticar a conta do cliente.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas import CustomerOtpRequest
from ..services.clientes import buscar_cliente_por_telefone
from ..services.public_orders import (
    client_ip as _client_ip,
    consume_rate_limit as _consume_rate_limit,
)
from .cardapio_digital import public_tenant_scope


router = APIRouter()


@router.post("/reconhecer")
def recognize_customer(
    payload: CustomerOtpRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Retorna apenas se existe ficha comercial para ``tenant + telefone``.

    O resultado serve para orientar a UX do checkout. A associação canônica do
    pedido continua sendo feita no backend e não concede sessão/autorização.
    """

    with public_tenant_scope(str(payload.restaurante_id), None, db) as restaurante_id:
        _consume_rate_limit(
            db,
            restaurante_id=restaurante_id,
            scope="customer_recognition_ip",
            raw_key=_client_ip(request),
            max_requests=60,
            window_seconds=300,
            detail="Muitas consultas de identificação. Tente novamente em alguns minutos.",
        )
        db.commit()

        try:
            cliente = buscar_cliente_por_telefone(
                db,
                restaurante_id=restaurante_id,
                telefone=payload.telefone,
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            ) from exc

        return {"found": cliente is not None}

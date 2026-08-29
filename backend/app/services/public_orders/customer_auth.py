"""Autenticação e verificação de clientes do cardápio digital."""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ...models import Cliente
from ..clientes import buscar_cliente_por_id
from ..customer_auth import CustomerTokenClaims, decode_customer_access_token


def authenticated_customer(
    db: Session,
    *,
    raw_token: str,
    expected_restaurante_id: int | None = None,
) -> tuple[CustomerTokenClaims, Cliente]:
    """Valida o token JWT de cliente e carrega a entidade Cliente correspondente."""
    try:
        claims = decode_customer_access_token(raw_token)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        ) from exc

    if (
        expected_restaurante_id is not None
        and claims.restaurante_id != expected_restaurante_id
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sessão não pertence a este restaurante.",
        )

    cliente = buscar_cliente_por_id(
        db,
        restaurante_id=claims.restaurante_id,
        cliente_id=claims.cliente_id,
    )
    if cliente is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sessão de cliente inválida ou expirada.",
        )
    return claims, cliente

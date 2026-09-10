"""Regras compartilhadas de elegibilidade de cupons direcionados a clientes."""

from __future__ import annotations

from sqlalchemy.orm import Session

from .clientes import buscar_cliente_por_telefone


def customer_matches_targeted_coupon(
    db: Session,
    *,
    restaurante_id: int,
    targeted_cliente_id: str | None,
    cliente_id: str | None = None,
    cliente_telefone: str | None = None,
) -> bool:
    """Valida o destinatário de um cupom sem confiar em identidade de outro tenant.

    Cupons públicos (sem ``targeted_cliente_id``) permanecem elegíveis. Para
    cupons direcionados, uma identidade autenticada pode ser comparada pelo ID
    canônico; na ausência dela, o telefone informado precisa resolver para a
    mesma ficha de cliente dentro do restaurante do cupom.
    """
    if not targeted_cliente_id:
        return True

    target_id = str(targeted_cliente_id)
    if cliente_id:
        return str(cliente_id) == target_id

    if not cliente_telefone:
        return False

    try:
        cliente = buscar_cliente_por_telefone(
            db,
            restaurante_id=restaurante_id,
            telefone=cliente_telefone,
        )
    except ValueError:
        return False

    return cliente is not None and str(cliente.id) == target_id

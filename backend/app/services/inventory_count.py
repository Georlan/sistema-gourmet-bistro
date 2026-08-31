"""Shared physical-count adjustment, without committing or changing entry-cost policies."""

from sqlalchemy.orm import Session
from ..models import Insumo, MovimentacaoEstoque, SessaoContagemEstoque


def apply_inventory_count(
    db: Session,
    *,
    insumo: Insumo,
    counted: float,
    session: SessaoContagemEstoque,
    restaurant_id: int,
    observation: str | None,
    user_id: str | None,
) -> bool:
    previous = insumo.estoque_atual or 0.0
    difference = counted - previous
    if difference == 0:
        return False

    insumo.estoque_atual = counted
    db.add(MovimentacaoEstoque(
        restaurante_id=restaurant_id,
        insumo_id=insumo.id,
        tipo="contagem",
        quantidade=abs(difference),
        saldo_anterior=previous,
        saldo_posterior=counted,
        custo_unitario=insumo.preco_medio_custo or 0.0,
        motivo=f"Ajuste por inventário físico (Sessão {session.id[:8]})",
        observacao=observation,
        origem="contagem",
        referencia_id=session.id,
        usuario_id=user_id,
    ))
    return True

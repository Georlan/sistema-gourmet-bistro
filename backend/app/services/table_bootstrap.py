from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from ..models import ConfiguracaoRestaurante, Mesa, Restaurante


@dataclass(frozen=True)
class TableBootstrapResult:
    requested_count: int
    default_capacity: int
    existing_before: int
    created_ids: tuple[int, ...]
    total_after: int
    table_map_enabled: bool


def bootstrap_standard_tables(
    db: Session,
    *,
    tenant_id: int,
    count: int,
    default_capacity: int,
) -> TableBootstrapResult:
    """Cria somente mesas padronizadas ausentes de 1..count.

    A operação é deliberadamente não destrutiva: reduzir a quantidade nunca remove
    mesas existentes nem altera nomes/capacidades personalizados. O bloqueio do
    restaurante serializa chamadas concorrentes do onboarding e do Super Admin.
    """
    if count < 1 or count > 300:
        raise ValueError("A quantidade de mesas deve ficar entre 1 e 300.")
    if default_capacity < 1 or default_capacity > 50:
        raise ValueError("A capacidade padrão deve ficar entre 1 e 50 lugares.")

    restaurant = (
        db.query(Restaurante)
        .filter(Restaurante.id == tenant_id)
        .with_for_update()
        .one_or_none()
    )
    if restaurant is None:
        raise LookupError("Restaurante não encontrado.")

    existing_ids = {
        int(row[0])
        for row in db.query(Mesa.id)
        .filter(Mesa.restaurante_id == tenant_id)
        .all()
    }
    created_ids: list[int] = []
    for table_id in range(1, count + 1):
        if table_id in existing_ids:
            continue
        db.add(
            Mesa(
                id=table_id,
                restaurante_id=tenant_id,
                capacidade=default_capacity,
                nome=f"Mesa {table_id}",
            )
        )
        created_ids.append(table_id)

    config = (
        db.query(ConfiguracaoRestaurante)
        .filter(ConfiguracaoRestaurante.restaurante_id == tenant_id)
        .with_for_update()
        .one_or_none()
    )
    if config is not None:
        config.mapa_mesas_ativo = True

    db.flush()
    total_after = int(
        db.query(Mesa.id)
        .filter(Mesa.restaurante_id == tenant_id)
        .count()
    )
    return TableBootstrapResult(
        requested_count=count,
        default_capacity=default_capacity,
        existing_before=len(existing_ids),
        created_ids=tuple(created_ids),
        total_after=total_after,
        table_map_enabled=bool(config and config.mapa_mesas_ativo),
    )

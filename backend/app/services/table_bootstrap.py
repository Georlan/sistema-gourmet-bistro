from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text
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


def _serialize_tenant_bootstrap(db: Session, tenant_id: int) -> None:
    """Serializa apenas este bootstrap sem depender de SELECT ... FOR UPDATE.

    Em PostgreSQL usamos advisory lock transacional por tenant. SQLite/testes
    seguem sem lock dedicado; a restrição única (restaurante_id, id) continua
    protegendo a integridade dos números de mesa.
    """
    if db.get_bind().dialect.name != "postgresql":
        return
    db.execute(
        text("SELECT pg_advisory_xact_lock(:namespace, :tenant_id)"),
        {
            "namespace": 1263488321,  # "KOMA" em inteiro de 32 bits
            "tenant_id": int(tenant_id),
        },
    )


def bootstrap_standard_tables(
    db: Session,
    *,
    tenant_id: int,
    count: int,
    default_capacity: int,
) -> TableBootstrapResult:
    """Cria somente mesas padronizadas ausentes de 1..count.

    A operação é deliberadamente não destrutiva: reduzir a quantidade nunca remove
    mesas existentes nem altera nomes/capacidades personalizados.
    """
    if count < 1 or count > 300:
        raise ValueError("A quantidade de mesas deve ficar entre 1 e 300.")
    if default_capacity < 1 or default_capacity > 50:
        raise ValueError("A capacidade padrão deve ficar entre 1 e 50 lugares.")

    _serialize_tenant_bootstrap(db, tenant_id)

    restaurant = (
        db.query(Restaurante)
        .filter(Restaurante.id == tenant_id)
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
        mesa = Mesa(
            id=table_id,
            restaurante_id=tenant_id,
            capacidade=default_capacity,
            nome=f"Mesa {table_id}",
        )
        db.add(mesa)
        # Produção usa PostgreSQL + RLS. Flush individual evita o caminho de
        # insert em lote/RETURNING que pode não ser suportado por alguns setups
        # PostgreSQL compatíveis e mantém o erro associado à mesa específica.
        db.flush([mesa])
        created_ids.append(table_id)
        existing_ids.add(table_id)

    config = (
        db.query(ConfiguracaoRestaurante)
        .filter(ConfiguracaoRestaurante.restaurante_id == tenant_id)
        .one_or_none()
    )
    if config is not None:
        config.mapa_mesas_ativo = True
        db.flush([config])

    return TableBootstrapResult(
        requested_count=count,
        default_capacity=default_capacity,
        existing_before=len(existing_ids) - len(created_ids),
        created_ids=tuple(created_ids),
        total_after=len(existing_ids),
        table_map_enabled=bool(config and config.mapa_mesas_ativo),
    )

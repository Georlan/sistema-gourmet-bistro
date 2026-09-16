"""Plano transacional e auditável para limpar dados de homologação do KÔMA.

O serviço usa reflexão do schema real para incluir tabelas novas no relatório e
deriva o escopo de tenant por FKs, inclusive para filhos sem ``restaurante_id``.
Ele nunca altera schema e nunca usa TRUNCATE.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from typing import Any, Iterable

from sqlalchemy import MetaData, Table, and_, delete, exists, func, or_, select, text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import NoReferencedTableError


KEEP_RESTAURANT_ID = 1
CONFIRMATION_PHRASE = "PURGE_KEEP_RESTAURANT_1"
WAIVE_BACKUP_PHRASE = "PURGE_WITHOUT_BACKUP_CONFIRMED"

# Após a limpeza, o tenant 1 deve ficar como uma casca funcional mínima.
# Preservamos apenas identidade técnica do restaurante e entitlement/plano.
# Cardápio, mesas, clientes, pedidos, caixa, fidelidade, fiscal e contas de
# pagamento são deliberadamente removidos para evitar qualquer resíduo de
# homologação ou conflito de email/telefone antes de uma apresentação.
PRESERVE_TENANT_ONE_TABLES = frozenset(
    {
        "restaurantes",
        "restaurante_capabilities",
        "saas_subscriptions",
    }
)

# Dados globais de retomada/notificação de cadastros de homologação. Não são
# configuração do Resend; apenas filas/capabilities antigas armazenadas no banco.
GLOBAL_OPERATIONAL_TABLES = frozenset({"restaurant_signups", "signup_notifications"})

REQUIRED_PRESERVED_TABLES = ("restaurantes",)


@dataclass(frozen=True)
class PurgePlan:
    database: str
    keep_restaurant_id: int
    delete_counts: dict[str, int]
    preserved_counts: dict[str, int]
    unclassified_tables: tuple[str, ...]
    fingerprint: str

    @property
    def total_rows(self) -> int:
        return sum(self.delete_counts.values())

    def to_dict(self) -> dict[str, Any]:
        return {
            "database": self.database,
            "keep_restaurant_id": self.keep_restaurant_id,
            "mode": "dry-run",
            "delete_counts": self.delete_counts,
            "delete_total": self.total_rows,
            "preserved_counts": self.preserved_counts,
            "unclassified_tables": list(self.unclassified_tables),
            "fingerprint": self.fingerprint,
        }


def _database_name(connection: Connection) -> str:
    if connection.dialect.name == "postgresql":
        return str(connection.execute(text("SELECT current_database()")).scalar_one()).strip()
    return str(connection.engine.url.database or ":memory:")


def _reflect(connection: Connection) -> MetaData:
    metadata = MetaData()
    metadata.reflect(bind=connection)
    return metadata


def _tenant_predicate(
    table: Table,
    restaurant_ids: Iterable[int] | None,
    *,
    exclude_restaurant_id: int | None = None,
    trail: frozenset[str] = frozenset(),
):
    if table.name in trail:
        return None
    next_trail = trail | {table.name}

    if "restaurante_id" in table.c:
        column = table.c.restaurante_id
        if restaurant_ids is not None:
            ids = tuple(int(value) for value in restaurant_ids)
            return column.in_(ids)
        if exclude_restaurant_id is not None:
            return and_(column.is_not(None), column != int(exclude_restaurant_id))

    alternatives = []
    try:
        constraints = tuple(table.foreign_key_constraints)
    except NoReferencedTableError:
        constraints = ()
    for constraint in constraints:
        try:
            parent = constraint.referred_table
        except NoReferencedTableError:
            continue
        parent_scope = _tenant_predicate(
            parent,
            restaurant_ids,
            exclude_restaurant_id=exclude_restaurant_id,
            trail=next_trail,
        )
        if parent_scope is None:
            continue
        pairs = [element.parent == element.column for element in constraint.elements]
        alternatives.append(exists(select(1).select_from(parent).where(and_(*pairs, parent_scope))))
    return or_(*alternatives) if alternatives else None


def _count(connection: Connection, table: Table, predicate) -> int:
    statement = select(func.count()).select_from(table)
    if predicate is not None:
        statement = statement.where(predicate)
    return int(connection.execute(statement).scalar_one())


def _preserved_counts(connection: Connection, metadata: MetaData) -> dict[str, int]:
    result: dict[str, int] = {}
    for name in sorted(PRESERVE_TENANT_ONE_TABLES):
        table = metadata.tables.get(name)
        if table is None:
            continue
        predicate = _tenant_predicate(table, (KEEP_RESTAURANT_ID,))
        if name == "restaurantes":
            predicate = table.c.id == KEEP_RESTAURANT_ID
        result[name] = _count(connection, table, predicate)
    return result


def _delete_predicates(metadata: MetaData) -> tuple[dict[str, Any], tuple[str, ...]]:
    predicates: dict[str, Any] = {}
    unclassified: list[str] = []

    for table in metadata.sorted_tables:
        if table.name == "alembic_version":
            continue
        tenant_one = _tenant_predicate(table, (KEEP_RESTAURANT_ID,))
        other_tenants = _tenant_predicate(table, None, exclude_restaurant_id=KEEP_RESTAURANT_ID)

        alternatives = []
        if other_tenants is not None:
            alternatives.append(other_tenants)
        if tenant_one is not None and table.name not in PRESERVE_TENANT_ONE_TABLES:
            alternatives.append(tenant_one)
        if table.name in GLOBAL_OPERATIONAL_TABLES:
            alternatives.append(text("1 = 1"))

        # Setup SaaS sem tenant é onboarding incompleto; setup do tenant 1 fica.
        if table.name == "saas_billing_setups" and "restaurante_id" in table.c:
            alternatives.append(table.c.restaurante_id.is_(None))

        if alternatives:
            predicates[table.name] = or_(*alternatives)
        elif table.name not in PRESERVE_TENANT_ONE_TABLES and table.name not in {
            "contract_acceptances",
            "fiscal_official_reference_snapshots",
            "fiscal_official_reference_states",
        }:
            unclassified.append(table.name)

    restaurants = metadata.tables.get("restaurantes")
    if restaurants is not None:
        predicates["restaurantes"] = restaurants.c.id != KEEP_RESTAURANT_ID
    return predicates, tuple(sorted(unclassified))


def _fingerprint(database: str, counts: dict[str, int], preserved: dict[str, int]) -> str:
    payload = json.dumps(
        {"database": database, "delete": counts, "preserved": preserved},
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def build_purge_plan(connection: Connection) -> PurgePlan:
    metadata = _reflect(connection)
    restaurants = metadata.tables.get("restaurantes")
    if restaurants is None or _count(connection, restaurants, restaurants.c.id == KEEP_RESTAURANT_ID) != 1:
        raise RuntimeError("Trava de segurança: restaurante id=1 não existe exatamente uma vez.")

    predicates, unclassified = _delete_predicates(metadata)
    delete_counts = {
        name: _count(connection, metadata.tables[name], predicate)
        for name, predicate in sorted(predicates.items())
    }
    preserved = _preserved_counts(connection, metadata)
    for required in REQUIRED_PRESERVED_TABLES:
        if preserved.get(required, 0) <= 0:
            raise RuntimeError(f"Trava de segurança: estrutura obrigatória ausente em {required} para tenant 1.")
    database = _database_name(connection)
    return PurgePlan(
        database=database,
        keep_restaurant_id=KEEP_RESTAURANT_ID,
        delete_counts=delete_counts,
        preserved_counts=preserved,
        unclassified_tables=unclassified,
        fingerprint=_fingerprint(database, delete_counts, preserved),
    )


def apply_purge(
    engine: Engine,
    *,
    expected_fingerprint: str,
    expected_database: str,
    confirmation: str,
    backup_reference: str = "",
    backup_waiver: str = "",
) -> dict[str, Any]:
    if confirmation != CONFIRMATION_PHRASE:
        raise RuntimeError("Frase de confirmação inválida.")
    has_backup = bool(backup_reference.strip())
    has_waiver = backup_waiver == WAIVE_BACKUP_PHRASE
    if not has_backup and not has_waiver:
        raise RuntimeError(
            "Informe uma referência de backup restaurável ou a renúncia explícita de backup."
        )
    if backup_waiver and not has_waiver:
        raise RuntimeError("Frase de renúncia de backup inválida.")

    with engine.begin() as connection:
        if connection.dialect.name == "postgresql":
            connection.execute(text("SELECT pg_advisory_xact_lock(hashtext('koma-safe-data-purge-v1'))"))
        plan = build_purge_plan(connection)
        if plan.database != expected_database:
            raise RuntimeError("Banco atual diverge do banco confirmado no dry-run.")
        if plan.fingerprint != expected_fingerprint:
            raise RuntimeError("O banco mudou após o dry-run; gere um novo plano.")
        if plan.unclassified_tables:
            raise RuntimeError(
                "Há tabelas não classificadas; revise antes de aplicar: "
                + ", ".join(plan.unclassified_tables)
            )

        metadata = _reflect(connection)
        predicates, _ = _delete_predicates(metadata)
        removed: dict[str, int] = {}
        for table in reversed(metadata.sorted_tables):
            predicate = predicates.get(table.name)
            if predicate is None:
                continue
            result = connection.execute(delete(table).where(predicate))
            removed[table.name] = int(result.rowcount or 0)

        after = build_purge_plan(connection)
        if after.delete_counts.get("restaurantes", 0) != 0:
            raise RuntimeError("Validação final falhou: ainda existem restaurantes diferentes de id=1.")
        if any(after.preserved_counts.get(name) != count for name, count in plan.preserved_counts.items()):
            raise RuntimeError("Validação final falhou: dados técnicos preservados do tenant 1 foram alterados.")
        if any(after.delete_counts.values()):
            remaining = {name: count for name, count in after.delete_counts.items() if count}
            raise RuntimeError(f"Validação final falhou: dados removíveis permaneceram: {remaining}")

        return {
            "mode": "apply",
            "database": plan.database,
            "backup_reference": backup_reference or None,
            "backup_waived": has_waiver and not has_backup,
            "fingerprint": plan.fingerprint,
            "removed": removed,
            "removed_total": sum(removed.values()),
            "preserved_counts": after.preserved_counts,
            "validation": "passed",
        }

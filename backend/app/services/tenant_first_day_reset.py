"""Tenant-scoped operational reset for a restaurant's first real day.

This module intentionally touches only explicit operational/history tables. It
preserves catalog, photos/assets, settings, users, plans/subscriptions,
integrations, printer registration and other structural tenant data.

Dry-run is the default at the CLI layer. Apply runs in one transaction and
validates that preserved structural row counts do not change.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import MetaData, delete, func, select, text, update
from sqlalchemy.engine import Connection, Engine


CONFIRMATION_PHRASE = "RESET_TENANT_FIRST_DAY"

OPERATIONAL_TABLES = frozenset(
    {
        "print_jobs",
        "integration_outbox",
        "external_order_references",
        "notificacoes_whatsapp",
        "order_push_subscriptions",
        "order_conversation_events",
        "order_messages",
        "order_conversations",
        "scheduled_orders",
        "comanda_delivery_address_snapshots",
        "delivery_courier_reassignment_audit",
        "smartpos_payment_intent_events",
        "smartpos_payment_intents",
        "pagamento_estorno_liquidacoes",
        "pagamento_estorno_alocacoes",
        "pagamento_estornos",
        "pagamento_alocacoes",
        "online_payment_webhook_events",
        "online_payment_intents",
        "pagamentos",
        "caixa_movimentacoes",
        "caixa_turnos",
        "lancamento_identidades",
        "movimentos_atendimento",
        "atendimento_comandas",
        "atendimentos_mesa",
        "numeradores_operacionais",
        "item_modificadores",
        "itens",
        "lancamentos",
        "historico_fidelidade",
        "avaliacoes_clientes",
        "rascunhos_pedidos",
        "comandas",
    }
)

PRESERVED_TABLES = frozenset(
    {
        "restaurantes",
        "usuarios",
        "categorias",
        "produtos",
        "produto_insumos",
        "grupo_modificadores",
        "opcao_modificadores",
        "produto_grupo_modificadores",
        "configuracoes_restaurante",
        "configuracoes_ia",
        "mesas",
        "print_agent_tokens",
        "restaurant_payment_accounts",
        "restaurante_capabilities",
        "saas_subscriptions",
        "clientes",
        "motoboys",
        "config_fidelizacao",
        "insumos",
        "restaurant_fiscal_profiles",
        "product_fiscal_profiles",
        "fiscal_sequences",
    }
)


@dataclass(frozen=True)
class TenantFirstDayPlan:
    tenant_id: int
    restaurant_name: str
    open_cash_shifts: int
    fiscal_documents: int
    operational_counts: dict[str, int]
    preserved_counts: dict[str, int]

    def to_dict(self) -> dict[str, Any]:
        return {
            "mode": "dry-run",
            "tenant_id": self.tenant_id,
            "restaurant_name": self.restaurant_name,
            "open_cash_shifts": self.open_cash_shifts,
            "fiscal_documents": self.fiscal_documents,
            "operational_counts": self.operational_counts,
            "operational_total": sum(self.operational_counts.values()),
            "preserved_counts": self.preserved_counts,
            "next_order_expected_after_apply_and_restart": 1,
        }


def _reflect(connection: Connection) -> MetaData:
    metadata = MetaData()
    metadata.reflect(bind=connection)
    return metadata


def _tenant_count(connection: Connection, table, tenant_id: int) -> int | None:
    if table.name == "restaurantes":
        predicate = table.c.id == tenant_id
    elif "restaurante_id" in table.c:
        predicate = table.c.restaurante_id == tenant_id
    else:
        return None
    return int(
        connection.execute(
            select(func.count()).select_from(table).where(predicate)
        ).scalar_one()
    )


def _restaurant_name(connection: Connection, metadata: MetaData, tenant_id: int) -> str:
    table = metadata.tables.get("restaurantes")
    if table is None:
        raise RuntimeError("Tabela restaurantes ausente.")
    row = connection.execute(
        select(table.c.nome).where(table.c.id == tenant_id)
    ).first()
    if row is None:
        raise RuntimeError(f"Restaurante id={tenant_id} nao encontrado.")
    return str(row[0] or "").strip()


def _counts_for(
    connection: Connection,
    metadata: MetaData,
    names: frozenset[str],
    tenant_id: int,
) -> dict[str, int]:
    result: dict[str, int] = {}
    for name in sorted(names):
        table = metadata.tables.get(name)
        if table is None:
            continue
        count = _tenant_count(connection, table, tenant_id)
        if count is not None:
            result[name] = count
    return result


def build_tenant_first_day_plan(
    connection: Connection,
    *,
    tenant_id: int,
    expected_name: str,
) -> TenantFirstDayPlan:
    if tenant_id <= 0:
        raise RuntimeError("tenant_id deve ser positivo.")

    metadata = _reflect(connection)
    actual_name = _restaurant_name(connection, metadata, tenant_id)
    if actual_name != expected_name.strip():
        raise RuntimeError(
            f"Trava de seguranca: id={tenant_id} e {actual_name!r}, "
            f"nao {expected_name.strip()!r}."
        )

    open_cash = 0
    cash = metadata.tables.get("caixa_turnos")
    if cash is not None and "restaurante_id" in cash.c and "status" in cash.c:
        open_cash = int(
            connection.execute(
                select(func.count()).select_from(cash).where(
                    cash.c.restaurante_id == tenant_id,
                    cash.c.status == "aberto",
                )
            ).scalar_one()
        )

    fiscal_count = 0
    fiscal = metadata.tables.get("fiscal_documents")
    if fiscal is not None:
        fiscal_count = _tenant_count(connection, fiscal, tenant_id) or 0

    return TenantFirstDayPlan(
        tenant_id=tenant_id,
        restaurant_name=actual_name,
        open_cash_shifts=open_cash,
        fiscal_documents=fiscal_count,
        operational_counts=_counts_for(
            connection, metadata, OPERATIONAL_TABLES, tenant_id
        ),
        preserved_counts=_counts_for(
            connection, metadata, PRESERVED_TABLES, tenant_id
        ),
    )


def apply_tenant_first_day_reset(
    engine: Engine,
    *,
    tenant_id: int,
    expected_name: str,
    confirmation: str,
) -> dict[str, Any]:
    # First-day resets cannot distinguish test history from real client data.
    raise RuntimeError("Reset legado desativado. Clientes reais não podem ser resetados.")

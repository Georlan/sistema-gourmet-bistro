"""Read model de relacionamento de clientes derivado de Cliente e Comanda fechada."""

from __future__ import annotations

import datetime
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional, Sequence

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import Cliente, Comanda
from ..timezone_utils import get_utc_now, to_utc
from .clientes import cliente_payload

RELATIONSHIP_ACTIVE_MAX_DAYS = 30
RELATIONSHIP_ATTENTION_MAX_DAYS = 60


@dataclass(frozen=True)
class CustomerRelationshipMetrics:
    pedidos_concluidos: int
    valor_pago_total: float
    ticket_medio_pago: float
    ultima_compra_em: Optional[str]
    dias_sem_comprar: Optional[int]
    segmento_relacionamento: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "pedidos_concluidos": self.pedidos_concluidos,
            "valor_pago_total": self.valor_pago_total,
            "ticket_medio_pago": self.ticket_medio_pago,
            "ultima_compra_em": self.ultima_compra_em,
            "dias_sem_comprar": self.dias_sem_comprar,
            "segmento_relacionamento": self.segmento_relacionamento,
        }


def classify_customer_relationship(dias_sem_comprar: Optional[int]) -> str:
    """Classifica o cliente pelo tempo desde a última compra.

    - SEM_COMPRA: zero compras concluídas (dias_sem_comprar is None)
    - ATIVO: última compra há até 30 dias inclusive
    - ATENCAO: última compra entre 31 e 60 dias inclusive
    - REATIVAR: mais de 60 dias sem comprar
    """
    if dias_sem_comprar is None:
        return "SEM_COMPRA"
    if dias_sem_comprar <= RELATIONSHIP_ACTIVE_MAX_DAYS:
        return "ATIVO"
    if dias_sem_comprar <= RELATIONSHIP_ATTENTION_MAX_DAYS:
        return "ATENCAO"
    return "REATIVAR"


def load_customer_relationship_metrics(
    db: Session,
    *,
    restaurante_id: int,
    cliente_ids: Sequence[str],
    now: Optional[datetime.datetime] = None,
) -> dict[str, CustomerRelationshipMetrics]:
    """Deriva métricas de relacionamento agrupadas por Comanda.cliente_id.

    Garantias:
    - Tenant-scoped: Comanda.restaurante_id == restaurante_id
    - Exclusivamente por Comanda.cliente_id (nunca por telefone, nome ou CPF)
    - Apenas comandas fechadas (Comanda.fechada == True)
    - Consulta agregada única (sem N+1)
    - Tratamento de timestamp SQLite/Postgres naive como UTC
    """
    normalized_ids = [str(cid) for cid in cliente_ids if cid]
    if not normalized_ids:
        return {}

    utc_now = to_utc(now) if now is not None else get_utc_now()

    # Data efetiva da compra: prefere fechado_em; aceita criado_em como fallback legado
    data_efetiva = func.coalesce(Comanda.fechado_em, Comanda.criado_em)

    rows = (
        db.query(
            Comanda.cliente_id,
            func.count(Comanda.id).label("pedidos_concluidos"),
            func.sum(Comanda.valor_pago).label("valor_pago_total"),
            func.max(data_efetiva).label("ultima_compra_em"),
        )
        .filter(
            Comanda.restaurante_id == restaurante_id,
            Comanda.fechada == True,
            Comanda.cliente_id.in_(normalized_ids),
        )
        .group_by(Comanda.cliente_id)
        .all()
    )

    agg_map: dict[str, tuple[int, Decimal, Optional[datetime.datetime]]] = {}
    for r_cid, r_count, r_sum, r_max_dt in rows:
        if r_cid is not None:
            count = int(r_count or 0)
            total = Decimal(str(r_sum or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            agg_map[str(r_cid)] = (count, total, r_max_dt)

    metrics_map: dict[str, CustomerRelationshipMetrics] = {}
    for cid in normalized_ids:
        if cid in agg_map:
            count, total_dec, max_dt = agg_map[cid]
            total_float = float(total_dec)
            ticket_medio = round(total_float / count, 2) if count > 0 else 0.0

            utc_dt = to_utc(max_dt)
            if utc_dt is not None:
                dias = max(0, (utc_now - utc_dt).days)
                dt_iso = utc_dt.isoformat()
            else:
                dias = None
                dt_iso = None

            segmento = classify_customer_relationship(dias)
            metrics_map[cid] = CustomerRelationshipMetrics(
                pedidos_concluidos=count,
                valor_pago_total=total_float,
                ticket_medio_pago=ticket_medio,
                ultima_compra_em=dt_iso,
                dias_sem_comprar=dias,
                segmento_relacionamento=segmento,
            )
        else:
            metrics_map[cid] = CustomerRelationshipMetrics(
                pedidos_concluidos=0,
                valor_pago_total=0.0,
                ticket_medio_pago=0.0,
                ultima_compra_em=None,
                dias_sem_comprar=None,
                segmento_relacionamento=classify_customer_relationship(None),
            )

    return metrics_map


def build_customer_relationship_payloads(
    clientes: Sequence[Cliente],
    metrics_by_client_id: dict[str, CustomerRelationshipMetrics],
) -> list[dict[str, Any]]:
    """Gera payloads canônicos combinando cliente_payload com o read model de relacionamento."""
    payloads: list[dict[str, Any]] = []
    empty_metrics = CustomerRelationshipMetrics(
        pedidos_concluidos=0,
        valor_pago_total=0.0,
        ticket_medio_pago=0.0,
        ultima_compra_em=None,
        dias_sem_comprar=None,
        segmento_relacionamento=classify_customer_relationship(None),
    )
    for cliente in clientes:
        base = cliente_payload(cliente)
        metrics = metrics_by_client_id.get(str(cliente.id), empty_metrics)
        base.update(metrics.to_dict())
        payloads.append(base)
    return payloads

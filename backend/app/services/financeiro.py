from __future__ import annotations

import datetime
from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable, Sequence

from sqlalchemy.orm import Session

from ..financial_models import PagamentoAlocacao, PagamentoEstorno
from ..models import CaixaTurno, Pagamento
from ..operational_models import AtendimentoComanda
from ..timezone_utils import to_operational_local_time


CENT = Decimal("0.01")
CARD_METHODS = {"cartao", "cartao_debito", "cartao_credito"}


def money(value: object) -> Decimal:
    return Decimal(str(value or 0)).quantize(CENT, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class FinancialTotals:
    vendas_brutas: Decimal
    estornos: Decimal
    vendas_liquidas: Decimal
    bruto_por_metodo: dict[str, Decimal]
    estornos_por_metodo: dict[str, Decimal]
    liquido_por_metodo: dict[str, Decimal]


def _normalize_method(method: str | None) -> str:
    raw = (method or "").strip().lower()
    return "cartao" if raw in CARD_METHODS else raw


def atendimento_ids_for_comandas(
    db: Session,
    restaurante_id: int,
    comanda_ids: Iterable[str],
) -> dict[str, str]:
    ids = {str(value) for value in comanda_ids if value}
    if not ids:
        return {}
    rows = (
        db.query(AtendimentoComanda.comanda_id, AtendimentoComanda.atendimento_id)
        .filter(
            AtendimentoComanda.restaurante_id == restaurante_id,
            AtendimentoComanda.comanda_id.in_(ids),
        )
        .all()
    )
    return {str(comanda_id): atendimento_id for comanda_id, atendimento_id in rows}


def registrar_alocacoes_pagamento(
    db: Session,
    pagamento: Pagamento,
    alocacoes: Sequence[tuple[str, object]],
) -> list[PagamentoAlocacao]:
    """Persiste a distribuição exata de um recebimento entre comandas.

    É seguro chamar novamente para um pagamento já materializado: nesse caso as
    alocações existentes são devolvidas sem duplicação.
    """
    existing = (
        db.query(PagamentoAlocacao)
        .filter(
            PagamentoAlocacao.restaurante_id == pagamento.restaurante_id,
            PagamentoAlocacao.pagamento_id == pagamento.id,
        )
        .order_by(PagamentoAlocacao.id)
        .all()
    )
    if existing:
        return existing

    normalized: list[tuple[str, Decimal]] = []
    grouped: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    for comanda_id, raw_value in alocacoes:
        value = money(raw_value)
        if value <= 0:
            continue
        grouped[str(comanda_id)] += value
    normalized = [(comanda_id, money(value)) for comanda_id, value in grouped.items()]

    allocated_total = money(sum((value for _, value in normalized), Decimal("0.00")))
    payment_total = money(pagamento.valor)
    if allocated_total != payment_total:
        raise ValueError(
            "A soma das alocações precisa ser exatamente igual ao valor do pagamento: "
            f"alocado={allocated_total} pagamento={payment_total}."
        )

    attendance_map = atendimento_ids_for_comandas(
        db,
        pagamento.restaurante_id,
        [comanda_id for comanda_id, _ in normalized],
    )
    created: list[PagamentoAlocacao] = []
    for comanda_id, value in normalized:
        allocation = PagamentoAlocacao(
            restaurante_id=pagamento.restaurante_id,
            pagamento_id=pagamento.id,
            comanda_id=comanda_id,
            atendimento_id=attendance_map.get(comanda_id),
            valor=float(value),
            criado_em=pagamento.criado_em or datetime.datetime.now(datetime.timezone.utc),
        )
        db.add(allocation)
        created.append(allocation)
    db.flush()
    return created


def registrar_alocacao_integral(
    db: Session,
    pagamento: Pagamento,
) -> list[PagamentoAlocacao]:
    if not pagamento.comanda_id:
        return []
    return registrar_alocacoes_pagamento(
        db,
        pagamento,
        [(str(pagamento.comanda_id), pagamento.valor)],
    )


def dia_operacional_do_turno(turno: CaixaTurno) -> datetime.date:
    local_open = to_operational_local_time(turno.aberto_em)
    if local_open is None:
        raise ValueError("Turno sem data de abertura não possui dia operacional.")
    return local_open.date()


def _turn_bounds_filter(
    db: Session,
    restaurante_id: int,
    start_utc: datetime.datetime,
    end_utc: datetime.datetime,
) -> list[int]:
    rows = (
        db.query(CaixaTurno.id)
        .filter(
            CaixaTurno.restaurante_id == restaurante_id,
            CaixaTurno.aberto_em >= start_utc,
            CaixaTurno.aberto_em < end_utc,
        )
        .all()
    )
    return [int(row[0]) for row in rows]


def pagamentos_aprovados_por_dia_operacional(
    db: Session,
    restaurante_id: int,
    start_utc: datetime.datetime,
    end_utc: datetime.datetime,
) -> list[Pagamento]:
    """Retorna recebimentos pelo dia em que o turno foi aberto, não pela meia-noite.

    Um pagamento às 00:30 continua no dia anterior se pertence ao turno aberto
    naquele dia, que é a convenção operacional aprovada para o Kôma.
    """
    turn_ids = _turn_bounds_filter(db, restaurante_id, start_utc, end_utc)
    if not turn_ids:
        return []
    return (
        db.query(Pagamento)
        .filter(
            Pagamento.restaurante_id == restaurante_id,
            Pagamento.status == "aprovado",
            Pagamento.turno_id.in_(turn_ids),
        )
        .order_by(Pagamento.criado_em, Pagamento.id)
        .all()
    )


def estornos_por_dia_operacional(
    db: Session,
    restaurante_id: int,
    start_utc: datetime.datetime,
    end_utc: datetime.datetime,
) -> list[PagamentoEstorno]:
    turn_ids = _turn_bounds_filter(db, restaurante_id, start_utc, end_utc)
    if not turn_ids:
        return []
    return (
        db.query(PagamentoEstorno)
        .filter(
            PagamentoEstorno.restaurante_id == restaurante_id,
            PagamentoEstorno.turno_id.in_(turn_ids),
        )
        .order_by(PagamentoEstorno.criado_em, PagamentoEstorno.id)
        .all()
    )


def totais_financeiros(
    pagamentos: Iterable[Pagamento],
    estornos: Iterable[PagamentoEstorno] = (),
) -> FinancialTotals:
    bruto: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    refunds: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))

    gross_total = Decimal("0.00")
    for pagamento in pagamentos:
        value = money(pagamento.valor)
        gross_total += value
        bruto[_normalize_method(pagamento.metodo)] += value

    refund_total = Decimal("0.00")
    for estorno in estornos:
        value = money(estorno.valor)
        refund_total += value
        refunds[_normalize_method(estorno.metodo)] += value

    methods = set(bruto) | set(refunds)
    net = {
        method: money(bruto.get(method, Decimal("0.00")) - refunds.get(method, Decimal("0.00")))
        for method in methods
    }
    return FinancialTotals(
        vendas_brutas=money(gross_total),
        estornos=money(refund_total),
        vendas_liquidas=money(gross_total - refund_total),
        bruto_por_metodo={method: money(value) for method, value in bruto.items()},
        estornos_por_metodo={method: money(value) for method, value in refunds.items()},
        liquido_por_metodo=net,
    )


def total_estornado_pagamento(
    db: Session,
    restaurante_id: int,
    pagamento_id: str,
) -> Decimal:
    rows = db.query(PagamentoEstorno.valor).filter(
        PagamentoEstorno.restaurante_id == restaurante_id,
        PagamentoEstorno.pagamento_id == pagamento_id,
    ).all()
    return money(sum((money(row[0]) for row in rows), Decimal("0.00")))

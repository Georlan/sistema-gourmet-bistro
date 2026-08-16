from __future__ import annotations

import datetime
from collections import defaultdict
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Iterable

from sqlalchemy.orm import Session

from ..financial_models import PagamentoAlocacao, PagamentoEstorno
from ..models import CaixaTurno, Pagamento
from ..operational_models import AtendimentoComanda
from ..timezone_utils import (
    get_operational_now,
    operational_day_bounds_utc,
    to_database_utc,
    to_operational_local_time,
)
from .financeiro import FinancialTotals, money, totais_financeiros


@dataclass(frozen=True)
class FinancialPeriod:
    start_day: datetime.date
    end_day: datetime.date
    start_utc: datetime.datetime
    end_utc: datetime.datetime


@dataclass
class SaleProjection:
    key: str
    atendimento_id: str | None = None
    command_ids: set[str] = field(default_factory=set)
    gross: Decimal = Decimal("0.00")
    methods: set[str] = field(default_factory=set)
    first_paid_at: datetime.datetime | None = None
    last_paid_at: datetime.datetime | None = None
    operational_days: set[datetime.date] = field(default_factory=set)


@dataclass(frozen=True)
class AllocationProjection:
    payment_id: str
    sale_key: str
    atendimento_id: str | None
    command_id: str
    value: Decimal
    paid_at: datetime.datetime | None
    operational_day: datetime.date
    method: str


@dataclass(frozen=True)
class FinancialSnapshot:
    period: FinancialPeriod
    payments: list[Pagamento]
    refunds: list[PagamentoEstorno]
    turn_day_map: dict[int, datetime.date]
    allocations: list[AllocationProjection]
    sales: dict[str, SaleProjection]
    totals: FinancialTotals


def _db_bounds(start_day: datetime.date, end_day: datetime.date) -> tuple[datetime.datetime, datetime.datetime]:
    start_utc, _ = operational_day_bounds_utc(start_day)
    _, end_utc = operational_day_bounds_utc(end_day)
    return to_database_utc(start_utc), to_database_utc(end_utc)


def current_operational_day(db: Session, restaurante_id: int) -> datetime.date:
    """Dia operacional atual.

    Enquanto existir turno aberto, o Kôma considera como "hoje" financeiro o
    dia local em que esse turno foi aberto. Assim uma operação iniciada às 18h
    continua pertencendo ao mesmo dia após 00:00.
    """
    turno = (
        db.query(CaixaTurno)
        .filter(
            CaixaTurno.restaurante_id == restaurante_id,
            CaixaTurno.status == "aberto",
        )
        .order_by(CaixaTurno.aberto_em.desc(), CaixaTurno.id.desc())
        .first()
    )
    if turno and turno.aberto_em:
        local_open = to_operational_local_time(turno.aberto_em)
        if local_open is not None:
            return local_open.date()
    return get_operational_now().date()


def resolve_financial_period(
    db: Session,
    restaurante_id: int,
    data_inicio: str | None,
    data_fim: str | None,
    *,
    default_days: int = 30,
) -> FinancialPeriod:
    end_default = current_operational_day(db, restaurante_id)
    try:
        end_day = datetime.date.fromisoformat(data_fim) if data_fim else end_default
        start_day = (
            datetime.date.fromisoformat(data_inicio)
            if data_inicio
            else end_day - datetime.timedelta(days=default_days)
        )
    except ValueError as exc:
        raise ValueError("Período inválido. Use datas no formato AAAA-MM-DD.") from exc

    if start_day > end_day:
        raise ValueError("A data inicial não pode ser posterior à data final.")
    start_utc, end_utc = _db_bounds(start_day, end_day)
    return FinancialPeriod(start_day, end_day, start_utc, end_utc)


def _turns_in_period(
    db: Session,
    restaurante_id: int,
    period: FinancialPeriod,
) -> list[CaixaTurno]:
    return (
        db.query(CaixaTurno)
        .filter(
            CaixaTurno.restaurante_id == restaurante_id,
            CaixaTurno.aberto_em >= period.start_utc,
            CaixaTurno.aberto_em < period.end_utc,
        )
        .order_by(CaixaTurno.aberto_em, CaixaTurno.id)
        .all()
    )


def _turn_day_map(turns: Iterable[CaixaTurno]) -> dict[int, datetime.date]:
    result: dict[int, datetime.date] = {}
    for turno in turns:
        if turno.aberto_em is None:
            continue
        local_open = to_operational_local_time(turno.aberto_em)
        if local_open is not None:
            result[int(turno.id)] = local_open.date()
    return result


def _payments_for_turns(
    db: Session,
    restaurante_id: int,
    turn_ids: list[int],
) -> list[Pagamento]:
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


def _refunds_for_turns(
    db: Session,
    restaurante_id: int,
    turn_ids: list[int],
) -> list[PagamentoEstorno]:
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


def _fallback_attendance_map(
    db: Session,
    restaurante_id: int,
    command_ids: set[str],
) -> dict[str, str]:
    if not command_ids:
        return {}
    rows = (
        db.query(AtendimentoComanda.comanda_id, AtendimentoComanda.atendimento_id)
        .filter(
            AtendimentoComanda.restaurante_id == restaurante_id,
            AtendimentoComanda.comanda_id.in_(command_ids),
        )
        .all()
    )
    return {str(command_id): str(atendimento_id) for command_id, atendimento_id in rows}


def _allocation_rows(
    db: Session,
    restaurante_id: int,
    payment_ids: list[str],
) -> dict[str, list[PagamentoAlocacao]]:
    result: dict[str, list[PagamentoAlocacao]] = defaultdict(list)
    if not payment_ids:
        return result
    rows = (
        db.query(PagamentoAlocacao)
        .filter(
            PagamentoAlocacao.restaurante_id == restaurante_id,
            PagamentoAlocacao.pagamento_id.in_(payment_ids),
        )
        .order_by(PagamentoAlocacao.pagamento_id, PagamentoAlocacao.id)
        .all()
    )
    for row in rows:
        result[str(row.pagamento_id)].append(row)
    return result


def project_payment_allocations(
    db: Session,
    restaurante_id: int,
    payments: list[Pagamento],
    turn_day_map: dict[int, datetime.date],
) -> list[AllocationProjection]:
    """Projeta pagamentos no grão Conta/Atendimento sem alterar o ledger.

    `PagamentoAlocacao` é a fonte preferencial. Pagamentos históricos sem
    alocação usam AtendimentoComanda da comanda original; fluxos sem Atendimento
    (delivery/balcão/legado) usam a própria comanda como identidade financeira.

    Se um ledger parcial não fechar exatamente com o pagamento, o residual vira
    uma identidade explícita `unattributed:<payment>` em vez de ser perdido ou
    rateado por suposição.
    """
    payment_ids = [str(payment.id) for payment in payments]
    by_payment = _allocation_rows(db, restaurante_id, payment_ids)
    command_ids = {str(payment.comanda_id) for payment in payments if payment.comanda_id}
    fallback_attendance = _fallback_attendance_map(db, restaurante_id, command_ids)

    projections: list[AllocationProjection] = []
    for payment in payments:
        operational_day = turn_day_map.get(int(payment.turno_id))
        if operational_day is None:
            # Um Pagamento obrigatório sem turno legível é anomalia de dados.
            # Não o deslocamos silenciosamente para a data civil do pagamento.
            continue

        rows = by_payment.get(str(payment.id), [])
        allocated = Decimal("0.00")
        for row in rows:
            value = money(row.valor)
            if value <= 0:
                continue
            command_id = str(row.comanda_id)
            atendimento_id = str(row.atendimento_id) if row.atendimento_id else fallback_attendance.get(command_id)
            sale_key = f"atendimento:{atendimento_id}" if atendimento_id else f"comanda:{command_id}"
            projections.append(
                AllocationProjection(
                    payment_id=str(payment.id),
                    sale_key=sale_key,
                    atendimento_id=atendimento_id,
                    command_id=command_id,
                    value=value,
                    paid_at=payment.criado_em,
                    operational_day=operational_day,
                    method=str(payment.metodo or ""),
                )
            )
            allocated += value

        payment_total = money(payment.valor)
        residual = money(payment_total - allocated)
        if not rows:
            command_id = str(payment.comanda_id)
            atendimento_id = fallback_attendance.get(command_id)
            sale_key = f"atendimento:{atendimento_id}" if atendimento_id else f"comanda:{command_id}"
            projections.append(
                AllocationProjection(
                    payment_id=str(payment.id),
                    sale_key=sale_key,
                    atendimento_id=atendimento_id,
                    command_id=command_id,
                    value=payment_total,
                    paid_at=payment.criado_em,
                    operational_day=operational_day,
                    method=str(payment.metodo or ""),
                )
            )
        elif residual != Decimal("0.00"):
            # Nunca inventar para qual Conta pertence um residual inconsistente.
            command_id = str(payment.comanda_id)
            projections.append(
                AllocationProjection(
                    payment_id=str(payment.id),
                    sale_key=f"unattributed:{payment.id}",
                    atendimento_id=None,
                    command_id=command_id,
                    value=residual,
                    paid_at=payment.criado_em,
                    operational_day=operational_day,
                    method=str(payment.metodo or ""),
                )
            )

    return projections


def aggregate_sales(allocations: Iterable[AllocationProjection]) -> dict[str, SaleProjection]:
    sales: dict[str, SaleProjection] = {}
    for allocation in allocations:
        sale = sales.setdefault(
            allocation.sale_key,
            SaleProjection(
                key=allocation.sale_key,
                atendimento_id=allocation.atendimento_id,
            ),
        )
        sale.command_ids.add(allocation.command_id)
        sale.gross = money(sale.gross + allocation.value)
        if allocation.method:
            sale.methods.add(allocation.method)
        sale.operational_days.add(allocation.operational_day)
        if allocation.paid_at is not None:
            if sale.first_paid_at is None or allocation.paid_at < sale.first_paid_at:
                sale.first_paid_at = allocation.paid_at
            if sale.last_paid_at is None or allocation.paid_at > sale.last_paid_at:
                sale.last_paid_at = allocation.paid_at
    return sales


def load_financial_snapshot(
    db: Session,
    restaurante_id: int,
    data_inicio: str | None,
    data_fim: str | None,
    *,
    default_days: int = 30,
) -> FinancialSnapshot:
    period = resolve_financial_period(
        db,
        restaurante_id,
        data_inicio,
        data_fim,
        default_days=default_days,
    )
    turns = _turns_in_period(db, restaurante_id, period)
    turn_day_map = _turn_day_map(turns)
    turn_ids = list(turn_day_map)
    payments = _payments_for_turns(db, restaurante_id, turn_ids)
    refunds = _refunds_for_turns(db, restaurante_id, turn_ids)
    allocations = project_payment_allocations(
        db,
        restaurante_id,
        payments,
        turn_day_map,
    )
    sales = aggregate_sales(allocations)
    totals = totais_financeiros(payments, refunds)
    return FinancialSnapshot(
        period=period,
        payments=payments,
        refunds=refunds,
        turn_day_map=turn_day_map,
        allocations=allocations,
        sales=sales,
        totals=totals,
    )


def daily_financial_rows(snapshot: FinancialSnapshot) -> list[dict[str, object]]:
    gross_by_day: dict[datetime.date, Decimal] = defaultdict(lambda: Decimal("0.00"))
    refunds_by_day: dict[datetime.date, Decimal] = defaultdict(lambda: Decimal("0.00"))
    sale_keys_by_day: dict[datetime.date, set[str]] = defaultdict(set)

    for payment in snapshot.payments:
        day = snapshot.turn_day_map.get(int(payment.turno_id))
        if day is not None:
            gross_by_day[day] += money(payment.valor)
    for refund in snapshot.refunds:
        day = snapshot.turn_day_map.get(int(refund.turno_id))
        if day is not None:
            refunds_by_day[day] += money(refund.valor)
    for allocation in snapshot.allocations:
        sale_keys_by_day[allocation.operational_day].add(allocation.sale_key)

    days_with_activity = set(gross_by_day) | set(refunds_by_day) | set(sale_keys_by_day)
    if not days_with_activity:
        return []
    first_activity = max(snapshot.period.start_day, min(days_with_activity))

    rows: list[dict[str, object]] = []
    day = first_activity
    while day <= snapshot.period.end_day:
        gross = money(gross_by_day.get(day, Decimal("0.00")))
        refunds = money(refunds_by_day.get(day, Decimal("0.00")))
        net = money(gross - refunds)
        rows.append(
            {
                "data": day.isoformat(),
                "bruto": float(gross),
                "estornos": float(refunds),
                "total": float(net),  # compatibilidade: `total` passa a ser líquido
                "quantidade_pedidos": len(sale_keys_by_day.get(day, set())),
            }
        )
        day += datetime.timedelta(days=1)
    return rows


def peak_hour_rows(snapshot: FinancialSnapshot) -> list[dict[str, object]]:
    gross_by_hour: dict[int, Decimal] = defaultdict(lambda: Decimal("0.00"))
    refunds_by_hour: dict[int, Decimal] = defaultdict(lambda: Decimal("0.00"))
    sale_keys_by_hour: dict[int, set[str]] = defaultdict(set)

    for payment in snapshot.payments:
        local = to_operational_local_time(payment.criado_em)
        if local is not None:
            gross_by_hour[local.hour] += money(payment.valor)
    for refund in snapshot.refunds:
        local = to_operational_local_time(refund.criado_em)
        if local is not None:
            refunds_by_hour[local.hour] += money(refund.valor)
    for allocation in snapshot.allocations:
        local = to_operational_local_time(allocation.paid_at)
        if local is not None:
            sale_keys_by_hour[local.hour].add(allocation.sale_key)

    return [
        {
            "hora": f"{hour:02d}h",
            "total_pedidos": len(sale_keys_by_hour.get(hour, set())),
            "bruto": float(money(gross_by_hour.get(hour, Decimal("0.00")))),
            "estornos": float(money(refunds_by_hour.get(hour, Decimal("0.00")))),
            "faturamento": float(
                money(
                    gross_by_hour.get(hour, Decimal("0.00"))
                    - refunds_by_hour.get(hour, Decimal("0.00"))
                )
            ),
        }
        for hour in range(24)
    ]

from __future__ import annotations

import datetime
import uuid
from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable, Sequence

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..financial_models import PagamentoAlocacao, PagamentoEstorno
from ..financial_refund_models import (
    PagamentoEstornoAlocacao,
    PagamentoEstornoLiquidacao,
)
from ..models import CaixaMovimentacao, CaixaTurno, Comanda, Pagamento
from ..operational_models import AtendimentoComanda
from .financeiro import CARD_METHODS, money


ALLOWED_METHODS = {
    "dinheiro",
    "pix",
    "cartao",
    "cartao_debito",
    "cartao_credito",
}


class RefundDomainError(ValueError):
    def __init__(self, message: str, *, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def normalize_method(method: str | None) -> str:
    raw = (method or "").strip().lower()
    return "cartao" if raw in CARD_METHODS else raw


@dataclass(frozen=True)
class CashShiftTotals:
    vendas_brutas: Decimal
    estornos: Decimal
    vendas_liquidas: Decimal
    bruto_dinheiro: Decimal
    bruto_pix: Decimal
    bruto_cartao: Decimal
    estornos_dinheiro: Decimal
    estornos_pix: Decimal
    estornos_cartao: Decimal
    total_dinheiro: Decimal
    total_pix: Decimal
    total_cartao: Decimal
    total_suprimentos: Decimal
    total_sangrias: Decimal
    saldo_esperado_dinheiro: Decimal
    total_pedidos_pagos: int

    def as_legacy_dict(self) -> dict[str, Decimal | int]:
        return {
            "total_vendas": self.vendas_liquidas,
            "vendas_brutas": self.vendas_brutas,
            "total_estornos": self.estornos,
            "vendas_liquidas": self.vendas_liquidas,
            "total_dinheiro": self.total_dinheiro,
            "total_pix": self.total_pix,
            "total_cartao": self.total_cartao,
            "bruto_dinheiro": self.bruto_dinheiro,
            "bruto_pix": self.bruto_pix,
            "bruto_cartao": self.bruto_cartao,
            "estornos_dinheiro": self.estornos_dinheiro,
            "estornos_pix": self.estornos_pix,
            "estornos_cartao": self.estornos_cartao,
            "total_pedidos_pagos": self.total_pedidos_pagos,
            "total_suprimentos": self.total_suprimentos,
            "total_sangrias": self.total_sangrias,
            "saldo_esperado_dinheiro": self.saldo_esperado_dinheiro,
        }


def _refund_method_map(
    db: Session,
    restaurante_id: int,
    refund_ids: Iterable[str],
) -> dict[str, str]:
    ids = [str(value) for value in refund_ids if value]
    if not ids:
        return {}
    rows = db.query(
        PagamentoEstornoLiquidacao.estorno_id,
        PagamentoEstornoLiquidacao.metodo_devolucao,
    ).filter(
        PagamentoEstornoLiquidacao.restaurante_id == restaurante_id,
        PagamentoEstornoLiquidacao.estorno_id.in_(ids),
    ).all()
    return {str(estorno_id): str(method) for estorno_id, method in rows}


def cash_shift_totals(
    db: Session,
    restaurante_id: int,
    turno: CaixaTurno,
) -> CashShiftTotals:
    payments = db.query(Pagamento).filter(
        Pagamento.restaurante_id == restaurante_id,
        Pagamento.turno_id == turno.id,
        Pagamento.status == "aprovado",
    ).all()
    refunds = db.query(PagamentoEstorno).filter(
        PagamentoEstorno.restaurante_id == restaurante_id,
        PagamentoEstorno.turno_id == turno.id,
    ).all()
    refund_methods = _refund_method_map(
        db,
        restaurante_id,
        [refund.id for refund in refunds],
    )

    gross_by_method: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    refund_by_method: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    gross_total = Decimal("0.00")
    refund_total = Decimal("0.00")

    for payment in payments:
        value = money(payment.valor)
        gross_total += value
        gross_by_method[normalize_method(payment.metodo)] += value
    for refund in refunds:
        value = money(refund.valor)
        refund_total += value
        refund_by_method[normalize_method(
            refund_methods.get(str(refund.id), refund.metodo)
        )] += value

    movements = db.query(CaixaMovimentacao).filter(
        CaixaMovimentacao.restaurante_id == restaurante_id,
        CaixaMovimentacao.turno_id == turno.id,
    ).all()
    supplies = money(sum(
        (money(row.valor) for row in movements if row.tipo == "suprimento"),
        Decimal("0.00"),
    ))
    withdrawals = money(sum(
        (money(row.valor) for row in movements if row.tipo == "sangria"),
        Decimal("0.00"),
    ))

    gross_cash = money(gross_by_method.get("dinheiro", 0))
    gross_pix = money(gross_by_method.get("pix", 0))
    gross_card = money(gross_by_method.get("cartao", 0))
    refund_cash = money(refund_by_method.get("dinheiro", 0))
    refund_pix = money(refund_by_method.get("pix", 0))
    refund_card = money(refund_by_method.get("cartao", 0))
    net_cash = money(gross_cash - refund_cash)
    net_pix = money(gross_pix - refund_pix)
    net_card = money(gross_card - refund_card)

    paid_count = int(
        db.query(func.count(func.distinct(Pagamento.comanda_id))).filter(
            Pagamento.restaurante_id == restaurante_id,
            Pagamento.turno_id == turno.id,
            Pagamento.status == "aprovado",
        ).scalar()
        or 0
    )

    return CashShiftTotals(
        vendas_brutas=money(gross_total),
        estornos=money(refund_total),
        vendas_liquidas=money(gross_total - refund_total),
        bruto_dinheiro=gross_cash,
        bruto_pix=gross_pix,
        bruto_cartao=gross_card,
        estornos_dinheiro=refund_cash,
        estornos_pix=refund_pix,
        estornos_cartao=refund_card,
        total_dinheiro=net_cash,
        total_pix=net_pix,
        total_cartao=net_card,
        total_suprimentos=supplies,
        total_sangrias=withdrawals,
        saldo_esperado_dinheiro=money(
            money(turno.saldo_inicial) + net_cash + supplies - withdrawals
        ),
        total_pedidos_pagos=paid_count,
    )


def count_open_commands(db: Session, restaurante_id: int) -> int:
    return int(db.query(func.count(Comanda.id)).filter(
        Comanda.restaurante_id == restaurante_id,
        Comanda.fechada == False,
    ).scalar() or 0)


def remaining_refund_allocations(db: Session, restaurante_id: int, payment: Pagamento) -> list[dict[str, object]]:
    # Lazy import breaks the guard -> transaction service dependency explicitly.
    # Previously the routes package replaced this symbol globally at import time.
    from .refund_guard import remaining_refund_allocations_guarded
    return remaining_refund_allocations_guarded(db, restaurante_id, payment)


def _fallback_attendance(
    db: Session,
    restaurante_id: int,
    command_id: str,
) -> str | None:
    row = db.query(AtendimentoComanda.atendimento_id).filter(
        AtendimentoComanda.restaurante_id == restaurante_id,
        AtendimentoComanda.comanda_id == command_id,
    ).first()
    return str(row[0]) if row and row[0] else None


def base_remaining_refund_allocations(
    db: Session,
    restaurante_id: int,
    payment: Pagamento,
) -> list[dict[str, object]]:
    original = db.query(PagamentoAlocacao).filter(
        PagamentoAlocacao.restaurante_id == restaurante_id,
        PagamentoAlocacao.pagamento_id == payment.id,
    ).order_by(PagamentoAlocacao.id).all()
    refunded_rows = db.query(
        PagamentoEstornoAlocacao.comanda_id,
        PagamentoEstornoAlocacao.valor,
    ).filter(
        PagamentoEstornoAlocacao.restaurante_id == restaurante_id,
        PagamentoEstornoAlocacao.pagamento_id == payment.id,
    ).all()
    refunded: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    for command_id, value in refunded_rows:
        refunded[str(command_id)] += money(value)

    if not original:
        command_id = str(payment.comanda_id or "")
        if not command_id:
            return []
        used = money(refunded.get(command_id, 0))
        return [{
            "pagamento_alocacao_id": None,
            "comanda_id": command_id,
            "atendimento_id": _fallback_attendance(db, restaurante_id, command_id),
            "original": money(payment.valor),
            "estornado": used,
            "disponivel": max(Decimal("0.00"), money(payment.valor) - used),
        }]

    result: list[dict[str, object]] = []
    for allocation in original:
        command_id = str(allocation.comanda_id)
        used = money(refunded.get(command_id, 0))
        original_value = money(allocation.valor)
        result.append({
            "pagamento_alocacao_id": allocation.id,
            "comanda_id": command_id,
            "atendimento_id": (
                str(allocation.atendimento_id)
                if allocation.atendimento_id
                else _fallback_attendance(db, restaurante_id, command_id)
            ),
            "original": original_value,
            "estornado": used,
            "disponivel": max(Decimal("0.00"), original_value - used),
        })
    return result


def _select_allocations(
    available_rows: list[dict[str, object]],
    refund_value: Decimal,
    requested: Sequence[tuple[str, object]] | None,
) -> list[dict[str, object]]:
    positive = [row for row in available_rows if money(row["disponivel"]) > 0]
    total_available = money(sum(
        (money(row["disponivel"]) for row in positive),
        Decimal("0.00"),
    ))
    if refund_value > total_available:
        raise RefundDomainError(
            f"Estorno excede o saldo disponível: R$ {total_available:.2f}.",
            status_code=409,
        )

    requested_map: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    for command_id, raw_value in requested or ():
        value = money(raw_value)
        if value <= 0:
            raise RefundDomainError("Cada parcela do estorno deve ser maior que zero.")
        requested_map[str(command_id)] += value

    if requested_map:
        if money(sum(requested_map.values(), Decimal("0.00"))) != refund_value:
            raise RefundDomainError(
                "A soma das origens deve ser exatamente igual ao valor do estorno."
            )
        by_command = {str(row["comanda_id"]): row for row in positive}
        selected = []
        for command_id, value in requested_map.items():
            row = by_command.get(command_id)
            if row is None:
                raise RefundDomainError(
                    "Uma origem informada não pertence ao pagamento ou já foi integralmente estornada.",
                    status_code=409,
                )
            if value > money(row["disponivel"]):
                raise RefundDomainError(
                    f"A parcela da comanda {command_id} excede seu saldo estornável.",
                    status_code=409,
                )
            selected.append({**row, "valor_estorno": money(value)})
        return selected

    if len(positive) == 1:
        return [{**positive[0], "valor_estorno": refund_value}]
    if refund_value == total_available:
        return [
            {**row, "valor_estorno": money(row["disponivel"])}
            for row in positive
        ]
    raise RefundDomainError(
        "Pagamento dividido entre múltiplas Contas: informe explicitamente a origem de cada parcela do estorno parcial.",
        status_code=409,
    )


def _existing_liquidation(
    db: Session,
    restaurante_id: int,
    refund_id: str,
) -> PagamentoEstornoLiquidacao | None:
    return db.query(PagamentoEstornoLiquidacao).filter(
        PagamentoEstornoLiquidacao.restaurante_id == restaurante_id,
        PagamentoEstornoLiquidacao.estorno_id == refund_id,
    ).first()


def create_refund(
    db: Session,
    *,
    restaurante_id: int,
    payment_id: str,
    turno_id: int,
    usuario_id: str | None,
    valor: object,
    motivo: str,
    idempotency_key: str,
    metodo_devolucao: str | None = None,
    alocacoes: Sequence[tuple[str, object]] | None = None,
) -> PagamentoEstorno:
    refund_value = money(valor)
    reason = (motivo or "").strip()
    key = (idempotency_key or "").strip()
    if refund_value <= 0:
        raise RefundDomainError("O valor do estorno deve ser maior que zero.")
    if len(reason) < 5:
        raise RefundDomainError("Informe uma justificativa com pelo menos 5 caracteres.")
    if len(key) < 8:
        raise RefundDomainError("A idempotency_key deve ter pelo menos 8 caracteres.")

    payment = db.query(Pagamento).with_for_update().filter(
        Pagamento.restaurante_id == restaurante_id,
        Pagamento.id == payment_id,
    ).first()
    if payment is None:
        raise RefundDomainError("Pagamento não encontrado.", status_code=404)
    if payment.status != "aprovado":
        raise RefundDomainError(
            "Somente pagamentos aprovados podem ser estornados.",
            status_code=409,
        )

    payout_method = (metodo_devolucao or payment.metodo or "").strip().lower()
    if payout_method not in ALLOWED_METHODS:
        raise RefundDomainError("Método de devolução inválido.")

    existing = db.query(PagamentoEstorno).filter(
        PagamentoEstorno.restaurante_id == restaurante_id,
        PagamentoEstorno.idempotency_key == key,
    ).first()
    if existing is not None:
        liquidation = _existing_liquidation(db, restaurante_id, existing.id)
        existing_payout = liquidation.metodo_devolucao if liquidation else existing.metodo
        if (
            str(existing.pagamento_id) != str(payment_id)
            or money(existing.valor) != refund_value
            or str(existing.motivo or "").strip() != reason
            or normalize_method(existing_payout) != normalize_method(payout_method)
        ):
            raise RefundDomainError(
                "A idempotency_key já foi usada com outro conteúdo de estorno.",
                status_code=409,
            )
        return existing

    shift = db.query(CaixaTurno).with_for_update().filter(
        CaixaTurno.restaurante_id == restaurante_id,
        CaixaTurno.id == turno_id,
    ).first()
    if shift is None or shift.status != "aberto":
        raise RefundDomainError(
            "O estorno exige um turno de caixa aberto.",
            status_code=409,
        )

    selected = _select_allocations(
        remaining_refund_allocations(db, restaurante_id, payment),
        refund_value,
        alocacoes,
    )

    if normalize_method(payout_method) == "dinheiro":
        available_cash = cash_shift_totals(
            db,
            restaurante_id,
            shift,
        ).saldo_esperado_dinheiro
        if refund_value > available_cash:
            raise RefundDomainError(
                f"Dinheiro insuficiente no caixa para a devolução. Disponível: R$ {available_cash:.2f}.",
                status_code=409,
            )

    now = datetime.datetime.now(datetime.timezone.utc)
    refund = PagamentoEstorno(
        id=str(uuid.uuid4()),
        restaurante_id=restaurante_id,
        pagamento_id=payment.id,
        turno_id=shift.id,
        usuario_id=usuario_id,
        valor=float(refund_value),
        # Mantém o meio ORIGINAL para relatórios de vendas.
        metodo=payment.metodo,
        motivo=reason,
        idempotency_key=key,
        criado_em=now,
    )
    db.add(refund)
    db.flush([refund])
    db.add(PagamentoEstornoLiquidacao(
        restaurante_id=restaurante_id,
        estorno_id=refund.id,
        turno_id=shift.id,
        metodo_devolucao=payout_method,
        criado_em=now,
    ))
    for row in selected:
        db.add(PagamentoEstornoAlocacao(
            restaurante_id=restaurante_id,
            estorno_id=refund.id,
            pagamento_id=payment.id,
            pagamento_alocacao_id=row["pagamento_alocacao_id"],
            comanda_id=str(row["comanda_id"]),
            atendimento_id=(
                str(row["atendimento_id"])
                if row.get("atendimento_id")
                else None
            ),
            valor=float(money(row["valor_estorno"])),
            criado_em=now,
        ))
    db.flush()
    return refund


def refund_payload(
    db: Session,
    restaurante_id: int,
    refund: PagamentoEstorno,
) -> dict[str, object]:
    liquidation = _existing_liquidation(db, restaurante_id, refund.id)
    allocations = db.query(PagamentoEstornoAlocacao).filter(
        PagamentoEstornoAlocacao.restaurante_id == restaurante_id,
        PagamentoEstornoAlocacao.estorno_id == refund.id,
    ).order_by(PagamentoEstornoAlocacao.id).all()
    payment = db.query(Pagamento).filter(
        Pagamento.restaurante_id == restaurante_id,
        Pagamento.id == refund.pagamento_id,
    ).first()
    remaining = Decimal("0.00")
    if payment is not None:
        remaining = money(sum(
            (
                money(row["disponivel"])
                for row in remaining_refund_allocations(
                    db,
                    restaurante_id,
                    payment,
                )
            ),
            Decimal("0.00"),
        ))
    return {
        "id": refund.id,
        "pagamento_id": refund.pagamento_id,
        "turno_id": refund.turno_id,
        "usuario_id": refund.usuario_id,
        "valor": float(money(refund.valor)),
        "metodo_original": refund.metodo,
        "metodo_devolucao": (
            liquidation.metodo_devolucao if liquidation else refund.metodo
        ),
        "motivo": refund.motivo,
        "idempotency_key": refund.idempotency_key,
        "criado_em": refund.criado_em,
        "saldo_estornavel_pagamento": float(remaining),
        "alocacoes": [
            {
                "comanda_id": row.comanda_id,
                "atendimento_id": row.atendimento_id,
                "valor": float(money(row.valor)),
            }
            for row in allocations
        ],
    }

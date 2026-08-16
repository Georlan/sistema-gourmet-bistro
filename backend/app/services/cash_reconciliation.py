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
        # Compatibilidade com caixa.py: os nomes legados passam a representar
        # líquidos do turno. As grandezas brutas/estornos ficam disponíveis em
        # chaves adicionais para as telas novas.
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


def _actual_refund_method_map(
    db: Session,
    restaurante_id: int,
    refund_ids: Iterable[str],
) -> dict[str, str]:
    ids = [str(value) for value in refund_ids if value]
    if not ids:
        return {}
    rows = (
        db.query(
            PagamentoEstornoLiquidacao.estorno_id,
            PagamentoEstornoLiquidacao.metodo_devolucao,
        )
        .filter(
            PagamentoEstornoLiquidacao.restaurante_id == restaurante_id,
            PagamentoEstornoLiquidacao.estorno_id.in_(ids),
        )
        .all()
    )
    return {str(estorno_id): str(method) for estorno_id, method in rows}


def cash_shift_totals(
    db: Session,
    restaurante_id: int,
    turno: CaixaTurno,
) -> CashShiftTotals:
    payments = (
        db.query(Pagamento)
        .filter(
            Pagamento.restaurante_id == restaurante_id,
            Pagamento.turno_id == turno.id,
            Pagamento.status == "aprovado",
        )
        .all()
    )
    refunds = (
        db.query(PagamentoEstorno)
        .filter(
            PagamentoEstorno.restaurante_id == restaurante_id,
            PagamentoEstorno.turno_id == turno.id,
        )
        .all()
    )
    actual_refund_methods = _actual_refund_method_map(
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
        actual_method = actual_refund_methods.get(str(refund.id), refund.metodo)
        refund_by_method[normalize_method(actual_method)] += value

    movements = db.query(
        func.coalesce(
            func.sum(
                func.case(
                    (CaixaMovimentacao.tipo == "suprimento", CaixaMovimentacao.valor),
                    else_=0,
                )
            ),
            0,
        ).label("supplies"),
        func.coalesce(
            func.sum(
                func.case(
                    (CaixaMovimentacao.tipo == "sangria", CaixaMovimentacao.valor),
                    else_=0,
                )
            ),
            0,
        ).label("withdrawals"),
    ).filter(
        CaixaMovimentacao.restaurante_id == restaurante_id,
        CaixaMovimentacao.turno_id == turno.id,
    ).one()

    # `func.case` não é suportado igualmente em todos os dialetos/versões.
    # Se a expressão acima vier sem valor materializado, o fallback abaixo
    # preserva a mesma regra com uma consulta simples e determinística.
    if movements.supplies is None or movements.withdrawals is None:
        rows = (
            db.query(CaixaMovimentacao)
            .filter(
                CaixaMovimentacao.restaurante_id == restaurante_id,
                CaixaMovimentacao.turno_id == turno.id,
            )
            .all()
        )
        supplies = sum(
            (money(row.valor) for row in rows if row.tipo == "suprimento"),
            Decimal("0.00"),
        )
        withdrawals = sum(
            (money(row.valor) for row in rows if row.tipo == "sangria"),
            Decimal("0.00"),
        )
    else:
        supplies = money(movements.supplies)
        withdrawals = money(movements.withdrawals)

    gross_cash = money(gross_by_method.get("dinheiro", Decimal("0.00")))
    gross_pix = money(gross_by_method.get("pix", Decimal("0.00")))
    gross_card = money(gross_by_method.get("cartao", Decimal("0.00")))
    refund_cash = money(refund_by_method.get("dinheiro", Decimal("0.00")))
    refund_pix = money(refund_by_method.get("pix", Decimal("0.00")))
    refund_card = money(refund_by_method.get("cartao", Decimal("0.00")))

    net_cash = money(gross_cash - refund_cash)
    net_pix = money(gross_pix - refund_pix)
    net_card = money(gross_card - refund_card)
    expected_cash = money(
        money(turno.saldo_inicial) + net_cash + money(supplies) - money(withdrawals)
    )

    paid_count = int(
        db.query(func.count(func.distinct(Pagamento.comanda_id)))
        .filter(
            Pagamento.restaurante_id == restaurante_id,
            Pagamento.turno_id == turno.id,
            Pagamento.status == "aprovado",
        )
        .scalar()
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
        total_suprimentos=money(supplies),
        total_sangrias=money(withdrawals),
        saldo_esperado_dinheiro=expected_cash,
        total_pedidos_pagos=paid_count,
    )


def _payment_allocations(
    db: Session,
    restaurante_id: int,
    payment: Pagamento,
) -> list[PagamentoAlocacao]:
    return (
        db.query(PagamentoAlocacao)
        .filter(
            PagamentoAlocacao.restaurante_id == restaurante_id,
            PagamentoAlocacao.pagamento_id == payment.id,
        )
        .order_by(PagamentoAlocacao.id)
        .all()
    )


def _refunded_by_command(
    db: Session,
    restaurante_id: int,
    payment_id: str,
) -> dict[str, Decimal]:
    rows = (
        db.query(
            PagamentoEstornoAlocacao.comanda_id,
            PagamentoEstornoAlocacao.valor,
        )
        .filter(
            PagamentoEstornoAlocacao.restaurante_id == restaurante_id,
            PagamentoEstornoAlocacao.pagamento_id == payment_id,
        )
        .all()
    )
    result: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    for command_id, value in rows:
        result[str(command_id)] += money(value)
    return result


def _fallback_attendance(
    db: Session,
    restaurante_id: int,
    command_id: str,
) -> str | None:
    row = (
        db.query(AtendimentoComanda.atendimento_id)
        .filter(
            AtendimentoComanda.restaurante_id == restaurante_id,
            AtendimentoComanda.comanda_id == command_id,
        )
        .first()
    )
    return str(row[0]) if row and row[0] else None


def remaining_refund_allocations(
    db: Session,
    restaurante_id: int,
    payment: Pagamento,
) -> list[dict[str, object]]:
    allocations = _payment_allocations(db, restaurante_id, payment)
    refunded = _refunded_by_command(db, restaurante_id, str(payment.id))

    if not allocations:
        command_id = str(payment.comanda_id or "")
        if not command_id:
            return []
        remaining = money(payment.valor) - refunded.get(command_id, Decimal("0.00"))
        return [
            {
                "pagamento_alocacao_id": None,
                "comanda_id": command_id,
                "atendimento_id": _fallback_attendance(db, restaurante_id, command_id),
                "original": money(payment.valor),
                "estornado": money(refunded.get(command_id, Decimal("0.00"))),
                "disponivel": max(Decimal("0.00"), money(remaining)),
            }
        ]

    result: list[dict[str, object]] = []
    for allocation in allocations:
        command_id = str(allocation.comanda_id)
        original = money(allocation.valor)
        refunded_value = money(refunded.get(command_id, Decimal("0.00")))
        result.append(
            {
                "pagamento_alocacao_id": allocation.id,
                "comanda_id": command_id,
                "atendimento_id": (
                    str(allocation.atendimento_id)
                    if allocation.atendimento_id
                    else _fallback_attendance(db, restaurante_id, command_id)
                ),
                "original": original,
                "estornado": refunded_value,
                "disponivel": max(
                    Decimal("0.00"),
                    money(original - refunded_value),
                ),
            }
        )
    return result


def _normalize_requested_allocations(
    requested: Sequence[tuple[str, object]] | None,
) -> dict[str, Decimal]:
    grouped: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    for command_id, raw_value in requested or ():
        value = money(raw_value)
        if value <= 0:
            raise RefundDomainError("Cada parcela do estorno deve ser maior que zero.")
        grouped[str(command_id)] += value
    return {key: money(value) for key, value in grouped.items()}


def _select_refund_allocations(
    available_rows: list[dict[str, object]],
    refund_value: Decimal,
    requested: Sequence[tuple[str, object]] | None,
) -> list[dict[str, object]]:
    positive = [row for row in available_rows if money(row["disponivel"]) > 0]
    total_available = money(
        sum((money(row["disponivel"]) for row in positive), Decimal("0.00"))
    )
    if refund_value > total_available:
        raise RefundDomainError(
            "Estorno excede o saldo financeiro disponível do pagamento: "
            f"disponível={total_available} solicitado={refund_value}.",
            status_code=409,
        )

    requested_map = _normalize_requested_allocations(requested)
    if requested_map:
        requested_total = money(sum(requested_map.values(), Decimal("0.00")))
        if requested_total != refund_value:
            raise RefundDomainError(
                "A soma das origens informadas precisa ser exatamente igual ao valor do estorno."
            )
        by_command = {str(row["comanda_id"]): row for row in positive}
        selected = []
        for command_id, value in requested_map.items():
            row = by_command.get(command_id)
            if row is None:
                raise RefundDomainError(
                    "Uma das comandas informadas não pertence ao pagamento ou já foi integralmente estornada."
                )
            if value > money(row["disponivel"]):
                raise RefundDomainError(
                    f"A parcela para a comanda {command_id} excede o saldo estornável dessa origem.",
                    status_code=409,
                )
            selected.append({**row, "valor_estorno": value})
        return selected

    if len(positive) == 1:
        return [{**positive[0], "valor_estorno": refund_value}]

    # Estorno integral do saldo restante é não ambíguo: cada origem é revertida
    # exatamente pelo que ainda possui disponível.
    if refund_value == total_available:
        return [
            {**row, "valor_estorno": money(row["disponivel"])}
            for row in positive
        ]

    raise RefundDomainError(
        "Este pagamento foi distribuído entre múltiplas Contas. Informe explicitamente de qual origem sai cada parcela do estorno parcial.",
        status_code=409,
    )


def validate_existing_idempotency(
    existing: PagamentoEstorno,
    *,
    payment_id: str,
    refund_value: Decimal,
    reason: str,
    payout_method: str,
    liquidation: PagamentoEstornoLiquidacao | None,
) -> None:
    existing_method = (
        liquidation.metodo_devolucao if liquidation is not None else existing.metodo
    )
    if (
        str(existing.pagamento_id) != str(payment_id)
        or money(existing.valor) != money(refund_value)
        or str(existing.motivo or "").strip() != reason
        or normalize_method(existing_method) != normalize_method(payout_method)
    ):
        raise RefundDomainError(
            "A idempotency_key já foi usada com outro conteúdo de estorno.",
            status_code=409,
        )


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
    clean_reason = (motivo or "").strip()
    clean_key = (idempotency_key or "").strip()
    if refund_value <= 0:
        raise RefundDomainError("O valor do estorno deve ser maior que zero.")
    if len(clean_reason) < 5:
        raise RefundDomainError("Informe uma justificativa com pelo menos 5 caracteres.")
    if len(clean_key) < 8:
        raise RefundDomainError("A idempotency_key do estorno deve ter pelo menos 8 caracteres.")

    # O lock do Pagamento serializa estornos concorrentes do mesmo recebimento.
    payment = (
        db.query(Pagamento)
        .with_for_update()
        .filter(
            Pagamento.restaurante_id == restaurante_id,
            Pagamento.id == payment_id,
        )
        .first()
    )
    if payment is None:
        raise RefundDomainError("Pagamento não encontrado.", status_code=404)
    if payment.status != "aprovado":
        raise RefundDomainError(
            "Somente pagamentos aprovados podem ser estornados.",
            status_code=409,
        )

    payout_raw = (metodo_devolucao or payment.metodo or "").strip().lower()
    if payout_raw not in ALLOWED_METHODS:
        raise RefundDomainError("Método de devolução inválido.")

    existing = (
        db.query(PagamentoEstorno)
        .filter(
            PagamentoEstorno.restaurante_id == restaurante_id,
            PagamentoEstorno.idempotency_key == clean_key,
        )
        .first()
    )
    if existing is not None:
        liquidation = (
            db.query(PagamentoEstornoLiquidacao)
            .filter(
                PagamentoEstornoLiquidacao.restaurante_id == restaurante_id,
                PagamentoEstornoLiquidacao.estorno_id == existing.id,
            )
            .first()
        )
        validate_existing_idempotency(
            existing,
            payment_id=payment_id,
            refund_value=refund_value,
            reason=clean_reason,
            payout_method=payout_raw,
            liquidation=liquidation,
        )
        return existing

    # O lock do turno serializa estorno x fechamento: ou o estorno entra antes
    # do fechamento, ou encontra o turno já fechado e falha sem criar saída órfã.
    shift = (
        db.query(CaixaTurno)
        .with_for_update()
        .filter(
            CaixaTurno.restaurante_id == restaurante_id,
            CaixaTurno.id == turno_id,
        )
        .first()
    )
    if shift is None or shift.status != "aberto":
        raise RefundDomainError(
            "O estorno exige um turno de caixa aberto.",
            status_code=409,
        )

    available_rows = remaining_refund_allocations(db, restaurante_id, payment)
    selected = _select_refund_allocations(
        available_rows,
        refund_value,
        alocacoes,
    )

    # Uma devolução em dinheiro realmente retira espécie do caixa atual. Não
    # permitimos criar saldo físico negativo silenciosamente: o operador pode
    # registrar suprimento antes ou escolher o meio efetivamente utilizado.
    if normalize_method(payout_raw) == "dinheiro":
        totals_before = cash_shift_totals(db, restaurante_id, shift)
        if refund_value > totals_before.saldo_esperado_dinheiro:
            raise RefundDomainError(
                "O caixa não possui dinheiro físico suficiente para esta devolução. "
                f"Disponível: R$ {totals_before.saldo_esperado_dinheiro:.2f}.",
                status_code=409,
            )

    refund = PagamentoEstorno(
        id=str(uuid.uuid4()),
        restaurante_id=restaurante_id,
        pagamento_id=payment.id,
        turno_id=shift.id,
        usuario_id=usuario_id,
        valor=float(refund_value),
        # Método original da venda: usado nos relatórios de receita.
        metodo=payment.metodo,
        motivo=clean_reason,
        idempotency_key=clean_key,
        criado_em=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add(refund)
    db.flush([refund])

    db.add(
        PagamentoEstornoLiquidacao(
            restaurante_id=restaurante_id,
            estorno_id=refund.id,
            turno_id=shift.id,
            metodo_devolucao=payout_raw,
            criado_em=refund.criado_em,
        )
    )
    for row in selected:
        db.add(
            PagamentoEstornoAlocacao(
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
                criado_em=refund.criado_em,
            )
        )
    db.flush()
    return refund


def refund_payload(
    db: Session,
    restaurante_id: int,
    refund: PagamentoEstorno,
) -> dict[str, object]:
    liquidation = (
        db.query(PagamentoEstornoLiquidacao)
        .filter(
            PagamentoEstornoLiquidacao.restaurante_id == restaurante_id,
            PagamentoEstornoLiquidacao.estorno_id == refund.id,
        )
        .first()
    )
    allocations = (
        db.query(PagamentoEstornoAlocacao)
        .filter(
            PagamentoEstornoAlocacao.restaurante_id == restaurante_id,
            PagamentoEstornoAlocacao.estorno_id == refund.id,
        )
        .order_by(PagamentoEstornoAlocacao.id)
        .all()
    )
    payment = (
        db.query(Pagamento)
        .filter(
            Pagamento.restaurante_id == restaurante_id,
            Pagamento.id == refund.pagamento_id,
        )
        .first()
    )
    remaining = Decimal("0.00")
    if payment is not None:
        remaining = money(
            sum(
                (
                    money(row["disponivel"])
                    for row in remaining_refund_allocations(
                        db,
                        restaurante_id,
                        payment,
                    )
                ),
                Decimal("0.00"),
            )
        )
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

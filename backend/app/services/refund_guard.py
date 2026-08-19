from __future__ import annotations

from decimal import Decimal
from typing import Sequence

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..financial_models import PagamentoAlocacao, PagamentoEstorno
from ..financial_refund_models import PagamentoEstornoAlocacao
from ..models import Pagamento
from ..smartpos_models import SmartPosPaymentIntent
from .cash_reconciliation import (
    RefundDomainError,
    create_refund,
    remaining_refund_allocations as _base_remaining_refund_allocations,
)
from .financeiro import money


def _historical_refund_state(
    db: Session,
    restaurante_id: int,
    payment_id: str,
) -> tuple[Decimal, Decimal, Decimal, int]:
    """Retorna total estornado, total com origem, residual legado e nº origens."""
    refund_total = money(
        db.query(func.coalesce(func.sum(PagamentoEstorno.valor), 0))
        .filter(
            PagamentoEstorno.restaurante_id == restaurante_id,
            PagamentoEstorno.pagamento_id == payment_id,
        )
        .scalar()
        or 0
    )
    allocated_total = money(
        db.query(func.coalesce(func.sum(PagamentoEstornoAlocacao.valor), 0))
        .filter(
            PagamentoEstornoAlocacao.restaurante_id == restaurante_id,
            PagamentoEstornoAlocacao.pagamento_id == payment_id,
        )
        .scalar()
        or 0
    )
    unattributed = money(refund_total - allocated_total)
    if unattributed < 0:
        raise RefundDomainError(
            "Ledger de estorno inconsistente: as origens somam mais que os eventos de estorno.",
            status_code=409,
        )
    origin_count = int(
        db.query(func.count(PagamentoAlocacao.id))
        .filter(
            PagamentoAlocacao.restaurante_id == restaurante_id,
            PagamentoAlocacao.pagamento_id == payment_id,
        )
        .scalar()
        or 0
    )
    return refund_total, allocated_total, unattributed, max(1, origin_count)


def remaining_refund_allocations_guarded(
    db: Session,
    restaurante_id: int,
    payment: Pagamento,
) -> list[dict[str, object]]:
    """Saldo estornável usado tanto pela UI quanto pela validação transacional."""
    rows = [dict(row) for row in _base_remaining_refund_allocations(
        db,
        restaurante_id,
        payment,
    )]
    refund_total, _, unattributed, origin_count = _historical_refund_state(
        db,
        restaurante_id,
        str(payment.id),
    )

    global_available = money(payment.valor) - refund_total
    if global_available < 0:
        for row in rows:
            row["disponivel"] = Decimal("0.00")
            row["bloqueado"] = True
            row["motivo_bloqueio"] = (
                "Histórico inconsistente: estornos acima do valor original."
            )
        return rows

    if unattributed <= 0:
        return rows

    if origin_count > 1:
        for row in rows:
            row["disponivel"] = Decimal("0.00")
            row["bloqueado"] = True
            row["motivo_bloqueio"] = (
                "Há estorno histórico sem origem entre múltiplas Contas; revisão financeira necessária."
            )
        return rows

    if rows:
        row = rows[0]
        row["estornado"] = money(row.get("estornado", 0)) + unattributed
        row["disponivel"] = max(
            Decimal("0.00"),
            money(row.get("disponivel", 0)) - unattributed,
        )
        row["bloqueado"] = False
        row["motivo_bloqueio"] = None

    visible = money(sum(
        (money(row.get("disponivel", 0)) for row in rows),
        Decimal("0.00"),
    ))
    if visible > global_available and rows:
        excess = money(visible - global_available)
        rows[-1]["disponivel"] = max(
            Decimal("0.00"),
            money(rows[-1].get("disponivel", 0)) - excess,
        )
    return rows


def create_refund_guarded(
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
    """Protege o serviço 3C contra estornos legados sem origem materializada.

    O lock é adquirido ANTES do cálculo do saldo histórico. Retentativas
    idempotentes são reconhecidas antes da regra de saldo: se um estorno de 100%
    já foi persistido e a resposta se perdeu, repetir a mesma chave precisa
    devolver o mesmo evento, não falhar por saldo remanescente igual a zero.
    """
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

    existing = db.query(PagamentoEstorno).filter(
        PagamentoEstorno.restaurante_id == restaurante_id,
        PagamentoEstorno.idempotency_key == (idempotency_key or "").strip(),
    ).first()
    if existing is not None:
        # O serviço central faz a validação estrita de payload drift e devolve
        # o mesmo evento quando a retentativa é realmente idempotente.
        return create_refund(
            db,
            restaurante_id=restaurante_id,
            payment_id=payment_id,
            turno_id=turno_id,
            usuario_id=usuario_id,
            valor=valor,
            motivo=motivo,
            idempotency_key=idempotency_key,
            metodo_devolucao=metodo_devolucao,
            alocacoes=alocacoes,
        )

    smartpos_intent = db.query(SmartPosPaymentIntent).filter(
        SmartPosPaymentIntent.restaurante_id == restaurante_id,
        SmartPosPaymentIntent.pagamento_id == payment_id,
    ).first()
    if smartpos_intent is not None and smartpos_intent.captura == "provider_integrado":
        raise RefundDomainError(
            "Pagamento integrado da maquininha exige estorno confirmado pelo provider; "
            "a reversão física ainda não está habilitada.",
            status_code=409,
        )

    refund_value = money(valor)
    refund_total, _, unattributed, origin_count = _historical_refund_state(
        db,
        restaurante_id,
        payment_id,
    )
    global_available = money(payment.valor) - refund_total
    if global_available < 0:
        raise RefundDomainError(
            "Histórico financeiro inconsistente: o pagamento já possui estornos acima do valor original.",
            status_code=409,
        )
    if refund_value > global_available:
        raise RefundDomainError(
            f"Estorno excede o saldo global disponível do pagamento: R$ {global_available:.2f}.",
            status_code=409,
        )
    if unattributed > 0 and origin_count > 1:
        raise RefundDomainError(
            "Este pagamento possui estorno histórico sem origem entre múltiplas Contas. "
            "A operação foi bloqueada para não inventar a distribuição passada; requer revisão financeira.",
            status_code=409,
        )

    return create_refund(
        db,
        restaurante_id=restaurante_id,
        payment_id=payment_id,
        turno_id=turno_id,
        usuario_id=usuario_id,
        valor=refund_value,
        motivo=motivo,
        idempotency_key=idempotency_key,
        metodo_devolucao=metodo_devolucao,
        alocacoes=alocacoes,
    )

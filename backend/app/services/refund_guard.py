from __future__ import annotations

from decimal import Decimal
from typing import Sequence

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..financial_models import PagamentoAlocacao, PagamentoEstorno
from ..financial_refund_models import PagamentoEstornoAlocacao
from ..models import Pagamento
from .cash_reconciliation import RefundDomainError, create_refund
from .financeiro import money


def _historical_refund_state(
    db: Session,
    restaurante_id: int,
    payment_id: str,
) -> tuple[Decimal, Decimal, Decimal, int]:
    """Retorna total estornado, total com origem, residual legado e nº origens.

    Estornos do checkpoint 3A podem existir sem `PagamentoEstornoAlocacao`.
    Esse residual é seguro quando o pagamento possui uma única origem, mas não
    pode ser atribuído retroativamente por hipótese se havia várias Contas.
    """
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
    # Sem ledger de alocação, payment.comanda_id constitui uma única origem
    # histórica compatível para fins deste guard.
    return refund_total, allocated_total, unattributed, max(1, origin_count)


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

    O lock é adquirido ANTES do cálculo do saldo histórico. Assim dois estornos
    concorrentes não conseguem ambos validar contra o mesmo saldo disponível.
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

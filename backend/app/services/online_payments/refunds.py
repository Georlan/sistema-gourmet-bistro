from __future__ import annotations

import hashlib
import json
import uuid
from decimal import Decimal
from typing import Sequence

import httpx
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...financial_models import PagamentoEstorno
from ...models import OnlinePaymentIntent, Pagamento, RestaurantPaymentAccount
from ...online_payment_refund_models import OnlinePaymentRefund
from ..cash_reconciliation import RefundDomainError, create_refund, money
from .mercado_pago import MercadoPagoError, MercadoPagoProvider


def _fingerprint(
    *,
    payment_id: str,
    amount: Decimal,
    reason: str,
    allocations: Sequence[tuple[str, object]] | None,
) -> str:
    normalized_allocations = sorted(
        (str(command_id), f"{money(value):.2f}")
        for command_id, value in (allocations or ())
    )
    payload = {
        "payment_id": str(payment_id),
        "amount": f"{money(amount):.2f}",
        "reason": (reason or "").strip(),
        "method": "pix",
        "allocations": normalized_allocations,
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _validate_existing_request(
    row: OnlinePaymentRefund,
    *,
    intent: OnlinePaymentIntent,
    payment_id: str,
    amount: Decimal,
    fingerprint: str,
) -> None:
    if (
        str(row.intent_id) != str(intent.id)
        or str(row.pagamento_id) != str(payment_id)
        or money(row.amount) != money(amount)
        or row.request_fingerprint != fingerprint
    ):
        raise RefundDomainError(
            "A idempotency_key já foi usada com outro conteúdo de reembolso online.",
            status_code=409,
        )


def _provider_account(db: Session, restaurante_id: int) -> RestaurantPaymentAccount:
    account = db.query(RestaurantPaymentAccount).filter(
        RestaurantPaymentAccount.restaurante_id == restaurante_id,
        RestaurantPaymentAccount.provider == "mercado_pago",
        RestaurantPaymentAccount.status == "active",
    ).first()
    if account is None or not account.access_token:
        raise RefundDomainError(
            "A conta Mercado Pago do restaurante precisa estar conectada para devolver este Pix.",
            status_code=409,
        )
    return account


def _load_local_refund(
    db: Session,
    *,
    restaurante_id: int,
    row: OnlinePaymentRefund,
) -> PagamentoEstorno | None:
    if not row.estorno_id:
        return None
    refund = db.query(PagamentoEstorno).filter(
        PagamentoEstorno.restaurante_id == restaurante_id,
        PagamentoEstorno.id == row.estorno_id,
    ).first()
    if refund is None:
        raise RefundDomainError(
            "Ledger de reembolso inconsistente: vínculo local não encontrado.",
            status_code=409,
        )
    return refund


def create_mercado_pago_refund(
    db: Session,
    *,
    restaurante_id: int,
    intent: OnlinePaymentIntent,
    payment: Pagamento,
    turno_id: int,
    usuario_id: str | None,
    valor: object,
    motivo: str,
    idempotency_key: str,
    metodo_devolucao: str | None = None,
    alocacoes: Sequence[tuple[str, object]] | None = None,
) -> PagamentoEstorno:
    """Executa um reembolso Mercado Pago sem manter transação durante a rede.

    1. Reserva de forma persistente/idempotente e COMMITA a linha ``requested``.
    2. Chama o Mercado Pago sem lock/transação aberta no banco.
    3. Persiste a confirmação remota.
    4. Só então materializa ``PagamentoEstorno`` local.

    Se a rede ficar em estado incerto, a mesma operação semântica reutiliza a
    mesma chave remota mesmo que a UI gere uma nova chave na retentativa. Se o
    provedor confirmar mas a gravação local falhar, a linha ``confirmed`` permite
    convergência sem chamar o provedor novamente.
    """
    refund_value = money(valor)
    reason = (motivo or "").strip()
    key = (idempotency_key or "").strip()
    requested_method = (metodo_devolucao or "pix").strip().lower()

    if refund_value <= 0:
        raise RefundDomainError("O valor do estorno deve ser maior que zero.")
    if len(reason) < 5:
        raise RefundDomainError("Informe uma justificativa com pelo menos 5 caracteres.")
    if len(key) < 8:
        raise RefundDomainError("A idempotency_key deve ter pelo menos 8 caracteres.")
    if requested_method != "pix":
        raise RefundDomainError(
            "Este pagamento Pix integrado é devolvido pelo próprio Mercado Pago; o método de devolução deve ser Pix.",
            status_code=409,
        )
    if intent.provider != "mercado_pago" or not intent.external_payment_id:
        raise RefundDomainError(
            "Pagamento online sem referência Mercado Pago válida para reembolso.",
            status_code=409,
        )
    if intent.status != "approved" or str(intent.pagamento_id or "") != str(payment.id):
        raise RefundDomainError(
            "Somente um pagamento online aprovado e conciliado pode ser reembolsado.",
            status_code=409,
        )

    request_fingerprint = _fingerprint(
        payment_id=str(payment.id),
        amount=refund_value,
        reason=reason,
        allocations=alocacoes,
    )

    # Primeiro honramos a chave exata. Se a UI gerar outra chave após timeout,
    # uma reserva ainda sem estorno local com o MESMO fingerprint representa a
    # mesma operação incerta e deve reutilizar a chave remota, não criar refund 2.
    row = db.query(OnlinePaymentRefund).filter(
        OnlinePaymentRefund.restaurante_id == restaurante_id,
        OnlinePaymentRefund.idempotency_key == key,
    ).first()
    if row is None:
        row = db.query(OnlinePaymentRefund).filter(
            OnlinePaymentRefund.restaurante_id == restaurante_id,
            OnlinePaymentRefund.pagamento_id == payment.id,
            OnlinePaymentRefund.request_fingerprint == request_fingerprint,
            OnlinePaymentRefund.status.in_(("requested", "confirmed")),
            OnlinePaymentRefund.estorno_id.is_(None),
        ).order_by(OnlinePaymentRefund.created_at.asc()).first()

    if row is not None:
        _validate_existing_request(
            row,
            intent=intent,
            payment_id=str(payment.id),
            amount=refund_value,
            fingerprint=request_fingerprint,
        )
        local = _load_local_refund(db, restaurante_id=restaurante_id, row=row)
        if local is not None:
            return local
        if row.status == "failed":
            raise RefundDomainError(
                "A tentativa anterior foi recusada pelo Mercado Pago. Corrija a causa e inicie um novo estorno.",
                status_code=409,
            )
    else:
        local_refunded = money(
            db.query(func.coalesce(func.sum(PagamentoEstorno.valor), 0))
            .filter(
                PagamentoEstorno.restaurante_id == restaurante_id,
                PagamentoEstorno.pagamento_id == payment.id,
            )
            .scalar()
            or 0
        )
        remote_reserved = money(
            db.query(func.coalesce(func.sum(OnlinePaymentRefund.amount), 0))
            .filter(
                OnlinePaymentRefund.restaurante_id == restaurante_id,
                OnlinePaymentRefund.pagamento_id == payment.id,
                OnlinePaymentRefund.status.in_(("requested", "confirmed")),
                OnlinePaymentRefund.estorno_id.is_(None),
            )
            .scalar()
            or 0
        )
        available = money(payment.valor) - local_refunded - remote_reserved
        if available < 0:
            raise RefundDomainError(
                "Ledger de reembolso online inconsistente: reservas excedem o pagamento original.",
                status_code=409,
            )
        if refund_value > available:
            raise RefundDomainError(
                f"Estorno excede o saldo global disponível do pagamento: R$ {available:.2f}.",
                status_code=409,
            )

        row_id = str(uuid.uuid4())
        row = OnlinePaymentRefund(
            id=row_id,
            restaurante_id=restaurante_id,
            intent_id=intent.id,
            pagamento_id=payment.id,
            provider="mercado_pago",
            external_payment_id=str(intent.external_payment_id),
            amount=float(refund_value),
            status="requested",
            idempotency_key=key,
            provider_idempotency_key=f"koma-refund-{row_id}",
            request_fingerprint=request_fingerprint,
        )
        db.add(row)

    # Snapshot de tudo que a chamada remota precisa enquanto a transação ainda
    # está aberta. Depois do commit abaixo não há SELECT antes do HTTP.
    provider_call = row.status == "requested"
    access_token: str | None = None
    original_amount = money(payment.valor)
    external_payment_id = str(row.external_payment_id)
    provider_key = str(row.provider_idempotency_key)
    provider_amount = None if refund_value == original_amount else refund_value
    if provider_call:
        access_token = _provider_account(db, restaurante_id).access_token

    try:
        # Commit também libera o FOR UPDATE adquirido pelo refund_guard. A chamada
        # HTTP acontece somente depois deste ponto e sem transação aberta.
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        concurrent = db.query(OnlinePaymentRefund).filter(
            OnlinePaymentRefund.restaurante_id == restaurante_id,
            OnlinePaymentRefund.idempotency_key == key,
        ).first()
        if concurrent is None:
            concurrent = db.query(OnlinePaymentRefund).filter(
                OnlinePaymentRefund.restaurante_id == restaurante_id,
                OnlinePaymentRefund.pagamento_id == payment.id,
                OnlinePaymentRefund.request_fingerprint == request_fingerprint,
                OnlinePaymentRefund.status.in_(("requested", "confirmed")),
                OnlinePaymentRefund.estorno_id.is_(None),
            ).order_by(OnlinePaymentRefund.created_at.asc()).first()
        if concurrent is None:
            raise RefundDomainError(
                "Conflito concorrente ao reservar o reembolso online. Tente novamente.",
                status_code=409,
            ) from exc
        _validate_existing_request(
            concurrent,
            intent=intent,
            payment_id=str(payment.id),
            amount=refund_value,
            fingerprint=request_fingerprint,
        )
        # Reinicia pelo registro vencedor. Não chamamos o provider nessa pilha
        # para evitar corrida; a retentativa do cliente converge imediatamente.
        raise RefundDomainError(
            "O reembolso já foi reservado por outra tentativa. Repita a operação para reconciliar.",
            status_code=503,
        ) from exc

    if provider_call:
        assert access_token is not None
        try:
            provider_refund = MercadoPagoProvider(access_token).refund_payment(
                external_payment_id,
                amount=provider_amount,
                idempotency_key=provider_key,
            )
        except (httpx.TimeoutException, httpx.RequestError) as exc:
            persisted = db.query(OnlinePaymentRefund).filter(
                OnlinePaymentRefund.restaurante_id == restaurante_id,
                OnlinePaymentRefund.id == row.id,
            ).first()
            if persisted is not None:
                persisted.status = "requested"
                persisted.error_message = "Comunicação com o Mercado Pago ficou em estado incerto."
                db.commit()
            raise RefundDomainError(
                "Não foi possível confirmar o reembolso no Mercado Pago. Repita a operação; a reserva idempotente impede devolução duplicada.",
                status_code=503,
            ) from exc
        except MercadoPagoError as exc:
            persisted = db.query(OnlinePaymentRefund).filter(
                OnlinePaymentRefund.restaurante_id == restaurante_id,
                OnlinePaymentRefund.id == row.id,
            ).first()
            if persisted is not None:
                persisted.status = "requested" if exc.retryable else "failed"
                persisted.error_message = str(exc)[:1000]
                db.commit()
            if exc.retryable:
                raise RefundDomainError(
                    "O Mercado Pago ainda não confirmou a devolução. Repita a operação para reconciliar sem duplicar o reembolso.",
                    status_code=503,
                ) from exc
            raise RefundDomainError(
                "O Mercado Pago recusou a devolução. Verifique o saldo/estado da conta do restaurante antes de tentar novamente.",
                status_code=409,
            ) from exc

        if money(provider_refund.amount) != refund_value:
            persisted = db.query(OnlinePaymentRefund).filter(
                OnlinePaymentRefund.restaurante_id == restaurante_id,
                OnlinePaymentRefund.id == row.id,
            ).first()
            if persisted is not None:
                persisted.status = "requested"
                persisted.external_refund_id = provider_refund.external_id
                persisted.provider_status = provider_refund.status
                persisted.error_message = "Valor retornado pelo provedor diverge da solicitação."
                db.commit()
            raise RefundDomainError(
                "Mercado Pago devolveu um valor divergente; o estorno local foi bloqueado para reconciliação.",
                status_code=502,
            )

        provider_status = (provider_refund.status or "").strip().lower()
        persisted = db.query(OnlinePaymentRefund).filter(
            OnlinePaymentRefund.restaurante_id == restaurante_id,
            OnlinePaymentRefund.id == row.id,
        ).with_for_update().one()
        persisted.external_refund_id = provider_refund.external_id
        persisted.provider_status = provider_refund.status
        persisted.error_message = None
        if provider_status == "approved":
            persisted.status = "confirmed"
        elif provider_status in {"rejected", "cancelled", "failed"}:
            persisted.status = "failed"
        else:
            persisted.status = "requested"
        db.commit()
        row = persisted

        if provider_status in {"rejected", "cancelled", "failed"}:
            raise RefundDomainError(
                "O Mercado Pago não aprovou a devolução; nenhum estorno local foi lançado.",
                status_code=409,
            )
        if provider_status != "approved":
            raise RefundDomainError(
                "O reembolso está em processamento no Mercado Pago. Repita a operação para reconciliar o resultado.",
                status_code=503,
            )

    # A confirmação remota já foi persistida. Daqui em diante não há nova
    # chamada externa; uma falha local pode ser corrigida repetindo a operação.
    row = db.query(OnlinePaymentRefund).filter(
        OnlinePaymentRefund.restaurante_id == restaurante_id,
        OnlinePaymentRefund.id == row.id,
    ).with_for_update().one()
    if row.status != "confirmed":
        raise RefundDomainError(
            "Reembolso externo ainda não confirmado.",
            status_code=503,
        )
    local = _load_local_refund(db, restaurante_id=restaurante_id, row=row)
    if local is not None:
        return local

    # Use a chave da reserva original mesmo quando a UI trouxe uma nova chave na
    # retentativa semântica; assim provider e ledger local convergem na mesma op.
    ledger_key = str(row.idempotency_key)
    try:
        refund = create_refund(
            db,
            restaurante_id=restaurante_id,
            payment_id=str(payment.id),
            turno_id=turno_id,
            usuario_id=usuario_id,
            valor=refund_value,
            motivo=reason,
            idempotency_key=ledger_key,
            metodo_devolucao="pix",
            alocacoes=alocacoes,
        )
        row.estorno_id = refund.id
        row.error_message = None
        db.flush()
        return refund
    except RefundDomainError as exc:
        db.rollback()
        raise RefundDomainError(
            "O Mercado Pago já confirmou a devolução, mas o lançamento local ficou pendente. "
            f"Repita a mesma operação para reconciliar. Detalhe: {exc}",
            status_code=503,
        ) from exc

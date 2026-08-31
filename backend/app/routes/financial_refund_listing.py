from __future__ import annotations

from fastapi import Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db, require_tenant_id
from ..models import Pagamento, Usuario
from ..smartpos_models import SmartPosPaymentIntent
from ..security import require_permission
from ..services.refund_ui import refundable_payment_payload_human


def find_refundable_payments(
    db: Session,
    restaurante_id: int,
    *,
    limite: int,
    batch_size: int = 100,
) -> list[dict[str, object]]:
    """Busca pós-filtro sem esconder pagamentos antigos ainda estornáveis.

    Filtrar `saldo_estornavel` só depois de um LIMIT fixo é incorreto: uma faixa
    recente totalmente devolvida pode empurrar para fora da janela pagamentos
    antigos que ainda precisam de estorno. O scanner avança em lotes até encher
    o limite solicitado ou realmente esgotar o histórico aprovado.
    """
    limit = max(1, min(int(limite), 100))
    batch = max(1, min(int(batch_size), 250))
    offset = 0
    result: list[dict[str, object]] = []

    while len(result) < limit:
        payments = (
            db.query(Pagamento)
            .filter(
                Pagamento.restaurante_id == restaurante_id,
                Pagamento.status == "aprovado",
            )
            .order_by(Pagamento.criado_em.desc(), Pagamento.id.desc())
            .offset(offset)
            .limit(batch)
            .all()
        )
        if not payments:
            break

        integrated_payment_ids = {
            str(row[0])
            for row in db.query(SmartPosPaymentIntent.pagamento_id).filter(
                SmartPosPaymentIntent.restaurante_id == restaurante_id,
                SmartPosPaymentIntent.pagamento_id.in_([payment.id for payment in payments]),
                SmartPosPaymentIntent.captura == "provider_integrado",
            ).all()
            if row[0]
        }

        for payment in payments:
            if str(payment.id) in integrated_payment_ids:
                continue
            payload = refundable_payment_payload_human(
                db,
                restaurante_id,
                payment,
            )
            if float(payload["saldo_estornavel"] or 0) > 0:
                result.append(payload)
                if len(result) >= limit:
                    break

        offset += len(payments)
        if len(payments) < batch:
            break

    return result


def listar_pagamentos_estornaveis_paginado(
    limite: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("caixa:operar")),
):
    return find_refundable_payments(
        db,
        require_tenant_id(),
        limite=limite,
    )

from __future__ import annotations

import datetime
from typing import Optional

from sqlalchemy import and_
from sqlalchemy.orm import Session

from ..financial_models import PagamentoEstorno
from ..financial_refund_models import PagamentoEstornoLiquidacao
from ..models import CaixaMovimentacao, CaixaTurno, Comanda, Pagamento, Usuario
from ..timezone_utils import to_utc


def recent_cash_activities(
    db: Session,
    restaurante_id: int,
    turno: CaixaTurno,
    limite: int = 10,
) -> tuple[list[dict], Optional[dict]]:
    """Feed único de recebimentos, devoluções e movimentos manuais do turno."""
    limit = max(1, min(limite, 20))

    payments = db.query(Pagamento, Comanda).join(
        Comanda,
        and_(
            Pagamento.restaurante_id == Comanda.restaurante_id,
            Pagamento.comanda_id == Comanda.id,
        ),
    ).filter(
        Pagamento.restaurante_id == restaurante_id,
        Pagamento.turno_id == turno.id,
        Pagamento.status == "aprovado",
    ).order_by(Pagamento.criado_em.desc(), Pagamento.id.desc()).limit(limit).all()

    refunds = db.query(
        PagamentoEstorno,
        Pagamento,
        Comanda,
        PagamentoEstornoLiquidacao,
        Usuario,
    ).join(
        Pagamento,
        and_(
            PagamentoEstorno.restaurante_id == Pagamento.restaurante_id,
            PagamentoEstorno.pagamento_id == Pagamento.id,
        ),
    ).join(
        Comanda,
        and_(
            Pagamento.restaurante_id == Comanda.restaurante_id,
            Pagamento.comanda_id == Comanda.id,
        ),
    ).outerjoin(
        PagamentoEstornoLiquidacao,
        and_(
            PagamentoEstornoLiquidacao.restaurante_id == PagamentoEstorno.restaurante_id,
            PagamentoEstornoLiquidacao.estorno_id == PagamentoEstorno.id,
        ),
    ).outerjoin(
        Usuario,
        and_(
            PagamentoEstorno.usuario_id == Usuario.id,
            PagamentoEstorno.restaurante_id == Usuario.restaurante_id,
        ),
    ).filter(
        PagamentoEstorno.restaurante_id == restaurante_id,
        PagamentoEstorno.turno_id == turno.id,
    ).order_by(PagamentoEstorno.criado_em.desc(), PagamentoEstorno.id.desc()).limit(limit).all()

    movements = db.query(CaixaMovimentacao, Usuario).outerjoin(
        Usuario,
        and_(
            CaixaMovimentacao.usuario_id == Usuario.id,
            CaixaMovimentacao.restaurante_id == Usuario.restaurante_id,
        ),
    ).filter(
        CaixaMovimentacao.restaurante_id == restaurante_id,
        CaixaMovimentacao.turno_id == turno.id,
    ).order_by(CaixaMovimentacao.criado_em.desc(), CaixaMovimentacao.id.desc()).limit(limit).all()

    def origin(command: Comanda) -> str:
        command_type = (command.tipo or "").strip().lower()
        if command.mesa_id:
            return f"Mesa {command.mesa_id}"
        if "retirada" in command_type:
            return f"Retirada #{command.numero_pedido}"
        if command_type in {"entrega", "delivery"}:
            return f"Delivery #{command.numero_pedido}"
        return f"Pedido #{command.numero_pedido}"

    activities: list[dict] = []
    for payment, command in payments:
        activities.append({
            "id": f"pagamento:{payment.id}",
            "tipo": "recebimento",
            "valor": payment.valor,
            "metodo": payment.metodo,
            "origem": origin(command),
            "descricao": "Venda recebida",
            "operador_nome": None,
            "criado_em": payment.criado_em,
        })

    for refund, _payment, command, liquidation, user in refunds:
        activities.append({
            "id": f"estorno:{refund.id}",
            "tipo": "estorno",
            "valor": refund.valor,
            "metodo": (
                liquidation.metodo_devolucao
                if liquidation is not None
                else refund.metodo
            ),
            "origem": origin(command),
            "descricao": refund.motivo or "Estorno de recebimento",
            "operador_nome": user.nome if user else None,
            "criado_em": refund.criado_em,
        })

    for movement, user in movements:
        activities.append({
            "id": f"movimentacao:{movement.id}",
            "tipo": movement.tipo,
            "valor": movement.valor,
            "metodo": "dinheiro",
            "origem": "Caixa",
            "descricao": movement.descricao or movement.observacao or "Movimentação manual",
            "operador_nome": user.nome if user else None,
            "criado_em": movement.criado_em,
        })

    def timestamp_utc(activity: dict) -> float:
        created = activity.get("criado_em")
        if not created:
            return 0.0
        if isinstance(created, (int, float)):
            return float(created)
        if isinstance(created, datetime.datetime):
            normalized = to_utc(created)
            return normalized.timestamp() if normalized else 0.0
        if isinstance(created, str):
            try:
                dt = datetime.datetime.fromisoformat(created.replace("Z", "+00:00"))
                normalized = to_utc(dt)
                return normalized.timestamp() if normalized else 0.0
            except Exception:
                return 0.0
        return 0.0

    activities.sort(key=timestamp_utc, reverse=True)
    last_manual = next(
        (
            activity
            for activity in activities
            if activity["tipo"] in {"suprimento", "sangria"}
        ),
        None,
    )
    return activities[:limit], last_manual

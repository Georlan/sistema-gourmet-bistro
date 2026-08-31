from __future__ import annotations

import datetime
from decimal import Decimal
from typing import Optional

from fastapi import BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db, require_tenant_id
from ..financial_models import PagamentoEstorno
from ..models import CaixaTurno, Pagamento, Usuario
from ..security import require_permission
from ..services.cash_reconciliation import (
    RefundDomainError,
    cash_shift_totals,
    count_open_commands,
    money,
    refund_payload,
)
from ..services.refund_guard import create_refund_guarded as create_refund
from ..services.refund_ui import refundable_payment_payload_human as _refundable_payment_payload
from .websocket import manager


class RefundAllocationInput(BaseModel):
    comanda_id: str = Field(min_length=1)
    valor: Decimal = Field(gt=0)


class RefundRequest(BaseModel):
    valor: Decimal = Field(gt=0)
    motivo: str = Field(min_length=5, max_length=500)
    idempotency_key: str = Field(min_length=8, max_length=128)
    metodo_devolucao: Optional[str] = None
    alocacoes: list[RefundAllocationInput] = Field(default_factory=list)

    @field_validator("metodo_devolucao")
    @classmethod
    def normalize_method(cls, value: Optional[str]) -> Optional[str]:
        return value.strip().lower() if value else None


class ReconciledCloseRequest(BaseModel):
    declarado_dinheiro: Decimal
    declarado_cartao: Decimal = Decimal("0.00")
    declarado_pix: Decimal = Decimal("0.00")
    observacao: str = ""

    @field_validator("declarado_dinheiro")
    @classmethod
    def cash_cannot_be_negative(cls, value: Decimal) -> Decimal:
        if money(value) < 0:
            raise ValueError("O dinheiro físico declarado não pode ser negativo.")
        return money(value)

    @field_validator("declarado_cartao", "declarado_pix")
    @classmethod
    def quantize_digital(cls, value: Decimal) -> Decimal:
        # Liquidação digital líquida pode ser negativa quando o turno apenas
        # processa devoluções de vendas de turnos anteriores.
        return money(value)


def _open_shift(db: Session, restaurante_id: int) -> CaixaTurno | None:
    return db.query(CaixaTurno).filter(
        CaixaTurno.restaurante_id == restaurante_id,
        CaixaTurno.status == "aberto",
    ).order_by(CaixaTurno.id.desc()).first()


def obter_pagamento_estornavel(
    pagamento_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("caixa:operar")),
):
    """Carrega um único recebimento para abertura imediata da devolução contextual."""
    rest_id = require_tenant_id()
    payment = db.query(Pagamento).filter(
        Pagamento.restaurante_id == rest_id,
        Pagamento.id == pagamento_id,
        Pagamento.status == "aprovado",
    ).first()
    if payment is None:
        raise HTTPException(status_code=404, detail="Pagamento não encontrado.")
    payload = _refundable_payment_payload(db, rest_id, payment)
    if payload["saldo_estornavel"] <= 0:
        raise HTTPException(status_code=409, detail="Este pagamento não possui valor disponível para devolução.")
    return payload


def listar_estornos_pagamento(
    pagamento_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("caixa:operar")),
):
    rest_id = require_tenant_id()
    payment = db.query(Pagamento).filter(
        Pagamento.restaurante_id == rest_id,
        Pagamento.id == pagamento_id,
    ).first()
    if payment is None:
        raise HTTPException(status_code=404, detail="Pagamento não encontrado.")
    refunds = db.query(PagamentoEstorno).filter(
        PagamentoEstorno.restaurante_id == rest_id,
        PagamentoEstorno.pagamento_id == pagamento_id,
    ).order_by(PagamentoEstorno.criado_em, PagamentoEstorno.id).all()
    return [refund_payload(db, rest_id, refund) for refund in refunds]


def estornar_pagamento(
    pagamento_id: str,
    req: RefundRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("caixa:operar")),
):
    rest_id = require_tenant_id()
    shift = _open_shift(db, rest_id)
    if shift is None:
        raise HTTPException(
            status_code=409,
            detail="Abra um turno de caixa antes de registrar uma devolução.",
        )
    try:
        refund = create_refund(
            db,
            restaurante_id=rest_id,
            payment_id=pagamento_id,
            turno_id=shift.id,
            usuario_id=current_user.id,
            valor=req.valor,
            motivo=req.motivo,
            idempotency_key=req.idempotency_key,
            metodo_devolucao=req.metodo_devolucao,
            alocacoes=[
                (allocation.comanda_id, allocation.valor)
                for allocation in req.alocacoes
            ],
        )
        db.commit()
    except RefundDomainError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except IntegrityError as exc:
        db.rollback()
        existing = db.query(PagamentoEstorno).filter(
            PagamentoEstorno.restaurante_id == rest_id,
            PagamentoEstorno.idempotency_key == req.idempotency_key,
        ).first()
        if existing is not None and str(existing.pagamento_id) == str(pagamento_id):
            return refund_payload(db, rest_id, existing)
        raise HTTPException(
            status_code=409,
            detail="Conflito concorrente ao registrar o estorno. Atualize o caixa e tente novamente.",
        ) from exc

    db.refresh(refund)
    payload = refund_payload(db, rest_id, refund)
    background_tasks.add_task(
        manager.broadcast,
        {
            "event": "cash_updated",
            "detail": {
                "type": "estorno_registrado",
                "pagamento_id": pagamento_id,
                "estorno_id": refund.id,
                "valor": payload["valor"],
                "metodo_devolucao": payload["metodo_devolucao"],
            },
        },
        rest_id,
    )
    return payload


def obter_reconciliacao_turno(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("caixa:operar")),
):
    rest_id = require_tenant_id()
    shift = _open_shift(db, rest_id)
    if shift is None:
        return {
            "status": "sem_turno",
            "turno_id": None,
            "vendas_brutas": 0.0,
            "estornos": 0.0,
            "vendas_liquidas": 0.0,
            "bruto_dinheiro": 0.0,
            "bruto_pix": 0.0,
            "bruto_cartao": 0.0,
            "estornos_dinheiro": 0.0,
            "estornos_pix": 0.0,
            "estornos_cartao": 0.0,
            "liquido_dinheiro": 0.0,
            "liquido_pix": 0.0,
            "liquido_cartao": 0.0,
            "saldo_esperado_dinheiro": 0.0,
            "total_suprimentos": 0.0,
            "total_sangrias": 0.0,
        }
    totals = cash_shift_totals(db, rest_id, shift)
    return {
        "status": shift.status,
        "turno_id": shift.id,
        "vendas_brutas": float(totals.vendas_brutas),
        "estornos": float(totals.estornos),
        "vendas_liquidas": float(totals.vendas_liquidas),
        "bruto_dinheiro": float(totals.bruto_dinheiro),
        "bruto_pix": float(totals.bruto_pix),
        "bruto_cartao": float(totals.bruto_cartao),
        "estornos_dinheiro": float(totals.estornos_dinheiro),
        "estornos_pix": float(totals.estornos_pix),
        "estornos_cartao": float(totals.estornos_cartao),
        "liquido_dinheiro": float(totals.total_dinheiro),
        "liquido_pix": float(totals.total_pix),
        "liquido_cartao": float(totals.total_cartao),
        "saldo_esperado_dinheiro": float(totals.saldo_esperado_dinheiro),
        "total_suprimentos": float(totals.total_suprimentos),
        "total_sangrias": float(totals.total_sangrias),
    }


def fechar_turno_reconciliado(
    req: ReconciledCloseRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("caixa:operar")),
):
    rest_id = require_tenant_id()
    shift = db.query(CaixaTurno).with_for_update().filter(
        CaixaTurno.restaurante_id == rest_id,
        CaixaTurno.status == "aberto",
    ).first()
    if shift is None:
        raise HTTPException(status_code=400, detail="Não há turno aberto para fechamento.")

    pending = int(db.query(Pagamento).filter(
        Pagamento.restaurante_id == rest_id,
        Pagamento.turno_id == shift.id,
        Pagamento.status == "pendente",
    ).count())
    open_commands = count_open_commands(db, rest_id)
    if pending or open_commands:
        parts = []
        if pending:
            parts.append(f"{pending} pagamento(s) aguardando confirmação")
        if open_commands:
            parts.append(f"{open_commands} comanda(s) ainda aberta(s)")
        raise HTTPException(
            status_code=409,
            detail="Resolva as pendências antes de fechar o caixa: " + " e ".join(parts) + ".",
        )

    totals = cash_shift_totals(db, rest_id, shift)
    declared_cash = money(req.declarado_dinheiro)
    declared_card = money(req.declarado_cartao)
    declared_pix = money(req.declarado_pix)
    expected_cash = totals.saldo_esperado_dinheiro
    expected_card = totals.total_cartao
    expected_pix = totals.total_pix
    diff_cash = money(declared_cash - expected_cash)
    diff_card = money(declared_card - expected_card)
    diff_pix = money(declared_pix - expected_pix)
    total_declared = money(declared_cash + declared_card + declared_pix)
    total_expected = money(expected_cash + expected_card + expected_pix)
    diff_total = money(total_declared - total_expected)

    divergent = any(
        abs(value) >= Decimal("0.01")
        for value in (diff_cash, diff_card, diff_pix, diff_total)
    )
    observation = (req.observacao or "").strip()
    if divergent and not observation:
        raise HTTPException(
            status_code=400,
            detail=(
                "Diferença de caixa identificada. É obrigatório informar o motivo "
                "na observação para auditoria gerencial."
            ),
        )

    closed_at = datetime.datetime.now(datetime.timezone.utc)
    shift.fechado_em = closed_at
    shift.fechado_por_id = current_user.id
    shift.declarado_dinheiro = float(declared_cash)
    shift.declarado_cartao = float(declared_card)
    shift.declarado_pix = float(declared_pix)
    shift.observacao = observation or None
    shift.status = "fechado"
    db.commit()

    background_tasks.add_task(
        manager.broadcast,
        {"event": "cash_updated", "detail": {"type": "turno_fechado"}},
        rest_id,
    )
    return {
        "turno_id": shift.id,
        "status": "fechado",
        "fechado_em": closed_at,
        "fechado_por_nome": current_user.nome,
        "declarado_dinheiro": float(declared_cash),
        "esperado_dinheiro": float(expected_cash),
        "diferenca_dinheiro": float(diff_cash),
        "declarado_cartao": float(declared_card),
        "esperado_cartao": float(expected_card),
        "diferenca_cartao": float(diff_card),
        "declarado_pix": float(declared_pix),
        "esperado_pix": float(expected_pix),
        "diferenca_pix": float(diff_pix),
        "total_declarado": float(total_declared),
        "total_esperado": float(total_expected),
        "diferenca_total": float(diff_total),
        "vendas_brutas": float(totals.vendas_brutas),
        "estornos": float(totals.estornos),
        "vendas_liquidas": float(totals.vendas_liquidas),
        "estornos_dinheiro": float(totals.estornos_dinheiro),
        "estornos_pix": float(totals.estornos_pix),
        "estornos_cartao": float(totals.estornos_cartao),
        "total_suprimentos": float(totals.total_suprimentos),
        "total_sangrias": float(totals.total_sangrias),
    }

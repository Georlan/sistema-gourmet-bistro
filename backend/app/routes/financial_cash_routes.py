from __future__ import annotations

import datetime
from decimal import Decimal
from typing import Optional

from fastapi import BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db, require_tenant_id
from ..financial_models import PagamentoEstorno
from ..models import CaixaTurno, Comanda, Pagamento, Usuario
from ..security import require_permission
from ..services.cash_reconciliation import (
    RefundDomainError,
    cash_shift_totals,
    create_refund,
    money,
    refund_payload,
    remaining_refund_allocations,
)
from . import caixa as legacy_cash
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


def _remove_route(full_path: str, method: str) -> None:
    method = method.upper()
    legacy_cash.router.routes[:] = [
        route
        for route in legacy_cash.router.routes
        if not (
            getattr(route, "path", None) == full_path
            and method in (getattr(route, "methods", set()) or set())
        )
    ]


def _turn_totals_adapter(
    db: Session,
    restaurante_id: int,
    turno: CaixaTurno,
) -> dict[str, Decimal | int]:
    return cash_shift_totals(db, restaurante_id, turno).as_legacy_dict()


# Sangria, suprimento, resumo, turno atual e fechamento legados consultam este
# símbolo em runtime. Substituir uma única fonte evita fórmulas paralelas.
legacy_cash._totais_financeiros_turno = _turn_totals_adapter


def _open_shift(db: Session, restaurante_id: int) -> CaixaTurno | None:
    return db.query(CaixaTurno).filter(
        CaixaTurno.restaurante_id == restaurante_id,
        CaixaTurno.status == "aberto",
    ).order_by(CaixaTurno.id.desc()).first()


def _payment_origin_label(command: Comanda | None) -> str:
    if command is None:
        return "Pagamento"
    tipo = str(command.tipo or "").lower().strip()
    if command.mesa_id:
        return f"Mesa {command.mesa_id}"
    if "retirada" in tipo:
        return f"Retirada #{command.numero_pedido}"
    if tipo in {"delivery", "entrega"}:
        return f"Delivery #{command.numero_pedido}"
    return f"Pedido #{command.numero_pedido}"


def _refundable_payment_payload(
    db: Session,
    restaurante_id: int,
    payment: Pagamento,
) -> dict[str, object]:
    origins = remaining_refund_allocations(db, restaurante_id, payment)
    available = money(sum(
        (money(row["disponivel"]) for row in origins),
        Decimal("0.00"),
    ))
    command = db.query(Comanda).filter(
        Comanda.restaurante_id == restaurante_id,
        Comanda.id == payment.comanda_id,
    ).first()
    return {
        "id": payment.id,
        "comanda_id": payment.comanda_id,
        "turno_id": payment.turno_id,
        "valor_original": float(money(payment.valor)),
        "saldo_estornavel": float(available),
        "metodo_original": payment.metodo,
        "status": payment.status,
        "criado_em": payment.criado_em,
        "origem": _payment_origin_label(command),
        "numero_pedido": getattr(command, "numero_pedido", None) if command else None,
        "mesa_id": getattr(command, "mesa_id", None) if command else None,
        "origens_financeiras": [
            {
                "comanda_id": row["comanda_id"],
                "atendimento_id": row["atendimento_id"],
                "valor_original": float(money(row["original"])),
                "valor_estornado": float(money(row["estornado"])),
                "saldo_estornavel": float(money(row["disponivel"])),
            }
            for row in origins
        ],
    }


@legacy_cash.router.get("/pagamentos/estornaveis")
def listar_pagamentos_estornaveis(
    limite: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("caixa:operar")),
):
    rest_id = require_tenant_id()
    payments = db.query(Pagamento).filter(
        Pagamento.restaurante_id == rest_id,
        Pagamento.status == "aprovado",
    ).order_by(Pagamento.criado_em.desc(), Pagamento.id.desc()).limit(limite * 2).all()
    result = []
    for payment in payments:
        payload = _refundable_payment_payload(db, rest_id, payment)
        if payload["saldo_estornavel"] > 0:
            result.append(payload)
        if len(result) >= limite:
            break
    return result


@legacy_cash.router.get("/pagamentos/{pagamento_id}/estornos")
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


@legacy_cash.router.post("/pagamentos/{pagamento_id}/estornar", status_code=201)
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


@legacy_cash.router.get("/turno-atual/reconciliacao")
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
    open_commands = legacy_cash._comandas_abertas_count(db, rest_id)
    if pending or open_commands:
        parts = []
        if pending:
            parts.append(f"{pending} pagamento(s) aguardando confirmação")
        if open_commands:
            parts.append(f"{open_commands} comanda(s) aberta(s)")
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
            detail="Diferença identificada. Informe uma observação para auditoria.",
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


# O fechamento precisa aceitar líquido digital negativo e usar estornos pelo
# método de devolução. As duas URLs históricas continuam válidas.
_remove_route("/caixa/fechamento", "POST")
_remove_route("/caixa/turno/fechar", "POST")
legacy_cash.router.add_api_route(
    "/fechamento",
    fechar_turno_reconciliado,
    methods=["POST"],
    name="fechar_turno_reconciliado",
)
legacy_cash.router.add_api_route(
    "/turno/fechar",
    fechar_turno_reconciliado,
    methods=["POST"],
    name="fechar_turno_reconciliado_alias",
)

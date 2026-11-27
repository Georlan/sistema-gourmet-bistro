"""Rotas do Núcleo Financeiro do Restaurante, DRE Gerencial e Fluxo de Caixa (B8 — Frentes 1 e 2)."""

from __future__ import annotations

import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from ..b8_finance_models import (
    ContaPagar,
    ContaReceber,
    FinanceCategoria,
    FinanceConta,
    FinanceRecorrencia,
)
from ..database import get_db, require_tenant_id
from ..models import Usuario
from ..security import require_entitled_permission
from ..services.b8_finance import (
    baixar_conta_receber,
    baixar_parcela_conta_pagar,
    cancelar_conta_pagar,
    cancelar_conta_receber,
    create_conta_pagar,
    create_conta_receber,
    ensure_default_finance_setup,
    gerar_competencia_recorrencias,
    registrar_movimentacao_manual,
    serialize_conta_pagar,
    serialize_conta_receber,
)
from ..services.b8_reports import build_dre_gerencial, build_fluxo_caixa
from ..services.plan_entitlements import ENTITLEMENT_ADVANCED_REPORTS

router = APIRouter(prefix="/b8/financeiro", tags=["B8 Financeiro Gerencial"])


def _require_fin_read(
    current_user: Usuario = Depends(
        require_entitled_permission(
            "financeiro:consultar",
            ENTITLEMENT_ADVANCED_REPORTS,
            detail="Gestão financeira gerencial não está disponível no plano atual.",
        )
    ),
) -> Usuario:
    return current_user


def _require_fin_write(
    current_user: Usuario = Depends(
        require_entitled_permission(
            "financeiro:administrar",
            ENTITLEMENT_ADVANCED_REPORTS,
            detail="Gestão financeira gerencial não está disponível no plano atual.",
        )
    ),
) -> Usuario:
    return current_user


class CategoriaCreate(BaseModel):
    nome: str = Field(..., min_length=2, max_length=120)
    tipo: str = Field(default="despesa_variavel")


class ContaFinanceiraCreate(BaseModel):
    nome: str = Field(..., min_length=2, max_length=120)
    tipo: str = Field(default="conta_bancaria")
    saldo_inicial: float = 0.0
    data_saldo_inicial: Optional[datetime.date] = None


class ContaPagarCreate(BaseModel):
    categoria_id: str
    favorecido_nome: str = Field(..., min_length=1, max_length=180)
    descricao: str = Field(..., min_length=1, max_length=240)
    valor_original: float = Field(..., gt=0)
    data_emissao: datetime.date
    data_competencia: datetime.date
    primeiro_vencimento: datetime.date
    total_parcelas: int = Field(default=1, ge=1, le=60)
    distribuidor_id: Optional[str] = None
    numero_documento: Optional[str] = None
    observacao: str = ""


class BaixaPagarRequest(BaseModel):
    conta_financeira_id: str
    valor_principal: float = Field(..., gt=0)
    data_pagamento: datetime.date
    idempotency_key: str = Field(..., min_length=1, max_length=128)
    juros: float = Field(default=0.0, ge=0)
    desconto: float = Field(default=0.0, ge=0)
    ajuste: float = 0.0
    forma_pagamento: str = "pix"
    observacao: str = ""


class CancelamentoRequest(BaseModel):
    motivo: str = Field(..., min_length=3, max_length=240)


class ContaReceberCreate(BaseModel):
    categoria_id: str
    contraparte_nome: str = Field(..., min_length=1, max_length=180)
    descricao: str = Field(..., min_length=1, max_length=240)
    valor_previsto: float = Field(..., gt=0)
    data_competencia: datetime.date
    data_vencimento: datetime.date
    origem_tipo: str = "manual"
    tipo_confirmacao: str = "previsto"
    observacao: str = ""


class BaixaReceberRequest(BaseModel):
    conta_financeira_id: str
    valor_recebido: float = Field(..., gt=0)
    data_recebimento: datetime.date
    idempotency_key: str = Field(..., min_length=1, max_length=128)
    taxa_descontada: float = Field(default=0.0, ge=0)
    forma_recebimento: str = "pix"
    observacao: str = ""


class RecorrenciaCreate(BaseModel):
    categoria_id: str
    favorecido_nome: str = Field(..., min_length=1, max_length=180)
    descricao: str = Field(..., min_length=1, max_length=240)
    valor_previsto: float = Field(..., gt=0)
    dia_vencimento: int = Field(default=10, ge=1, le=31)
    periodicidade: str = "mensal"
    distribuidor_id: Optional[str] = None


class MovimentacaoCreate(BaseModel):
    conta_financeira_id: str
    tipo: str
    valor: float = Field(..., gt=0)
    data_movimento: datetime.date
    descricao: str = Field(..., min_length=1, max_length=240)
    categoria_id: Optional[str] = None
    conta_destino_id: Optional[str] = None


def _serialize_finance_setup(cats: list[FinanceCategoria], accounts: list[FinanceConta]) -> dict:
    return {
        "categorias": [
            {"id": c.id, "codigo": c.codigo, "nome": c.nome, "tipo": c.tipo, "sistema": c.sistema}
            for c in sorted(cats, key=lambda x: x.nome)
            if c.ativo
        ],
        "contas": [
            {
                "id": a.id,
                "nome": a.nome,
                "tipo": a.tipo,
                "saldo_inicial": float(a.saldo_inicial),
                "padrao": a.padrao,
            }
            for a in accounts
            if a.ativo
        ],
    }


@router.get("/setup")
def get_finance_setup(
    db: Session = Depends(get_db),
    _user: Usuario = Depends(_require_fin_read),
):
    """Consulta categorias e contas financeiras existentes sem criar registros."""
    rest_id = require_tenant_id()
    cats = (
        db.query(FinanceCategoria)
        .filter(FinanceCategoria.restaurante_id == rest_id, FinanceCategoria.ativo.is_(True))
        .all()
    )
    accounts = (
        db.query(FinanceConta)
        .filter(FinanceConta.restaurante_id == rest_id, FinanceConta.ativo.is_(True))
        .order_by(FinanceConta.nome.asc())
        .all()
    )
    return _serialize_finance_setup(cats, accounts)


@router.post("/setup/inicializar")
def inicializar_finance_setup(
    db: Session = Depends(get_db),
    _user: Usuario = Depends(_require_fin_write),
):
    """Provisiona plano de contas e contas financeiras padrão (operação explícita de escrita)."""
    rest_id = require_tenant_id()
    cats, accounts = ensure_default_finance_setup(db, rest_id)
    db.commit()
    return _serialize_finance_setup(cats, accounts)


@router.post("/categorias", status_code=status.HTTP_201_CREATED)
def criar_categoria(
    payload: CategoriaCreate,
    db: Session = Depends(get_db),
    _user: Usuario = Depends(_require_fin_write),
):
    rest_id = require_tenant_id()
    import re
    codigo = re.sub(r"[^a-z0-9]+", "_", payload.nome.strip().lower()).strip("_")[:48] or "custom"
    cat = FinanceCategoria(
        restaurante_id=rest_id,
        codigo=f"{codigo}_{rest_id}_{len(payload.nome)}",
        nome=payload.nome.strip(),
        tipo=payload.tipo,
        sistema=False,
        ativo=True,
    )
    db.add(cat)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Não foi possível criar a categoria financeira.") from exc
    return {"id": cat.id, "codigo": cat.codigo, "nome": cat.nome, "tipo": cat.tipo, "sistema": cat.sistema}


@router.post("/contas", status_code=status.HTTP_201_CREATED)
def criar_conta_financeira(
    payload: ContaFinanceiraCreate,
    db: Session = Depends(get_db),
    _user: Usuario = Depends(_require_fin_write),
):
    rest_id = require_tenant_id()
    conta = FinanceConta(
        restaurante_id=rest_id,
        nome=payload.nome.strip(),
        tipo=payload.tipo,
        saldo_inicial=payload.saldo_inicial,
        data_saldo_inicial=payload.data_saldo_inicial,
        padrao=False,
        ativo=True,
    )
    db.add(conta)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Não foi possível criar a conta financeira.") from exc
    return {
        "id": conta.id,
        "nome": conta.nome,
        "tipo": conta.tipo,
        "saldo_inicial": float(conta.saldo_inicial),
        "padrao": conta.padrao,
    }


@router.get("/contas-pagar")
def listar_contas_pagar(
    status_filter: Optional[str] = Query(None, alias="status"),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    _user: Usuario = Depends(_require_fin_read),
):
    rest_id = require_tenant_id()
    q = (
        db.query(ContaPagar)
        .options(joinedload(ContaPagar.categoria), joinedload(ContaPagar.parcelas))
        .filter(ContaPagar.restaurante_id == rest_id)
    )
    if status_filter and status_filter != "vencido":
        q = q.filter(ContaPagar.status == status_filter)
    rows = q.order_by(ContaPagar.data_competencia.desc(), ContaPagar.created_at.desc()).limit(limit).all()
    serialized = [serialize_conta_pagar(row) for row in rows]
    if status_filter == "vencido":
        serialized = [item for item in serialized if item["status"] == "vencido"]
    return serialized


@router.post("/contas-pagar", status_code=status.HTTP_201_CREATED)
def criar_cp(
    payload: ContaPagarCreate,
    db: Session = Depends(get_db),
    user: Usuario = Depends(_require_fin_write),
):
    rest_id = require_tenant_id()
    ensure_default_finance_setup(db, rest_id)
    try:
        cp = create_conta_pagar(
            db,
            restaurante_id=rest_id,
            categoria_id=payload.categoria_id,
            favorecido_nome=payload.favorecido_nome,
            descricao=payload.descricao,
            valor_original=payload.valor_original,
            data_emissao=payload.data_emissao,
            data_competencia=payload.data_competencia,
            primeiro_vencimento=payload.primeiro_vencimento,
            total_parcelas=payload.total_parcelas,
            distribuidor_id=payload.distribuidor_id,
            numero_documento=payload.numero_documento,
            observacao=payload.observacao,
            criado_por_id=user.id,
        )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    cp_full = (
        db.query(ContaPagar)
        .options(joinedload(ContaPagar.categoria), joinedload(ContaPagar.parcelas))
        .filter(ContaPagar.restaurante_id == rest_id, ContaPagar.id == cp.id)
        .one()
    )
    return serialize_conta_pagar(cp_full)


@router.post("/contas-pagar/parcelas/{parcela_id}/baixar")
def baixar_cp_parcela(
    parcela_id: str,
    payload: BaixaPagarRequest,
    db: Session = Depends(get_db),
    user: Usuario = Depends(_require_fin_write),
):
    rest_id = require_tenant_id()
    try:
        baixa, replay = baixar_parcela_conta_pagar(
            db,
            restaurante_id=rest_id,
            parcela_id=parcela_id,
            conta_financeira_id=payload.conta_financeira_id,
            valor_principal=payload.valor_principal,
            data_pagamento=payload.data_pagamento,
            idempotency_key=payload.idempotency_key,
            juros=payload.juros,
            desconto=payload.desconto,
            ajuste=payload.ajuste,
            forma_pagamento=payload.forma_pagamento,
            observacao=payload.observacao,
            usuario_id=user.id,
        )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"id": baixa.id, "parcela_id": baixa.parcela_id, "valor_pago": float(baixa.valor_pago), "replay": replay}


@router.post("/contas-pagar/{conta_pagar_id}/cancelar")
def cancelar_cp(
    conta_pagar_id: str,
    payload: CancelamentoRequest,
    db: Session = Depends(get_db),
    user: Usuario = Depends(_require_fin_write),
):
    rest_id = require_tenant_id()
    try:
        cp = cancelar_conta_pagar(
            db,
            restaurante_id=rest_id,
            conta_pagar_id=conta_pagar_id,
            motivo=payload.motivo,
            usuario_id=user.id,
        )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"id": cp.id, "status": cp.status}


@router.get("/contas-receber")
def listar_contas_receber(
    status_filter: Optional[str] = Query(None, alias="status"),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    _user: Usuario = Depends(_require_fin_read),
):
    rest_id = require_tenant_id()
    q = (
        db.query(ContaReceber)
        .options(joinedload(ContaReceber.categoria))
        .filter(ContaReceber.restaurante_id == rest_id)
    )
    if status_filter and status_filter != "vencido":
        q = q.filter(ContaReceber.status == status_filter)
    rows = q.order_by(ContaReceber.data_vencimento.asc()).limit(limit).all()
    serialized = [serialize_conta_receber(row) for row in rows]
    if status_filter == "vencido":
        serialized = [item for item in serialized if item["status"] == "vencido"]
    return serialized


@router.post("/contas-receber", status_code=status.HTTP_201_CREATED)
def criar_cr(
    payload: ContaReceberCreate,
    db: Session = Depends(get_db),
    user: Usuario = Depends(_require_fin_write),
):
    rest_id = require_tenant_id()
    ensure_default_finance_setup(db, rest_id)
    try:
        cr = create_conta_receber(
            db,
            restaurante_id=rest_id,
            categoria_id=payload.categoria_id,
            contraparte_nome=payload.contraparte_nome,
            descricao=payload.descricao,
            valor_previsto=payload.valor_previsto,
            data_competencia=payload.data_competencia,
            data_vencimento=payload.data_vencimento,
            origem_tipo=payload.origem_tipo,
            tipo_confirmacao=payload.tipo_confirmacao,
            observacao=payload.observacao,
            criado_por_id=user.id,
        )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    cr_full = (
        db.query(ContaReceber)
        .options(joinedload(ContaReceber.categoria))
        .filter(ContaReceber.restaurante_id == rest_id, ContaReceber.id == cr.id)
        .one()
    )
    return serialize_conta_receber(cr_full)


@router.post("/contas-receber/{conta_receber_id}/baixar")
def baixar_cr(
    conta_receber_id: str,
    payload: BaixaReceberRequest,
    db: Session = Depends(get_db),
    user: Usuario = Depends(_require_fin_write),
):
    rest_id = require_tenant_id()
    try:
        baixa, replay = baixar_conta_receber(
            db,
            restaurante_id=rest_id,
            conta_receber_id=conta_receber_id,
            conta_financeira_id=payload.conta_financeira_id,
            valor_recebido=payload.valor_recebido,
            data_recebimento=payload.data_recebimento,
            idempotency_key=payload.idempotency_key,
            taxa_descontada=payload.taxa_descontada,
            forma_recebimento=payload.forma_recebimento,
            observacao=payload.observacao,
            usuario_id=user.id,
        )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"id": baixa.id, "conta_receber_id": baixa.conta_receber_id, "valor_recebido": float(baixa.valor_recebido), "replay": replay}


@router.post("/contas-receber/{conta_receber_id}/cancelar")
def cancelar_cr(
    conta_receber_id: str,
    payload: CancelamentoRequest,
    db: Session = Depends(get_db),
    user: Usuario = Depends(_require_fin_write),
):
    rest_id = require_tenant_id()
    try:
        cr = cancelar_conta_receber(
            db,
            restaurante_id=rest_id,
            conta_receber_id=conta_receber_id,
            motivo=payload.motivo,
            usuario_id=user.id,
        )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"id": cr.id, "status": cr.status}


@router.get("/recorrencias")
def listar_recorrencias(
    db: Session = Depends(get_db),
    _user: Usuario = Depends(_require_fin_read),
):
    rest_id = require_tenant_id()
    rows = db.query(FinanceRecorrencia).filter(FinanceRecorrencia.restaurante_id == rest_id).all()
    return [
        {
            "id": r.id,
            "categoria_id": r.categoria_id,
            "favorecido_nome": r.favorecido_nome,
            "descricao": r.descricao,
            "valor_previsto": float(r.valor_previsto),
            "dia_vencimento": r.dia_vencimento,
            "periodicidade": r.periodicidade,
            "ativa": r.ativa,
            "ultima_competencia_gerada": r.ultima_competencia_gerada,
        }
        for r in rows
    ]


@router.post("/recorrencias", status_code=status.HTTP_201_CREATED)
def criar_recorrencia(
    payload: RecorrenciaCreate,
    db: Session = Depends(get_db),
    _user: Usuario = Depends(_require_fin_write),
):
    rest_id = require_tenant_id()
    rec = FinanceRecorrencia(
        restaurante_id=rest_id,
        categoria_id=payload.categoria_id,
        distribuidor_id=payload.distribuidor_id,
        favorecido_nome=payload.favorecido_nome.strip(),
        descricao=payload.descricao.strip(),
        valor_previsto=payload.valor_previsto,
        dia_vencimento=payload.dia_vencimento,
        periodicidade=payload.periodicidade,
        ativa=True,
    )
    db.add(rec)
    db.commit()
    return {"id": rec.id, "descricao": rec.descricao, "valor_previsto": float(rec.valor_previsto)}


@router.post("/recorrencias/gerar")
def gerar_recorrencias(
    competencia: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
    db: Session = Depends(get_db),
    user: Usuario = Depends(_require_fin_write),
):
    rest_id = require_tenant_id()
    geradas = gerar_competencia_recorrencias(
        db,
        restaurante_id=rest_id,
        competencia=competencia,
        usuario_id=user.id,
    )
    db.commit()
    return {"competencia": competencia, "geradas_count": len(geradas), "ids": [c.id for c in geradas]}


@router.get("/movimentacoes")
def listar_movimentacoes(
    conta_financeira_id: Optional[str] = None,
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _user: Usuario = Depends(_require_fin_read),
):
    from ..b8_finance_models import FinanceMovimentacao

    rest_id = require_tenant_id()
    q = db.query(FinanceMovimentacao).filter(FinanceMovimentacao.restaurante_id == rest_id)
    if conta_financeira_id:
        q = q.filter(FinanceMovimentacao.conta_financeira_id == conta_financeira_id)
    rows = q.order_by(FinanceMovimentacao.data_movimento.desc(), FinanceMovimentacao.created_at.desc()).limit(limit).all()
    return [
        {
            "id": m.id,
            "conta_financeira_id": m.conta_financeira_id,
            "categoria_id": m.categoria_id,
            "tipo": m.tipo,
            "origem_tipo": m.origem_tipo,
            "data_movimento": m.data_movimento.isoformat(),
            "valor": float(m.valor),
            "descricao": m.descricao,
        }
        for m in rows
    ]


@router.post("/movimentacoes", status_code=status.HTTP_201_CREATED)
def criar_movimentacao(
    payload: MovimentacaoCreate,
    db: Session = Depends(get_db),
    user: Usuario = Depends(_require_fin_write),
):
    rest_id = require_tenant_id()
    try:
        movs = registrar_movimentacao_manual(
            db,
            restaurante_id=rest_id,
            conta_financeira_id=payload.conta_financeira_id,
            tipo=payload.tipo,
            valor=payload.valor,
            data_movimento=payload.data_movimento,
            descricao=payload.descricao,
            categoria_id=payload.categoria_id,
            conta_destino_id=payload.conta_destino_id,
            usuario_id=user.id,
        )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return [{"id": m.id, "tipo": m.tipo, "valor": float(m.valor)} for m in movs]


@router.get("/dre")
def obter_dre_gerencial(
    data_inicio: Optional[str] = None,
    data_fim: Optional[str] = None,
    db: Session = Depends(get_db),
    _user: Usuario = Depends(_require_fin_read),
):
    rest_id = require_tenant_id()
    try:
        return build_dre_gerencial(db, restaurante_id=rest_id, data_inicio=data_inicio, data_fim=data_fim)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/fluxo-caixa")
def obter_fluxo_caixa(
    data_inicio: Optional[str] = None,
    data_fim: Optional[str] = None,
    conta_financeira_id: Optional[str] = None,
    db: Session = Depends(get_db),
    _user: Usuario = Depends(_require_fin_read),
):
    rest_id = require_tenant_id()
    try:
        return build_fluxo_caixa(
            db,
            restaurante_id=rest_id,
            data_inicio=data_inicio,
            data_fim=data_fim,
            conta_financeira_id=conta_financeira_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

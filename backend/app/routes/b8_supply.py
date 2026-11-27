"""Rotas de Fichas Técnicas Universais, Custos Históricos, Compras, Lotes FEFO e Produção (B8 — Frentes 3, 4 e 5)."""

from __future__ import annotations

import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from ..b8_supply_models import (
    FichaTecnicaComponente,
    LoteEstoque,
    OrdemProducao,
    PedidoCompra,
    RegistroBuffetLote,
    SubReceita,
)
from ..database import get_db, require_tenant_id
from ..models import GrupoModificador, Insumo, MovimentacaoEstoque, OpcaoModificador, Produto, ProdutoInsumo, Usuario
from ..security import require_entitled_permission
from ..services.b8_supply import (
    calcular_custo_sub_receita,
    confirmar_importacao_xml_revisada,
    create_or_update_sub_receita,
    criar_pedido_compra,
    executar_ordem_producao,
    preview_xml_nfe,
    receber_pedido_compra,
    registrar_buffet_lote,
    registrar_perda_detalhada,
    upsert_ficha_tecnica_universal,
)
from ..services.plan_entitlements import ENTITLEMENT_INVENTORY

router = APIRouter(prefix="/b8/supply", tags=["B8 Custos, Compras e Produção"])


def _require_supply_read(
    current_user: Usuario = Depends(
        require_entitled_permission(
            "estoque:consultar",
            ENTITLEMENT_INVENTORY,
            detail="Estoque avançado, custos e produção não estão disponíveis no plano atual.",
        )
    ),
) -> Usuario:
    return current_user


def _require_supply_write(
    current_user: Usuario = Depends(
        require_entitled_permission(
            "estoque:administrar",
            ENTITLEMENT_INVENTORY,
            detail="Estoque avançado, custos e produção não estão disponíveis no plano atual.",
        )
    ),
) -> Usuario:
    return current_user


class SubReceitaIngredienteInput(BaseModel):
    insumo_id: Optional[str] = None
    sub_receita_filha_id: Optional[str] = None
    quantidade: float = Field(..., gt=0)
    unidade_medida: str = "g"
    perda_tecnica_pct: float = Field(default=0.0, ge=0, le=99)


class SubReceitaUpsert(BaseModel):
    nome: str = Field(..., min_length=2, max_length=160)
    unidade_rendimento: str = "kg"
    rendimento_esperado: float = Field(..., gt=0)
    insumo_saida_id: Optional[str] = None
    modo_preparo: str = ""
    ingredientes: list[SubReceitaIngredienteInput]


class FichaComponenteInput(BaseModel):
    insumo_id: Optional[str] = None
    sub_receita_id: Optional[str] = None
    quantidade: float = Field(..., gt=0)
    unidade_medida: str = "un"
    papel: str = "ingrediente"


class FichaUniversalUpsert(BaseModel):
    componentes: list[FichaComponenteInput]


class OrdemProducaoCreate(BaseModel):
    sub_receita_id: str
    quantidade_planejada: float = Field(..., gt=0)
    quantidade_produzida: float = Field(..., gt=0)
    peso_inicial: Optional[float] = Field(default=None, gt=0)
    perda_producao: float = Field(default=0.0, ge=0)
    codigo_lote: Optional[str] = None
    data_validade: Optional[datetime.date] = None
    observacao: str = ""


class BuffetLoteCreate(BaseModel):
    data_operacional: datetime.date
    nome_preparacao: str = Field(..., min_length=2, max_length=160)
    unidade_medida: str = "kg"
    quantidade_produzida: float = Field(default=0.0, ge=0)
    quantidade_reposicao: float = Field(default=0.0, ge=0)
    sobra: float = Field(default=0.0, ge=0)
    descarte: float = Field(default=0.0, ge=0)
    custo_lote: Optional[float] = Field(default=None, ge=0)
    sub_receita_id: Optional[str] = None
    ordem_producao_id: Optional[str] = None
    observacao: str = ""


class PedidoCompraItemInput(BaseModel):
    insumo_id: str
    quantidade_pedida: float = Field(..., gt=0)
    fator_conversao: float = Field(default=1.0, gt=0)
    preco_unitario_previsto: float = Field(default=0.0, ge=0)


class PedidoCompraCreate(BaseModel):
    distribuidor_id: str
    data_emissao: datetime.date
    data_entrega_prevista: Optional[datetime.date] = None
    numero_pedido: Optional[str] = None
    observacao: str = ""
    itens: list[PedidoCompraItemInput]


class RecebimentoCompraItemInput(BaseModel):
    item_id: int
    quantidade_recebida: float = Field(..., gt=0)
    preco_unitario_recebido: Optional[float] = Field(default=None, ge=0)
    codigo_lote: Optional[str] = None
    data_validade: Optional[str] = None


class RecebimentoCompraRequest(BaseModel):
    recebimentos: list[RecebimentoCompraItemInput]
    numero_documento: Optional[str] = None
    gerar_conta_pagar: bool = False
    data_vencimento_financeiro: Optional[datetime.date] = None


class XmlItemConfirmacao(BaseModel):
    codigo_fornecedor: str = ""
    descricao_fornecedor: str = ""
    unidade_compra: str = "un"
    insumo_id: str
    quantidade_compra: float = Field(..., gt=0)
    fator_conversao: float = Field(default=1.0, gt=0)
    valor_unitario_compra: float = Field(..., ge=0)
    codigo_lote: Optional[str] = None
    data_validade: Optional[str] = None


class XmlConfirmacaoRequest(BaseModel):
    chave_acesso: str = ""
    numero_nota: str = "S/N"
    fornecedor_nome: str = "Fornecedor XML"
    fornecedor_cnpj: str = ""
    data_emissao: Optional[str] = None
    itens: list[XmlItemConfirmacao]
    gerar_conta_pagar: bool = False
    data_vencimento_financeiro: Optional[datetime.date] = None


class PerdaDetalhadaRequest(BaseModel):
    insumo_id: str
    quantidade: float = Field(..., gt=0)
    categoria_perda: str
    observacao: str = ""
    lote_id: Optional[str] = None


@router.get("/sub-receitas")
def listar_sub_receitas(
    db: Session = Depends(get_db),
    _user: Usuario = Depends(_require_supply_read),
):
    rest_id = require_tenant_id()
    rows = (
        db.query(SubReceita)
        .options(joinedload(SubReceita.ingredientes))
        .filter(SubReceita.restaurante_id == rest_id, SubReceita.ativo.is_(True))
        .order_by(SubReceita.nome.asc())
        .all()
    )
    out = []
    for sub in rows:
        custo_unit, ok, reason = calcular_custo_sub_receita(db, restaurante_id=rest_id, sub_receita_id=sub.id)
        out.append({
            "id": sub.id,
            "nome": sub.nome,
            "unidade_rendimento": sub.unidade_rendimento,
            "rendimento_esperado": float(sub.rendimento_esperado),
            "insumo_saida_id": sub.insumo_saida_id,
            "modo_preparo": sub.modo_preparo,
            "custo_unitario_estimado": float(custo_unit) if custo_unit is not None else None,
            "custo_completo": ok,
            "motivo_custo_incompleto": reason,
            "ingredientes": [
                {
                    "id": ing.id,
                    "insumo_id": ing.insumo_id,
                    "sub_receita_filha_id": ing.sub_receita_filha_id,
                    "quantidade": float(ing.quantidade),
                    "unidade_medida": ing.unidade_medida,
                    "perda_tecnica_pct": float(ing.perda_tecnica_pct),
                }
                for ing in sub.ingredientes
            ],
        })
    return out


@router.post("/sub-receitas", status_code=status.HTTP_201_CREATED)
def criar_sub_receita(
    payload: SubReceitaUpsert,
    db: Session = Depends(get_db),
    _user: Usuario = Depends(_require_supply_write),
):
    rest_id = require_tenant_id()
    try:
        sub = create_or_update_sub_receita(
            db,
            restaurante_id=rest_id,
            nome=payload.nome,
            unidade_rendimento=payload.unidade_rendimento,
            rendimento_esperado=payload.rendimento_esperado,
            ingredientes=[i.model_dump() for i in payload.ingredientes],
            insumo_saida_id=payload.insumo_saida_id,
            modo_preparo=payload.modo_preparo,
        )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"id": sub.id, "nome": sub.nome}


@router.get("/fichas/{entidade_tipo}/{entidade_id}")
def obter_ficha_universal(
    entidade_tipo: str,
    entidade_id: str,
    db: Session = Depends(get_db),
    _user: Usuario = Depends(_require_supply_read),
):
    rest_id = require_tenant_id()
    rows = (
        db.query(FichaTecnicaComponente)
        .filter(
            FichaTecnicaComponente.restaurante_id == rest_id,
            FichaTecnicaComponente.entidade_tipo == entidade_tipo,
            FichaTecnicaComponente.entidade_id == entidade_id,
        )
        .all()
    )
    return [
        {
            "id": r.id,
            "insumo_id": r.insumo_id,
            "sub_receita_id": r.sub_receita_id,
            "quantidade": float(r.quantidade),
            "unidade_medida": r.unidade_medida,
            "papel": r.papel,
        }
        for r in rows
    ]


@router.put("/fichas/{entidade_tipo}/{entidade_id}")
def salvar_ficha_universal(
    entidade_tipo: str,
    entidade_id: str,
    payload: FichaUniversalUpsert,
    db: Session = Depends(get_db),
    _user: Usuario = Depends(_require_supply_write),
):
    rest_id = require_tenant_id()
    try:
        rows = upsert_ficha_tecnica_universal(
            db,
            restaurante_id=rest_id,
            entidade_tipo=entidade_tipo,
            entidade_id=entidade_id,
            componentes=[c.model_dump() for c in payload.componentes],
        )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok", "componentes_count": len(rows)}


@router.get("/ordens-producao")
def listar_ordens_producao(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _user: Usuario = Depends(_require_supply_read),
):
    rest_id = require_tenant_id()
    rows = (
        db.query(OrdemProducao)
        .options(joinedload(OrdemProducao.sub_receita))
        .filter(OrdemProducao.restaurante_id == rest_id)
        .order_by(OrdemProducao.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": op.id,
            "sub_receita_id": op.sub_receita_id,
            "sub_receita_nome": op.sub_receita.nome if op.sub_receita else None,
            "insumo_destino_id": op.insumo_destino_id,
            "lote_destino_id": op.lote_destino_id,
            "quantidade_planejada": float(op.quantidade_planejada),
            "quantidade_produzida": float(op.quantidade_produzida or 0),
            "perda_producao": float(op.perda_producao or 0),
            "rendimento_pct": float(op.rendimento_pct) if op.rendimento_pct is not None else None,
            "custo_total_insumos": float(op.custo_total_insumos) if op.custo_total_insumos is not None else None,
            "custo_unitario_produzido": float(op.custo_unitario_produzido) if op.custo_unitario_produzido is not None else None,
            "status": op.status,
            "concluida_em": op.concluida_em.isoformat() if op.concluida_em else None,
        }
        for op in rows
    ]


@router.post("/ordens-producao", status_code=status.HTTP_201_CREATED)
def criar_ordem_producao(
    payload: OrdemProducaoCreate,
    db: Session = Depends(get_db),
    user: Usuario = Depends(_require_supply_write),
):
    rest_id = require_tenant_id()
    try:
        op = executar_ordem_producao(
            db,
            restaurante_id=rest_id,
            sub_receita_id=payload.sub_receita_id,
            quantidade_planejada=payload.quantidade_planejada,
            quantidade_produzida=payload.quantidade_produzida,
            peso_inicial=payload.peso_inicial,
            perda_producao=payload.perda_producao,
            codigo_lote=payload.codigo_lote,
            data_validade=payload.data_validade,
            observacao=payload.observacao,
            usuario_id=user.id,
        )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "id": op.id,
        "status": op.status,
        "rendimento_pct": float(op.rendimento_pct) if op.rendimento_pct is not None else None,
        "custo_total_insumos": float(op.custo_total_insumos) if op.custo_total_insumos is not None else None,
        "custo_unitario_produzido": float(op.custo_unitario_produzido) if op.custo_unitario_produzido is not None else None,
        "insumo_destino_id": op.insumo_destino_id,
        "lote_destino_id": op.lote_destino_id,
    }


@router.get("/buffet-lotes")
def listar_buffet_lotes(
    data_operacional: Optional[datetime.date] = None,
    db: Session = Depends(get_db),
    _user: Usuario = Depends(_require_supply_read),
):
    rest_id = require_tenant_id()
    q = db.query(RegistroBuffetLote).filter(RegistroBuffetLote.restaurante_id == rest_id)
    if data_operacional:
        q = q.filter(RegistroBuffetLote.data_operacional == data_operacional)
    rows = q.order_by(RegistroBuffetLote.data_operacional.desc(), RegistroBuffetLote.created_at.desc()).limit(100).all()
    return [
        {
            "id": r.id,
            "data_operacional": r.data_operacional.isoformat(),
            "nome_preparacao": r.nome_preparacao,
            "unidade_medida": r.unidade_medida,
            "quantidade_produzida": float(r.quantidade_produzida),
            "quantidade_reposicao": float(r.quantidade_reposicao),
            "sobra": float(r.sobra),
            "descarte": float(r.descarte),
            "custo_lote": float(r.custo_lote) if r.custo_lote is not None else None,
            "custo_por_unidade": float(r.custo_por_unidade) if r.custo_por_unidade is not None else None,
        }
        for r in rows
    ]


@router.post("/buffet-lotes", status_code=status.HTTP_201_CREATED)
def criar_buffet_lote(
    payload: BuffetLoteCreate,
    db: Session = Depends(get_db),
    user: Usuario = Depends(_require_supply_write),
):
    rest_id = require_tenant_id()
    try:
        reg = registrar_buffet_lote(
            db,
            restaurante_id=rest_id,
            data_operacional=payload.data_operacional,
            nome_preparacao=payload.nome_preparacao,
            unidade_medida=payload.unidade_medida,
            quantidade_produzida=payload.quantidade_produzida,
            quantidade_reposicao=payload.quantidade_reposicao,
            sobra=payload.sobra,
            descarte=payload.descarte,
            custo_lote=payload.custo_lote,
            sub_receita_id=payload.sub_receita_id,
            ordem_producao_id=payload.ordem_producao_id,
            observacao=payload.observacao,
            usuario_id=user.id,
        )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "id": reg.id,
        "custo_lote": float(reg.custo_lote) if reg.custo_lote is not None else None,
        "custo_por_unidade": float(reg.custo_por_unidade) if reg.custo_por_unidade is not None else None,
    }


@router.get("/pedidos-compra")
def listar_pedidos_compra(
    db: Session = Depends(get_db),
    _user: Usuario = Depends(_require_supply_read),
):
    rest_id = require_tenant_id()
    rows = (
        db.query(PedidoCompra)
        .options(joinedload(PedidoCompra.distribuidor), joinedload(PedidoCompra.itens).joinedload(PedidoCompra.itens.property.mapper.class_.insumo))
        .filter(PedidoCompra.restaurante_id == rest_id)
        .order_by(PedidoCompra.created_at.desc())
        .limit(100)
        .all()
    )
    return [
        {
            "id": pc.id,
            "numero_pedido": pc.numero_pedido,
            "distribuidor_id": pc.distribuidor_id,
            "distribuidor_nome": pc.distribuidor.nome_fantasia if pc.distribuidor else None,
            "data_emissao": pc.data_emissao.isoformat(),
            "status": pc.status,
            "valor_total_previsto": float(pc.valor_total_previsto),
            "conta_pagar_id": pc.conta_pagar_id,
            "itens": [
                {
                    "id": it.id,
                    "insumo_id": it.insumo_id,
                    "insumo_nome": it.insumo.nome if it.insumo else None,
                    "quantidade_pedida": float(it.quantidade_pedida),
                    "quantidade_recebida": float(it.quantidade_recebida),
                    "fator_conversao": float(it.fator_conversao),
                    "preco_unitario_previsto": float(it.preco_unitario_previsto),
                }
                for it in pc.itens
            ],
        }
        for pc in rows
    ]


@router.post("/pedidos-compra", status_code=status.HTTP_201_CREATED)
def criar_pc(
    payload: PedidoCompraCreate,
    db: Session = Depends(get_db),
    user: Usuario = Depends(_require_supply_write),
):
    rest_id = require_tenant_id()
    try:
        pc = criar_pedido_compra(
            db,
            restaurante_id=rest_id,
            distribuidor_id=payload.distribuidor_id,
            data_emissao=payload.data_emissao,
            itens=[i.model_dump() for i in payload.itens],
            data_entrega_prevista=payload.data_entrega_prevista,
            numero_pedido=payload.numero_pedido,
            observacao=payload.observacao,
            usuario_id=user.id,
        )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"id": pc.id, "numero_pedido": pc.numero_pedido, "status": pc.status, "valor_total_previsto": float(pc.valor_total_previsto)}


@router.post("/pedidos-compra/{pedido_compra_id}/receber")
def receber_pc(
    pedido_compra_id: str,
    payload: RecebimentoCompraRequest,
    db: Session = Depends(get_db),
    user: Usuario = Depends(_require_supply_write),
):
    rest_id = require_tenant_id()
    try:
        res = receber_pedido_compra(
            db,
            restaurante_id=rest_id,
            pedido_compra_id=pedido_compra_id,
            recebimentos=[r.model_dump() for r in payload.recebimentos],
            numero_documento=payload.numero_documento,
            gerar_conta_pagar=payload.gerar_conta_pagar,
            data_vencimento_financeiro=payload.data_vencimento_financeiro,
            usuario_id=user.id,
        )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return res


@router.post("/xml/preview")
async def xml_preview(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _user: Usuario = Depends(_require_supply_write),
):
    rest_id = require_tenant_id()
    content = await file.read(10 * 1024 * 1024 + 1)
    await file.close()
    if not content or len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Arquivo XML inválido ou excede 10 MB.")
    try:
        return preview_xml_nfe(db, restaurante_id=rest_id, xml_content=content)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Não foi possível analisar o XML: {exc}") from exc


@router.post("/xml/confirmar", status_code=status.HTTP_201_CREATED)
def xml_confirmar(
    payload: XmlConfirmacaoRequest,
    db: Session = Depends(get_db),
    user: Usuario = Depends(_require_supply_write),
):
    rest_id = require_tenant_id()
    try:
        res = confirmar_importacao_xml_revisada(
            db,
            restaurante_id=rest_id,
            chave_acesso=payload.chave_acesso,
            numero_nota=payload.numero_nota,
            fornecedor_nome=payload.fornecedor_nome,
            fornecedor_cnpj=payload.fornecedor_cnpj,
            data_emissao=payload.data_emissao,
            itens=[i.model_dump() for i in payload.itens],
            gerar_conta_pagar=payload.gerar_conta_pagar,
            data_vencimento_financeiro=payload.data_vencimento_financeiro,
            usuario_id=user.id,
        )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return res


@router.get("/lotes")
def listar_lotes(
    insumo_id: Optional[str] = None,
    apenas_ativos: bool = True,
    dias_alerta_validade: int = Query(15, ge=1, le=365),
    db: Session = Depends(get_db),
    _user: Usuario = Depends(_require_supply_read),
):
    rest_id = require_tenant_id()
    q = (
        db.query(LoteEstoque)
        .options(joinedload(LoteEstoque.insumo))
        .filter(LoteEstoque.restaurante_id == rest_id)
    )
    if insumo_id:
        q = q.filter(LoteEstoque.insumo_id == insumo_id)
    if apenas_ativos:
        q = q.filter(LoteEstoque.ativo.is_(True), LoteEstoque.saldo_atual > 0)
    rows = q.order_by(LoteEstoque.data_validade.asc().nullslast(), LoteEstoque.created_at.asc()).limit(200).all()
    hoje = datetime.date.today()
    limite = hoje + datetime.timedelta(days=dias_alerta_validade)
    return [
        {
            "id": l.id,
            "insumo_id": l.insumo_id,
            "insumo_nome": l.insumo.nome if l.insumo else None,
            "codigo_lote": l.codigo_lote,
            "data_validade": l.data_validade.isoformat() if l.data_validade else None,
            "vencido": bool(l.data_validade and l.data_validade < hoje),
            "proximo_vencimento": bool(l.data_validade and hoje <= l.data_validade <= limite),
            "quantidade_inicial": float(l.quantidade_inicial),
            "saldo_atual": float(l.saldo_atual),
            "custo_unitario": float(l.custo_unitario),
            "origem_tipo": l.origem_tipo,
        }
        for l in rows
    ]


@router.post("/perdas", status_code=status.HTTP_201_CREATED)
def registrar_perda(
    payload: PerdaDetalhadaRequest,
    db: Session = Depends(get_db),
    user: Usuario = Depends(_require_supply_write),
):
    rest_id = require_tenant_id()
    try:
        res = registrar_perda_detalhada(
            db,
            restaurante_id=rest_id,
            insumo_id=payload.insumo_id,
            quantidade=payload.quantidade,
            categoria_perda=payload.categoria_perda,
            observacao=payload.observacao,
            lote_id=payload.lote_id,
            usuario_id=user.id,
        )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return res


@router.get("/perdas")
def listar_perdas(
    limit: int = Query(100, ge=1, le=300),
    db: Session = Depends(get_db),
    _user: Usuario = Depends(_require_supply_read),
):
    rest_id = require_tenant_id()
    rows = (
        db.query(MovimentacaoEstoque)
        .options(joinedload(MovimentacaoEstoque.insumo))
        .filter(MovimentacaoEstoque.restaurante_id == rest_id, MovimentacaoEstoque.tipo == "perda")
        .order_by(MovimentacaoEstoque.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": m.id,
            "insumo_id": m.insumo_id,
            "insumo_nome": m.insumo.nome if m.insumo else None,
            "quantidade": float(m.quantidade),
            "custo_unitario": float(m.custo_unitario),
            "custo_estimado": round(float(m.quantidade) * float(m.custo_unitario), 2) if m.custo_unitario else None,
            "categoria_perda": m.motivo,
            "observacao": m.observacao,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in rows
    ]


@router.get("/modificadores-opcoes")
def listar_opcoes_modificadores(
    db: Session = Depends(get_db),
    _user: Usuario = Depends(_require_supply_read),
):
    rest_id = require_tenant_id()
    rows = (
        db.query(OpcaoModificador, GrupoModificador.nome)
        .join(GrupoModificador, GrupoModificador.id == OpcaoModificador.grupo_id)
        .filter(OpcaoModificador.restaurante_id == rest_id, GrupoModificador.restaurante_id == rest_id)
        .order_by(GrupoModificador.nome.asc(), OpcaoModificador.nome.asc())
        .all()
    )
    return [
        {
            "id": opt.id,
            "nome": opt.nome,
            "grupo_id": opt.grupo_id,
            "grupo_nome": grupo_nome,
            "preco": float(opt.preco_adicional or 0),
        }
        for opt, grupo_nome in rows
    ]


@router.get("/custos-produtos")
def listar_custos_produtos(
    db: Session = Depends(get_db),
    _user: Usuario = Depends(_require_supply_read),
):
    rest_id = require_tenant_id()
    produtos = (
        db.query(Produto)
        .filter(Produto.restaurante_id == rest_id)
        .order_by(Produto.nome.asc())
        .all()
    )
    insumos_map = {
        i.id: i
        for i in db.query(Insumo).filter(Insumo.restaurante_id == rest_id).all()
    }
    fichas_univ = (
        db.query(FichaTecnicaComponente)
        .filter(
            FichaTecnicaComponente.restaurante_id == rest_id,
            FichaTecnicaComponente.entidade_tipo == "produto",
        )
        .all()
    )
    fichas_legado = (
        db.query(ProdutoInsumo)
        .filter(ProdutoInsumo.restaurante_id == rest_id)
        .all()
    )
    comp_by_prod: dict[str, list] = {}
    for comp in fichas_univ:
        comp_by_prod.setdefault(comp.entidade_id, []).append(comp)
    legado_by_prod: dict[str, list] = {}
    for leg in fichas_legado:
        legado_by_prod.setdefault(leg.produto_id, []).append(leg)

    out = []
    for p in produtos:
        preco_venda = float(p.preco_promocional if p.preco_promocional is not None else (p.preco or 0))
        univ = comp_by_prod.get(p.id, [])
        leg = legado_by_prod.get(p.id, [])
        if not univ and not leg:
            out.append({
                "produto_id": p.id,
                "nome": p.nome,
                "preco_venda": preco_venda,
                "custo_unitario": None,
                "custo_completo": False,
                "margem_contribuicao_reais": None,
                "margem_contribuicao_pct": None,
                "motivo_incompleto": "Sem ficha técnica cadastrada",
            })
            continue
        custo_total = 0.0
        completo = True
        motivos: list[str] = []
        if univ:
            for c in univ:
                if c.insumo_id:
                    ins = insumos_map.get(c.insumo_id)
                    unit = float(ins.preco_medio_custo or 0) if ins else 0.0
                    if unit <= 0:
                        completo = False
                        motivos.append(f"Insumo '{ins.nome if ins else c.insumo_id}' sem custo médio")
                    else:
                        custo_total += float(c.quantidade) * unit
                elif c.sub_receita_id:
                    sub_cost, sub_ok, sub_reason = calcular_custo_sub_receita(
                        db, restaurante_id=rest_id, sub_receita_id=c.sub_receita_id
                    )
                    if not sub_ok or sub_cost is None:
                        completo = False
                        motivos.append(sub_reason or "Sub-receita com custo incompleto")
                    else:
                        custo_total += float(c.quantidade) * float(sub_cost)
        else:
            for l in leg:
                ins = insumos_map.get(l.insumo_id)
                unit = float(ins.preco_medio_custo or 0) if ins else 0.0
                if unit <= 0:
                    completo = False
                    motivos.append(f"Insumo '{ins.nome if ins else l.insumo_id}' sem custo médio")
                else:
                    custo_total += float(l.quantidade) * unit

        custo_round = round(custo_total, 2) if completo else None
        margem_reais = round(preco_venda - custo_round, 2) if custo_round is not None else None
        margem_pct = round((margem_reais / preco_venda) * 100, 1) if (margem_reais is not None and preco_venda > 0) else None
        out.append({
            "produto_id": p.id,
            "nome": p.nome,
            "preco_venda": preco_venda,
            "custo_unitario": custo_round,
            "custo_completo": completo,
            "margem_contribuicao_reais": margem_reais,
            "margem_contribuicao_pct": margem_pct,
            "motivo_incompleto": "; ".join(motivos) if motivos else None,
        })
    return out

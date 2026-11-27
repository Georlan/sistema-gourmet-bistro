"""Modelos de Custos Históricos, Fichas Técnicas Universais, Compras, Lotes e Produção (B8 — Frentes 3, 4 e 5)."""

from __future__ import annotations

import datetime
import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from .database import Base, current_restaurante_id


def _now_utc() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _uuid_str() -> str:
    return str(uuid.uuid4())


class SubReceita(Base):
    """Preparação intermediária / sub-receita produzida internamente (ex: molho, massa, carne preparada)."""

    __tablename__ = "b8_sub_receitas"
    __table_args__ = (
        CheckConstraint("rendimento_esperado > 0", name="ck_b8_sub_rend_pos"),
        Index("ix_b8_sub_tenant_ativo", "restaurante_id", "ativo"),
    )

    id = Column(String(36), primary_key=True, default=_uuid_str)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    nome = Column(String(160), nullable=False)
    unidade_rendimento = Column(String(16), nullable=False, default="kg")
    rendimento_esperado = Column(Numeric(14, 4, asdecimal=False), nullable=False, default=1.0)
    insumo_saida_id = Column(String, ForeignKey("insumos.id"), nullable=True)
    modo_preparo = Column(Text, nullable=False, default="")
    ativo = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=_now_utc, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now_utc, onupdate=_now_utc, nullable=False)

    ingredientes = relationship(
        "SubReceitaIngrediente",
        foreign_keys="[SubReceitaIngrediente.sub_receita_id]",
        back_populates="sub_receita",
        cascade="all, delete-orphan",
    )
    insumo_saida = relationship("Insumo")


class SubReceitaIngrediente(Base):
    """Componente (insumo ou outra sub-receita sem ciclos) de uma SubReceita."""

    __tablename__ = "b8_sub_receita_ingredientes"
    __table_args__ = (
        CheckConstraint("quantidade > 0", name="ck_b8_sub_ing_qtd_pos"),
        CheckConstraint(
            "(insumo_id IS NOT NULL AND sub_receita_filha_id IS NULL) OR (insumo_id IS NULL AND sub_receita_filha_id IS NOT NULL)",
            name="ck_b8_sub_ing_xor",
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    sub_receita_id = Column(String(36), ForeignKey("b8_sub_receitas.id", ondelete="CASCADE"), nullable=False, index=True)
    insumo_id = Column(String, ForeignKey("insumos.id"), nullable=True)
    sub_receita_filha_id = Column(String(36), ForeignKey("b8_sub_receitas.id"), nullable=True)
    quantidade = Column(Numeric(14, 4, asdecimal=False), nullable=False)
    unidade_medida = Column(String(16), nullable=False, default="g")
    perda_tecnica_pct = Column(Numeric(6, 2, asdecimal=False), nullable=False, default=0.0)

    sub_receita = relationship("SubReceita", foreign_keys=[sub_receita_id], back_populates="ingredientes")
    insumo = relationship("Insumo")
    sub_receita_filha = relationship("SubReceita", foreign_keys=[sub_receita_filha_id])


class FichaTecnicaComponente(Base):
    """Ficha técnica universal para produtos, opções de modificadores, embalagens e variações."""

    __tablename__ = "b8_fichas_tecnicas_componentes"
    __table_args__ = (
        CheckConstraint("quantidade > 0", name="ck_b8_ftc_qtd_pos"),
        CheckConstraint(
            "entidade_tipo IN ('produto', 'opcao_modificador')",
            name="ck_b8_ftc_entidade_tipo",
        ),
        CheckConstraint(
            "papel IN ('ingrediente', 'embalagem', 'complemento')",
            name="ck_b8_ftc_papel",
        ),
        CheckConstraint(
            "(insumo_id IS NOT NULL AND sub_receita_id IS NULL) OR (insumo_id IS NULL AND sub_receita_id IS NOT NULL)",
            name="ck_b8_ftc_comp_xor",
        ),
        Index("ix_b8_ftc_tenant_entidade", "restaurante_id", "entidade_tipo", "entidade_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    entidade_tipo = Column(String(32), nullable=False, default="produto")
    entidade_id = Column(String(64), nullable=False)
    insumo_id = Column(String, ForeignKey("insumos.id"), nullable=True)
    sub_receita_id = Column(String(36), ForeignKey("b8_sub_receitas.id"), nullable=True)
    quantidade = Column(Numeric(14, 4, asdecimal=False), nullable=False)
    unidade_medida = Column(String(16), nullable=False, default="un")
    papel = Column(String(24), nullable=False, default="ingrediente")
    created_at = Column(DateTime(timezone=True), default=_now_utc, nullable=False)

    insumo = relationship("Insumo")
    sub_receita = relationship("SubReceita")


class ItemCustoSnapshot(Base):
    """Snapshot imutável do custo histórico capturado no consumo de estoque de um Item vendido."""

    __tablename__ = "b8_itens_custo_snapshots"
    __table_args__ = (
        UniqueConstraint("restaurante_id", "item_id", name="uq_b8_ics_tenant_item"),
        Index("ix_b8_ics_tenant_created", "restaurante_id", "created_at"),
    )

    id = Column(String(36), primary_key=True, default=_uuid_str)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    comanda_id = Column(String, ForeignKey("comandas.id", ondelete="CASCADE"), nullable=False, index=True)
    item_id = Column(String, ForeignKey("itens.id", ondelete="CASCADE"), nullable=False, index=True)
    produto_id = Column(String, nullable=False)
    quantidade = Column(Numeric(14, 4, asdecimal=False), nullable=False, default=1.0)
    custo_unitario = Column(Numeric(14, 4, asdecimal=False), nullable=True)
    custo_total = Column(Numeric(14, 2, asdecimal=False), nullable=True)
    custo_completo = Column(Boolean, nullable=False, default=False)
    motivo_incompleto = Column(String(160), nullable=True)
    detalhes_json = Column(JSON, nullable=True)
    estornado = Column(Boolean, nullable=False, default=False)
    estornado_em = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now_utc, nullable=False)


class FornecedorInsumoDePara(Base):
    """Mapeamento de produto do fornecedor (XML NF-e / compra) para insumo interno com fator de conversão."""

    __tablename__ = "b8_fornecedor_insumo_depara"
    __table_args__ = (
        CheckConstraint("fator_conversao > 0", name="ck_b8_depara_fator_pos"),
        UniqueConstraint(
            "restaurante_id",
            "cnpj_fornecedor",
            "codigo_fornecedor",
            name="uq_b8_depara_forn_cod",
        ),
    )

    id = Column(String(36), primary_key=True, default=_uuid_str)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    distribuidor_id = Column(String, ForeignKey("distribuidores.id"), nullable=True)
    cnpj_fornecedor = Column(String(20), nullable=False, default="")
    codigo_fornecedor = Column(String(80), nullable=False)
    descricao_fornecedor = Column(String(240), nullable=False, default="")
    insumo_id = Column(String, ForeignKey("insumos.id"), nullable=False)
    unidade_compra = Column(String(16), nullable=False, default="un")
    fator_conversao = Column(Numeric(14, 4, asdecimal=False), nullable=False, default=1.0)
    created_at = Column(DateTime(timezone=True), default=_now_utc, nullable=False)

    insumo = relationship("Insumo")


class PedidoCompra(Base):
    """Pedido de compra com recebimento parcial/total e vínculo opcional a Conta a Pagar."""

    __tablename__ = "b8_pedidos_compra"
    __table_args__ = (
        CheckConstraint(
            "status IN ('rascunho', 'enviado', 'recebido_parcial', 'recebido', 'cancelado')",
            name="ck_b8_pc_status",
        ),
        Index("ix_b8_pc_tenant_status", "restaurante_id", "status"),
    )

    id = Column(String(36), primary_key=True, default=_uuid_str)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    distribuidor_id = Column(String, ForeignKey("distribuidores.id"), nullable=False)
    numero_pedido = Column(String(40), nullable=True)
    data_emissao = Column(Date, nullable=False)
    data_entrega_prevista = Column(Date, nullable=True)
    status = Column(String(24), nullable=False, default="rascunho")
    valor_total_previsto = Column(Numeric(14, 2, asdecimal=False), nullable=False, default=0.0)
    conta_pagar_id = Column(String(36), ForeignKey("b8_contas_pagar.id"), nullable=True)
    observacao = Column(Text, nullable=False, default="")
    usuario_id = Column(String, ForeignKey("usuarios.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now_utc, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now_utc, onupdate=_now_utc, nullable=False)

    distribuidor = relationship("Distribuidor")
    itens = relationship("PedidoCompraItem", back_populates="pedido_compra", cascade="all, delete-orphan")


class PedidoCompraItem(Base):
    """Item de um Pedido de Compra com controle de quantidade pedida vs recebida."""

    __tablename__ = "b8_pedidos_compra_itens"
    __table_args__ = (
        CheckConstraint("quantidade_pedida > 0", name="ck_b8_pci_qtd_pos"),
        CheckConstraint("quantidade_recebida >= 0", name="ck_b8_pci_rec_nonneg"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    pedido_compra_id = Column(String(36), ForeignKey("b8_pedidos_compra.id", ondelete="CASCADE"), nullable=False, index=True)
    insumo_id = Column(String, ForeignKey("insumos.id"), nullable=False)
    quantidade_pedida = Column(Numeric(14, 4, asdecimal=False), nullable=False)
    quantidade_recebida = Column(Numeric(14, 4, asdecimal=False), nullable=False, default=0.0)
    fator_conversao = Column(Numeric(14, 4, asdecimal=False), nullable=False, default=1.0)
    preco_unitario_previsto = Column(Numeric(14, 4, asdecimal=False), nullable=False, default=0.0)
    preco_unitario_recebido = Column(Numeric(14, 4, asdecimal=False), nullable=True)

    pedido_compra = relationship("PedidoCompra", back_populates="itens")
    insumo = relationship("Insumo")


class LoteEstoque(Base):
    """Lote de insumo com validade e saldo para rastreabilidade FEFO/PEPS."""

    __tablename__ = "b8_lotes_estoque"
    __table_args__ = (
        CheckConstraint("quantidade_inicial >= 0 AND saldo_atual >= 0", name="ck_b8_lote_qtd_nonneg"),
        Index("ix_b8_lote_tenant_insumo_val", "restaurante_id", "insumo_id", "data_validade"),
    )

    id = Column(String(36), primary_key=True, default=_uuid_str)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    insumo_id = Column(String, ForeignKey("insumos.id"), nullable=False, index=True)
    codigo_lote = Column(String(64), nullable=False)
    data_validade = Column(Date, nullable=True, index=True)
    quantidade_inicial = Column(Float, nullable=False)
    saldo_atual = Column(Float, nullable=False)
    custo_unitario = Column(Numeric(14, 4, asdecimal=False), nullable=False, default=0.0)
    origem_tipo = Column(String(32), nullable=False, default="entrada_manual")  # entrada_manual | xml | compra | producao
    origem_id = Column(String(64), nullable=True)
    ativo = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=_now_utc, nullable=False)

    insumo = relationship("Insumo")


class OrdemProducao(Base):
    """Ordem de produção gastronômica por lote com controle de rendimento e custo unitário."""

    __tablename__ = "b8_ordens_producao"
    __table_args__ = (
        CheckConstraint("quantidade_planejada > 0", name="ck_b8_op_plan_pos"),
        CheckConstraint("status IN ('planejada', 'concluida', 'cancelada')", name="ck_b8_op_status"),
        Index("ix_b8_op_tenant_status", "restaurante_id", "status"),
    )

    id = Column(String(36), primary_key=True, default=_uuid_str)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    sub_receita_id = Column(String(36), ForeignKey("b8_sub_receitas.id"), nullable=False)
    insumo_destino_id = Column(String, ForeignKey("insumos.id"), nullable=True)
    lote_destino_id = Column(String(36), ForeignKey("b8_lotes_estoque.id"), nullable=True)
    quantidade_planejada = Column(Numeric(14, 4, asdecimal=False), nullable=False)
    quantidade_produzida = Column(Numeric(14, 4, asdecimal=False), nullable=True)
    peso_inicial = Column(Numeric(14, 4, asdecimal=False), nullable=True)
    perda_producao = Column(Numeric(14, 4, asdecimal=False), nullable=False, default=0.0)
    rendimento_pct = Column(Numeric(8, 2, asdecimal=False), nullable=True)
    custo_total_insumos = Column(Numeric(14, 2, asdecimal=False), nullable=False, default=0.0)
    custo_unitario_produzido = Column(Numeric(14, 4, asdecimal=False), nullable=True)
    status = Column(String(24), nullable=False, default="planejada")
    observacao = Column(Text, nullable=False, default="")
    usuario_id = Column(String, ForeignKey("usuarios.id"), nullable=True)
    concluida_em = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now_utc, nullable=False)

    sub_receita = relationship("SubReceita")
    consumos = relationship("OrdemProducaoConsumo", back_populates="ordem", cascade="all, delete-orphan")


class OrdemProducaoConsumo(Base):
    """Insumo consumido em uma Ordem de Produção (transformação de estoque, não CMV direto)."""

    __tablename__ = "b8_ordens_producao_consumos"
    __table_args__ = (
        CheckConstraint("quantidade_consumida > 0", name="ck_b8_opc_qtd_pos"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    ordem_id = Column(String(36), ForeignKey("b8_ordens_producao.id", ondelete="CASCADE"), nullable=False, index=True)
    insumo_id = Column(String, ForeignKey("insumos.id"), nullable=False)
    lote_id = Column(String(36), ForeignKey("b8_lotes_estoque.id"), nullable=True)
    quantidade_consumida = Column(Numeric(14, 4, asdecimal=False), nullable=False)
    custo_unitario = Column(Numeric(14, 4, asdecimal=False), nullable=False, default=0.0)
    custo_total = Column(Numeric(14, 2, asdecimal=False), nullable=False, default=0.0)

    ordem = relationship("OrdemProducao", back_populates="consumos")
    insumo = relationship("Insumo")


class RegistroBuffetLote(Base):
    """Registro de preparação, reposição, sobras e descarte para buffet/rodízio."""

    __tablename__ = "b8_registros_buffet_lotes"
    __table_args__ = (
        CheckConstraint("quantidade_produzida >= 0 AND quantidade_reposicao >= 0 AND sobra >= 0 AND descarte >= 0", name="ck_b8_rbl_nonneg"),
        Index("ix_b8_rbl_tenant_data", "restaurante_id", "data_operacional"),
    )

    id = Column(String(36), primary_key=True, default=_uuid_str)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    data_operacional = Column(Date, nullable=False)
    nome_preparacao = Column(String(160), nullable=False)
    sub_receita_id = Column(String(36), ForeignKey("b8_sub_receitas.id"), nullable=True)
    ordem_producao_id = Column(String(36), ForeignKey("b8_ordens_producao.id"), nullable=True)
    unidade_medida = Column(String(16), nullable=False, default="kg")
    quantidade_produzida = Column(Numeric(14, 4, asdecimal=False), nullable=False, default=0.0)
    quantidade_reposicao = Column(Numeric(14, 4, asdecimal=False), nullable=False, default=0.0)
    sobra = Column(Numeric(14, 4, asdecimal=False), nullable=False, default=0.0)
    descarte = Column(Numeric(14, 4, asdecimal=False), nullable=False, default=0.0)
    custo_lote = Column(Numeric(14, 2, asdecimal=False), nullable=True)
    custo_por_unidade = Column(Numeric(14, 4, asdecimal=False), nullable=True)
    observacao = Column(String(240), nullable=False, default="")
    usuario_id = Column(String, ForeignKey("usuarios.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now_utc, nullable=False)

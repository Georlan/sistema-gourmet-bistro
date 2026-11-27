"""Modelos do Núcleo Financeiro do Restaurante (B8 — Frente 1 e 2).

Estritamente isolados do financeiro interno da empresa KÔMA (`koma_internal`).
"""

from __future__ import annotations

import datetime
import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import relationship

from .database import Base, current_restaurante_id


def _now_utc() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _uuid_str() -> str:
    return str(uuid.uuid4())


class FinanceCategoria(Base):
    """Categorias financeiras gerenciais (padrão + personalizadas por restaurante)."""

    __tablename__ = "b8_finance_categorias"
    __table_args__ = (
        UniqueConstraint("restaurante_id", "codigo", name="uq_b8_fin_cat_tenant_codigo"),
        CheckConstraint(
            "tipo IN ('receita', 'despesa_fixa', 'despesa_variavel', 'custo_mercadoria', 'taxa_pagamento', 'comissao_marketplace', 'tributo', 'outra')",
            name="ck_b8_fin_cat_tipo",
        ),
        Index("ix_b8_fin_cat_tenant_tipo", "restaurante_id", "tipo"),
    )

    id = Column(String(36), primary_key=True, default=_uuid_str)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    codigo = Column(String(64), nullable=False)
    nome = Column(String(120), nullable=False)
    tipo = Column(String(32), nullable=False, default="despesa_variavel")
    sistema = Column(Boolean, nullable=False, default=False)
    ativo = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=_now_utc, nullable=False)


class FinanceConta(Base):
    """Contas financeiras do restaurante (caixa físico, conta bancária, carteira digital)."""

    __tablename__ = "b8_finance_contas"
    __table_args__ = (
        UniqueConstraint("restaurante_id", "nome", name="uq_b8_fin_conta_tenant_nome"),
        CheckConstraint(
            "tipo IN ('caixa_operacional', 'conta_bancaria', 'carteira_digital')",
            name="ck_b8_fin_conta_tipo",
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
    nome = Column(String(120), nullable=False)
    tipo = Column(String(32), nullable=False, default="conta_bancaria")
    saldo_inicial = Column(Numeric(14, 2, asdecimal=False), nullable=False, default=0.0)
    data_saldo_inicial = Column(Date, nullable=True)
    padrao = Column(Boolean, nullable=False, default=False)
    ativo = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=_now_utc, nullable=False)


class FinanceRecorrencia(Base):
    """Definição de despesas recorrentes com controle de duplicidade por competência."""

    __tablename__ = "b8_finance_recorrencias"
    __table_args__ = (
        CheckConstraint(
            "periodicidade IN ('mensal', 'semanal', 'quinzenal', 'anual')",
            name="ck_b8_fin_rec_periodicidade",
        ),
        CheckConstraint("valor_previsto > 0", name="ck_b8_fin_rec_valor_pos"),
    )

    id = Column(String(36), primary_key=True, default=_uuid_str)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    categoria_id = Column(String(36), ForeignKey("b8_finance_categorias.id"), nullable=False)
    distribuidor_id = Column(String, ForeignKey("distribuidores.id"), nullable=True)
    favorecido_nome = Column(String(180), nullable=False)
    descricao = Column(String(240), nullable=False)
    valor_previsto = Column(Numeric(14, 2, asdecimal=False), nullable=False)
    dia_vencimento = Column(Integer, nullable=False, default=10)
    periodicidade = Column(String(16), nullable=False, default="mensal")
    ativa = Column(Boolean, nullable=False, default=True)
    ultima_competencia_gerada = Column(String(7), nullable=True)  # YYYY-MM
    created_at = Column(DateTime(timezone=True), default=_now_utc, nullable=False)


class ContaPagar(Base):
    """Título de obrigação financeira (Conta a Pagar) do restaurante."""

    __tablename__ = "b8_contas_pagar"
    __table_args__ = (
        CheckConstraint("valor_original > 0", name="ck_b8_cp_valor_pos"),
        CheckConstraint(
            "status IN ('aberto', 'parcial', 'pago', 'cancelado')",
            name="ck_b8_cp_status",
        ),
        UniqueConstraint("restaurante_id", "recorrencia_id", "competencia_chave", name="uq_b8_cp_recorrencia_comp"),
        UniqueConstraint("restaurante_id", "origem_tipo", "origem_id", name="uq_b8_cp_origem_unica"),
        Index("ix_b8_cp_tenant_status_comp", "restaurante_id", "status", "data_competencia"),
    )

    id = Column(String(36), primary_key=True, default=_uuid_str)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    categoria_id = Column(String(36), ForeignKey("b8_finance_categorias.id"), nullable=False)
    distribuidor_id = Column(String, ForeignKey("distribuidores.id"), nullable=True)
    recorrencia_id = Column(String(36), ForeignKey("b8_finance_recorrencias.id"), nullable=True)
    competencia_chave = Column(String(16), nullable=True)  # Ex: 2026-11 para deduplicar recorrência
    favorecido_nome = Column(String(180), nullable=False)
    descricao = Column(String(240), nullable=False)
    numero_documento = Column(String(80), nullable=True)
    data_emissao = Column(Date, nullable=False)
    data_competencia = Column(Date, nullable=False, index=True)
    valor_original = Column(Numeric(14, 2, asdecimal=False), nullable=False)
    total_parcelas = Column(Integer, nullable=False, default=1)
    origem_tipo = Column(String(32), nullable=False, default="manual")  # manual | compra | xml_nfe | recorrencia
    origem_id = Column(String(64), nullable=True)
    status = Column(String(24), nullable=False, default="aberto")
    observacao = Column(Text, nullable=False, default="")
    criado_por_id = Column(String, ForeignKey("usuarios.id"), nullable=True)
    cancelado_motivo = Column(String(240), nullable=True)
    cancelado_por_id = Column(String, ForeignKey("usuarios.id"), nullable=True)
    cancelado_em = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now_utc, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now_utc, onupdate=_now_utc, nullable=False)

    categoria = relationship("FinanceCategoria")
    distribuidor = relationship("Distribuidor")
    parcelas = relationship("ContaPagarParcela", back_populates="conta_pagar", cascade="all, delete-orphan")


class ContaPagarParcela(Base):
    """Parcela individual de uma Conta a Pagar."""

    __tablename__ = "b8_contas_pagar_parcelas"
    __table_args__ = (
        CheckConstraint("valor_parcela > 0", name="ck_b8_cpp_valor_pos"),
        CheckConstraint("valor_pago >= 0", name="ck_b8_cpp_pago_nonneg"),
        CheckConstraint("juros >= 0 AND desconto >= 0", name="ck_b8_cpp_adj_nonneg"),
        CheckConstraint(
            "status IN ('aberto', 'parcial', 'pago', 'cancelado')",
            name="ck_b8_cpp_status",
        ),
        Index("ix_b8_cpp_tenant_venc_status", "restaurante_id", "data_vencimento", "status"),
    )

    id = Column(String(36), primary_key=True, default=_uuid_str)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    conta_pagar_id = Column(String(36), ForeignKey("b8_contas_pagar.id", ondelete="CASCADE"), nullable=False, index=True)
    numero_parcela = Column(Integer, nullable=False, default=1)
    data_vencimento = Column(Date, nullable=False, index=True)
    valor_parcela = Column(Numeric(14, 2, asdecimal=False), nullable=False)
    juros = Column(Numeric(14, 2, asdecimal=False), nullable=False, default=0.0)
    desconto = Column(Numeric(14, 2, asdecimal=False), nullable=False, default=0.0)
    ajuste = Column(Numeric(14, 2, asdecimal=False), nullable=False, default=0.0)
    valor_pago = Column(Numeric(14, 2, asdecimal=False), nullable=False, default=0.0)
    status = Column(String(24), nullable=False, default="aberto")
    data_ultima_baixa = Column(Date, nullable=True)

    conta_pagar = relationship("ContaPagar", back_populates="parcelas")
    baixas = relationship("ContaPagarBaixa", back_populates="parcela", cascade="all, delete-orphan")


class ContaPagarBaixa(Base):
    """Baixa (pagamento parcial ou total) idempotente de uma parcela de Conta a Pagar."""

    __tablename__ = "b8_contas_pagar_baixas"
    __table_args__ = (
        CheckConstraint("valor_pago > 0", name="ck_b8_cpb_valor_pos"),
        UniqueConstraint("restaurante_id", "idempotency_key", name="uq_b8_cpb_idem"),
    )

    id = Column(String(36), primary_key=True, default=_uuid_str)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    parcela_id = Column(String(36), ForeignKey("b8_contas_pagar_parcelas.id", ondelete="CASCADE"), nullable=False, index=True)
    conta_financeira_id = Column(String(36), ForeignKey("b8_finance_contas.id"), nullable=False)
    data_pagamento = Column(Date, nullable=False, index=True)
    valor_principal = Column(Numeric(14, 2, asdecimal=False), nullable=False)
    juros = Column(Numeric(14, 2, asdecimal=False), nullable=False, default=0.0)
    desconto = Column(Numeric(14, 2, asdecimal=False), nullable=False, default=0.0)
    ajuste = Column(Numeric(14, 2, asdecimal=False), nullable=False, default=0.0)
    valor_pago = Column(Numeric(14, 2, asdecimal=False), nullable=False)
    forma_pagamento = Column(String(32), nullable=False, default="pix")
    idempotency_key = Column(String(128), nullable=False)
    observacao = Column(String(240), nullable=False, default="")
    estornada = Column(Boolean, nullable=False, default=False)
    usuario_id = Column(String, ForeignKey("usuarios.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now_utc, nullable=False)

    parcela = relationship("ContaPagarParcela", back_populates="baixas")


class ContaReceber(Base):
    """Direito a receber do restaurante (recebíveis a prazo, repasses previstos/confirmados)."""

    __tablename__ = "b8_contas_receber"
    __table_args__ = (
        CheckConstraint("valor_previsto > 0", name="ck_b8_cr_valor_pos"),
        CheckConstraint("valor_recebido >= 0", name="ck_b8_cr_recebido_nonneg"),
        CheckConstraint(
            "status IN ('aberto', 'parcial', 'recebido', 'cancelado', 'estornado')",
            name="ck_b8_cr_status",
        ),
        CheckConstraint(
            "tipo_confirmacao IN ('previsto', 'confirmado')",
            name="ck_b8_cr_confirmacao",
        ),
        Index("ix_b8_cr_tenant_venc_status", "restaurante_id", "data_vencimento", "status"),
    )

    id = Column(String(36), primary_key=True, default=_uuid_str)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    categoria_id = Column(String(36), ForeignKey("b8_finance_categorias.id"), nullable=False)
    origem_tipo = Column(String(32), nullable=False, default="manual")  # manual | adquirente | marketplace | evento
    origem_id = Column(String(64), nullable=True)
    contraparte_nome = Column(String(180), nullable=False)
    descricao = Column(String(240), nullable=False)
    data_competencia = Column(Date, nullable=False, index=True)
    data_vencimento = Column(Date, nullable=False, index=True)
    valor_previsto = Column(Numeric(14, 2, asdecimal=False), nullable=False)
    valor_recebido = Column(Numeric(14, 2, asdecimal=False), nullable=False, default=0.0)
    tipo_confirmacao = Column(String(24), nullable=False, default="previsto")
    status = Column(String(24), nullable=False, default="aberto")
    observacao = Column(Text, nullable=False, default="")
    criado_por_id = Column(String, ForeignKey("usuarios.id"), nullable=True)
    cancelado_motivo = Column(String(240), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now_utc, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now_utc, onupdate=_now_utc, nullable=False)

    categoria = relationship("FinanceCategoria")
    baixas = relationship("ContaReceberBaixa", back_populates="conta_receber", cascade="all, delete-orphan")


class ContaReceberBaixa(Base):
    """Recebimento parcial ou total idempotente de uma Conta a Receber."""

    __tablename__ = "b8_contas_receber_baixas"
    __table_args__ = (
        CheckConstraint("valor_recebido > 0", name="ck_b8_crb_valor_pos"),
        UniqueConstraint("restaurante_id", "idempotency_key", name="uq_b8_crb_idem"),
    )

    id = Column(String(36), primary_key=True, default=_uuid_str)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    conta_receber_id = Column(String(36), ForeignKey("b8_contas_receber.id", ondelete="CASCADE"), nullable=False, index=True)
    conta_financeira_id = Column(String(36), ForeignKey("b8_finance_contas.id"), nullable=False)
    data_recebimento = Column(Date, nullable=False, index=True)
    valor_recebido = Column(Numeric(14, 2, asdecimal=False), nullable=False)
    taxa_descontada = Column(Numeric(14, 2, asdecimal=False), nullable=False, default=0.0)
    forma_recebimento = Column(String(32), nullable=False, default="pix")
    idempotency_key = Column(String(128), nullable=False)
    observacao = Column(String(240), nullable=False, default="")
    estornada = Column(Boolean, nullable=False, default=False)
    usuario_id = Column(String, ForeignKey("usuarios.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now_utc, nullable=False)

    conta_receber = relationship("ContaReceber", back_populates="baixas")


class FinanceMovimentacao(Base):
    """Ledger imutável de movimentações financeiras realizadas (Regime de Caixa)."""

    __tablename__ = "b8_finance_movimentacoes"
    __table_args__ = (
        CheckConstraint("valor > 0", name="ck_b8_fm_valor_pos"),
        CheckConstraint(
            "tipo IN ('entrada', 'saida', 'transferencia_entrada', 'transferencia_saida', 'aporte', 'retirada', 'estorno')",
            name="ck_b8_fm_tipo",
        ),
        Index("ix_b8_fm_tenant_data_conta", "restaurante_id", "data_movimento", "conta_financeira_id"),
    )

    id = Column(String(36), primary_key=True, default=_uuid_str)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    conta_financeira_id = Column(String(36), ForeignKey("b8_finance_contas.id"), nullable=False)
    categoria_id = Column(String(36), ForeignKey("b8_finance_categorias.id"), nullable=True)
    tipo = Column(String(32), nullable=False)
    valor = Column(Numeric(14, 2, asdecimal=False), nullable=False)
    data_movimento = Column(Date, nullable=False, index=True)
    descricao = Column(String(240), nullable=False)
    origem_tipo = Column(String(32), nullable=False, default="manual")  # manual | baixa_pagar | baixa_receber | transferencia
    origem_id = Column(String(64), nullable=True)
    usuario_id = Column(String, ForeignKey("usuarios.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now_utc, nullable=False)


class FinanceAuditoriaLog(Base):
    """Trilha imutável de auditoria para alterações e cancelamentos financeiros B8."""

    __tablename__ = "b8_finance_auditoria_logs"
    __table_args__ = (
        Index("ix_b8_fin_audit_tenant_ent", "restaurante_id", "entidade_tipo", "entidade_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    entidade_tipo = Column(String(48), nullable=False)
    entidade_id = Column(String(64), nullable=False)
    acao = Column(String(48), nullable=False)
    ator_id = Column(String, ForeignKey("usuarios.id"), nullable=True)
    detalhes = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

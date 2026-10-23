"""Modelos persistentes do CRM Operacional (preferências, campanhas e contatos)."""

from __future__ import annotations

import datetime
import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)

from .database import Base, current_restaurante_id


class CrmClientePreferencia(Base):
    """Preferências declaradas e controle de comunicação/opt-out por cliente."""

    __tablename__ = "crm_clientes_preferencias"
    __table_args__ = (
        Index("ix_crm_whatsapp_consent_nonce", "restaurante_id", "whatsapp_consent_nonce_hash", unique=True),
        UniqueConstraint(
            "restaurante_id",
            "cliente_id",
            name="uq_crm_clientes_preferencias_tenant_cliente",
        ),
        ForeignKeyConstraint(
            ["restaurante_id", "cliente_id"],
            ["clientes.restaurante_id", "clientes.id"],
            name="fk_crm_clientes_preferencias_cliente_tenant",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "canal_preferido IS NULL OR canal_preferido IN ('whatsapp', 'telefone', 'presencial')",
            name="ck_crm_clientes_preferencias_canal",
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
    cliente_id = Column(String, nullable=False, index=True)
    opt_out_marketing = Column(Boolean, default=False, nullable=False)
    # Only an authenticated inbound adapter may write interaction proof.
    whatsapp_consent_nonce_hash = Column(String(64), nullable=True)
    whatsapp_consent_expires_at = Column(DateTime(timezone=True), nullable=True)
    whatsapp_consent_message_hash = Column(String(64), nullable=True)
    whatsapp_marketing_consented_at = Column(DateTime(timezone=True), nullable=True)
    whatsapp_interaction_at = Column(DateTime(timezone=True), nullable=True)
    whatsapp_interaction_phone_hash = Column(String(64), nullable=True)
    whatsapp_marketing_opt_in = Column(Boolean, nullable=False, default=False, server_default="false")
    whatsapp_campaign_last_sent_at = Column(DateTime(timezone=True), nullable=True)
    whatsapp_campaign_last_event_id = Column(String(36), nullable=True)
    motivo_opt_out = Column(String(255), nullable=True)
    canal_preferido = Column(String(32), nullable=True)
    observacoes_declaradas = Column(Text, nullable=True)
    atualizado_em = Column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        onupdate=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    )


class CrmCampanha(Base):
    """Campanha guiada do CRM com objetivo, público, abordagem e janela de atribuição."""

    __tablename__ = "crm_campanhas"
    __table_args__ = (
        CheckConstraint(
            "objetivo IN ('SECOND_PURCHASE', 'CADENCE_RECOVERY', 'BENEFIT_REMINDER', "
            "'VIP_RECOGNITION', 'OCCURRENCE_RECOVERY', 'CUSTOM')",
            name="ck_crm_campanhas_objetivo",
        ),
        CheckConstraint(
            "abordagem_tipo IN ('SEM_DESCONTO', 'CUPOM', 'FIDELIDADE')",
            name="ck_crm_campanhas_abordagem_tipo",
        ),
        CheckConstraint(
            "status IN ('RASCUNHO', 'EM_EXECUCAO', 'CONCLUIDA', 'ARQUIVADA')",
            name="ck_crm_campanhas_status",
        ),
        CheckConstraint(
            "janela_atribuicao_dias >= 1 AND janela_atribuicao_dias <= 90",
            name="ck_crm_campanhas_janela_dias",
        ),
        Index(
            "ix_crm_campanhas_tenant_criado",
            "restaurante_id",
            "criado_em",
        ),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    nome = Column(String(120), nullable=False)
    objetivo = Column(String(40), nullable=False)
    segmento_filtro = Column(String(40), nullable=False, default="SECOND")
    abordagem_tipo = Column(String(32), nullable=False, default="SEM_DESCONTO")
    cupom_id = Column(String, ForeignKey("cupons.id", ondelete="SET NULL"), nullable=True)
    template_mensagem = Column(Text, nullable=False)
    janela_atribuicao_dias = Column(Integer, nullable=False, default=14)
    status = Column(String(24), nullable=False, default="EM_EXECUCAO")
    criado_por_id = Column(String, ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True)
    criado_em = Column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    )
    atualizado_em = Column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        onupdate=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    )


class CrmContatoCliente(Base):
    """Registro auditável de abordagem comercial ou preparação de mensagem por cliente."""

    __tablename__ = "crm_contatos_clientes"
    __table_args__ = (
        ForeignKeyConstraint(
            ["restaurante_id", "cliente_id"],
            ["clientes.restaurante_id", "clientes.id"],
            name="fk_crm_contatos_clientes_cliente_tenant",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "abordagem_tipo IN ('SEM_DESCONTO', 'CUPOM', 'FIDELIDADE')",
            name="ck_crm_contatos_abordagem_tipo",
        ),
        CheckConstraint(
            "canal IN ('WHATSAPP_MANUAL', 'TELEFONE', 'PRESENCIAL')",
            name="ck_crm_contatos_canal",
        ),
        CheckConstraint(
            "acao_executada IN ('MENSAGEM_COPIADA', 'WHATSAPP_ABERTO', "
            "'CONTATO_MANUAL_CONFIRMADO', 'IGNORADO')",
            name="ck_crm_contatos_acao_executada",
        ),
        Index(
            "ix_crm_contatos_tenant_cliente_criado",
            "restaurante_id",
            "cliente_id",
            "criado_em",
        ),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    campanha_id = Column(
        String(36),
        ForeignKey("crm_campanhas.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    cliente_id = Column(String, nullable=False, index=True)
    objetivo = Column(String(40), nullable=False, default="CUSTOM")
    abordagem_tipo = Column(String(32), nullable=False, default="SEM_DESCONTO")
    cupom_id = Column(String, ForeignKey("cupons.id", ondelete="SET NULL"), nullable=True)
    canal = Column(String(32), nullable=False, default="WHATSAPP_MANUAL")
    acao_executada = Column(String(32), nullable=False, default="CONTATO_MANUAL_CONFIRMADO")
    mensagem_personalizada = Column(Text, nullable=True)
    observacao = Column(String(500), nullable=True)
    registrado_por_id = Column(String, ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True)
    criado_em = Column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
        index=True,
    )

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
    JSON,
    Numeric,
    String,
    UniqueConstraint,
)

from .database import Base, current_restaurante_id


class RestauranteCapability(Base):
    """Entitlement comercial independente do nome do plano.

    Um restaurante pode receber uma capability por plano, add-on, trial, beta,
    promoção ou liberação manual. Nenhuma regra de negócio deve inferir acesso
    a partir de Pocket/Pro/Premium diretamente.
    """

    __tablename__ = "restaurante_capabilities"
    __table_args__ = (
        UniqueConstraint(
            "restaurante_id",
            "capability",
            name="uq_restaurante_capability",
        ),
        CheckConstraint(
            "source IN ('plano', 'addon', 'trial', 'beta', 'promo', 'manual')",
            name="ck_restaurante_capability_source",
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
    capability = Column(String(64), nullable=False)
    enabled = Column(Boolean, nullable=False, default=False)
    source = Column(String(16), nullable=False, default="manual")
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        onupdate=lambda: datetime.datetime.now(datetime.timezone.utc),
    )


class SmartPosPaymentIntent(Base):
    """Intenção operacional: ainda não é receita nem autorização da adquirente."""

    __tablename__ = "smartpos_payment_intents"
    __table_args__ = (
        ForeignKeyConstraint(
            ["restaurante_id", "mesa_id"],
            ["mesas.restaurante_id", "mesas.id"],
            name="fk_smartpos_intent_mesa_tenant",
            ondelete="RESTRICT",
        ),
        UniqueConstraint(
            "restaurante_id",
            "idempotency_key",
            name="uq_smartpos_intent_tenant_idempotency",
        ),
        CheckConstraint("valor > 0", name="ck_smartpos_intent_valor_positive"),
        CheckConstraint(
            "metodo IN ('dinheiro', 'pix', 'debito', 'credito', 'voucher', 'cartao')",
            name="ck_smartpos_intent_metodo",
        ),
        CheckConstraint(
            "captura IN ('provider_integrado', 'dinheiro_pendente', 'registro_externo')",
            name="ck_smartpos_intent_captura",
        ),
        CheckConstraint(
            "escopo IN ('valor', 'itens')",
            name="ck_smartpos_intent_escopo",
        ),
        CheckConstraint(
            "status IN ('criada', 'pendente', 'processando', 'aprovada', 'recusada', 'cancelada', 'expirada')",
            name="ck_smartpos_intent_status",
        ),
        Index(
            "ix_smartpos_intent_tenant_status",
            "restaurante_id",
            "status",
        ),
        Index(
            "ix_smartpos_intent_tenant_mesa",
            "restaurante_id",
            "mesa_id",
        ),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
    )
    turno_id = Column(
        Integer,
        ForeignKey("caixa_turnos.id", ondelete="RESTRICT"),
        nullable=False,
    )
    mesa_id = Column(Integer, nullable=False)
    operador_id = Column(
        String,
        ForeignKey("usuarios.id", ondelete="RESTRICT"),
        nullable=False,
    )
    valor = Column(Numeric(14, 2), nullable=False)
    metodo = Column(String(24), nullable=False)
    captura = Column(String(24), nullable=False, default="provider_integrado")
    escopo = Column(String(16), nullable=False, default="valor")
    item_ids = Column(JSON, nullable=True)
    idempotency_key = Column(String(128), nullable=False)
    status = Column(String(24), nullable=False, default="criada")
    status_em = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
    )
    provider_name = Column(String(32), nullable=True)
    provider_operation_key = Column(String(128), nullable=True)
    provider_terminal_id = Column(String(64), nullable=True)
    provider_reference = Column(String(128), nullable=True)
    provider_last_error = Column(String(255), nullable=True)
    origem = Column(String(24), nullable=False, default="smartpos")
    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
    )


class SmartPosPaymentIntentEvent(Base):
    """Trilha imutável das transições do PaymentIntent."""

    __tablename__ = "smartpos_payment_intent_events"
    __table_args__ = (
        UniqueConstraint(
            "restaurante_id",
            "intent_id",
            "transition_key",
            name="uq_smartpos_intent_event_transition_key",
        ),
        CheckConstraint(
            "from_status IN ('criada', 'pendente', 'processando', 'aprovada', 'recusada', 'cancelada', 'expirada')",
            name="ck_smartpos_event_from_status",
        ),
        CheckConstraint(
            "to_status IN ('criada', 'pendente', 'processando', 'aprovada', 'recusada', 'cancelada', 'expirada')",
            name="ck_smartpos_event_to_status",
        ),
        Index(
            "ix_smartpos_event_tenant_intent",
            "restaurante_id",
            "intent_id",
        ),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
    )
    intent_id = Column(
        String(36),
        ForeignKey("smartpos_payment_intents.id", ondelete="CASCADE"),
        nullable=False,
    )
    from_status = Column(String(24), nullable=False)
    to_status = Column(String(24), nullable=False)
    actor_id = Column(String, nullable=True)
    transition_key = Column(String(128), nullable=False)
    motivo = Column(String(255), nullable=True)
    criado_em = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
    )

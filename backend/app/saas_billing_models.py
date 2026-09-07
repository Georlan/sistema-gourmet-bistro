from __future__ import annotations

import datetime
import uuid

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    text,
)

from .contract_models import ContractEvidenceBase
from .database import Base, current_restaurante_id


class SaaSBillingSetup(ContractEvidenceBase):
    """
    Setup ou intenção de cobrança SaaS antes da ativação do restaurante.
    Nasce na fase pública de contratação e armazena o status da configuração
    financeira (ex.: cartão tokenizado no gateway ou Pix anual emitido/pago).
    NUNCA armazena PAN completo ou CVV.
    """

    __tablename__ = "saas_billing_setups"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    protocol = Column(String(64), nullable=False, unique=True, index=True)
    contract_acceptance_id = Column(
        String(36),
        ForeignKey("contract_acceptances.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # FK para restaurantes é criada pela migração Alembic explícita. Não declaramos
    # ForeignKey aqui porque a tabela alvo vive em Base.metadata separado por design.
    restaurante_id = Column(Integer, nullable=True, index=True)

    provider = Column(String(32), nullable=False, default="mercado_pago")
    payment_method_type = Column(String(32), nullable=False, default="credit_card")
    # Status: pending | ready | failed | canceled
    status = Column(String(32), nullable=False, default="pending", index=True)

    provider_customer_id = Column(String(100), nullable=True)
    provider_payment_method_reference = Column(String(100), nullable=True)
    provider_subscription_id = Column(String(100), nullable=True)
    billing_cycle = Column(String(16), nullable=True)  # monthly | annual

    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        onupdate=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        Index("ix_saas_billing_setups_protocol_status", "protocol", "status"),
        CheckConstraint(
            "status IN ('pending', 'ready', 'failed', 'canceled')",
            name="ck_saas_billing_setups_status",
        ),
        CheckConstraint(
            "provider IN ('mercado_pago')",
            name="ck_saas_billing_setups_provider",
        ),
        CheckConstraint(
            "payment_method_type IN ('credit_card', 'pix')",
            name="ck_saas_billing_setups_payment_method",
        ),
        CheckConstraint(
            "billing_cycle IS NULL OR billing_cycle IN ('monthly', 'annual', 'mensal', 'anual')",
            name="ck_saas_billing_setups_billing_cycle",
        ),
        Index(
            "uq_saas_billing_setups_provider_sub",
            "provider",
            "provider_subscription_id",
            unique=True,
            postgresql_where=text("provider_subscription_id IS NOT NULL"),
            sqlite_where=text("provider_subscription_id IS NOT NULL"),
        ),
    )


class SaaSSubscription(Base):
    """
    Assinatura canônica do tenant KÔMA após a ativação.
    Fonte de verdade sobre período vigente, status e grace period.
    """

    __tablename__ = "saas_subscriptions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        unique=True,
        index=True,
    )
    provider = Column(String(32), nullable=False, default="mercado_pago")
    provider_customer_id = Column(String(100), nullable=True)
    provider_subscription_id = Column(String(100), nullable=True)
    payment_method_type = Column(String(32), nullable=True)
    billing_cycle = Column(String(16), nullable=False, default="monthly")
    # Status: trialing | active | past_due | canceled | suspended
    status = Column(String(32), nullable=False, default="trialing", index=True)

    trial_started_at = Column(DateTime(timezone=True), nullable=True)
    trial_ends_at = Column(DateTime(timezone=True), nullable=True)
    current_period_start = Column(DateTime(timezone=True), nullable=True)
    current_period_end = Column(DateTime(timezone=True), nullable=True)
    grace_until = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        onupdate=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('trialing', 'active', 'past_due', 'canceled', 'suspended')",
            name="ck_saas_subscriptions_status",
        ),
        CheckConstraint(
            "provider IN ('mercado_pago')",
            name="ck_saas_subscriptions_provider",
        ),
        CheckConstraint(
            "billing_cycle IN ('monthly', 'annual', 'mensal', 'anual')",
            name="ck_saas_subscriptions_billing_cycle",
        ),
        CheckConstraint(
            "payment_method_type IS NULL OR payment_method_type IN ('credit_card', 'pix')",
            name="ck_saas_subscriptions_payment_method",
        ),
        Index(
            "uq_saas_subscriptions_provider_sub",
            "provider",
            "provider_subscription_id",
            unique=True,
            postgresql_where=text("provider_subscription_id IS NOT NULL"),
            sqlite_where=text("provider_subscription_id IS NOT NULL"),
        ),
    )

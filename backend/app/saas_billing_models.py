from __future__ import annotations

import datetime
import uuid

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
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
    contract_acceptance_id = Column(String(36), nullable=True, index=True)
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

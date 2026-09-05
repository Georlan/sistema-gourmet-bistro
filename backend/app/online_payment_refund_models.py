from __future__ import annotations

import datetime
import uuid

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)

from .database import Base, current_restaurante_id


class OnlinePaymentRefund(Base):
    """Reembolso externo persistente de um pagamento online.

    A linha nasce antes da chamada ao provedor e funciona como reserva/idempotência.
    O estorno financeiro local só é ligado em ``estorno_id`` depois que o provedor
    confirma a devolução.
    """

    __tablename__ = "online_payment_refunds"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurante_id = Column(
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    intent_id = Column(
        String(36),
        ForeignKey("online_payment_intents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    pagamento_id = Column(
        String,
        ForeignKey("pagamentos.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    estorno_id = Column(
        String,
        ForeignKey("pagamento_estornos.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    provider = Column(String(32), nullable=False, default="mercado_pago")
    external_payment_id = Column(String(128), nullable=False)
    external_refund_id = Column(String(128), nullable=True)
    amount = Column(Numeric(14, 2, asdecimal=False), nullable=False)
    status = Column(String(20), nullable=False, default="requested")
    provider_status = Column(String(32), nullable=True)
    idempotency_key = Column(String(128), nullable=False)
    provider_idempotency_key = Column(String(64), nullable=False)
    request_fingerprint = Column(String(64), nullable=False)
    error_message = Column(Text, nullable=True)
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
            "provider IN ('mercado_pago')",
            name="ck_online_payment_refunds_provider",
        ),
        CheckConstraint(
            "status IN ('requested', 'confirmed', 'failed')",
            name="ck_online_payment_refunds_status",
        ),
        CheckConstraint("amount > 0", name="ck_online_payment_refunds_amount"),
        UniqueConstraint(
            "restaurante_id",
            "idempotency_key",
            name="uq_online_payment_refunds_tenant_idempotency",
        ),
        UniqueConstraint(
            "provider",
            "external_refund_id",
            name="uq_online_payment_refunds_provider_refund",
        ),
        UniqueConstraint(
            "provider",
            "provider_idempotency_key",
            name="uq_online_payment_refunds_provider_idempotency",
        ),
        UniqueConstraint(
            "restaurante_id",
            "estorno_id",
            name="uq_online_payment_refunds_tenant_estorno",
        ),
        Index(
            "ix_online_payment_refunds_tenant_payment_status",
            "restaurante_id",
            "pagamento_id",
            "status",
            "created_at",
        ),
    )

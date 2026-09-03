import datetime

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint

from .database import Base, current_restaurante_id


class RestaurantSubscription(Base):
    """Estado contratual da mensalidade fixa do KÔMA por restaurante.

    Esta tabela não representa pagamento recebido. Ela registra o contrato
    comercial administrado pelo Super Admin; eventos financeiros de cobrança
    entrarão em uma etapa posterior e não são inferidos deste estado.
    """

    __tablename__ = "restaurant_subscriptions"
    __table_args__ = (
        UniqueConstraint("restaurante_id", name="uq_restaurant_subscriptions_restaurante_id"),
        CheckConstraint(
            "status IN ('not_configured', 'active', 'past_due', 'canceled')",
            name="ck_restaurant_subscriptions_status",
        ),
        CheckConstraint(
            "billing_cycle IS NULL OR billing_cycle IN ('monthly', 'annual')",
            name="ck_restaurant_subscriptions_billing_cycle",
        ),
        CheckConstraint(
            "source IN ('admin', 'provider')",
            name="ck_restaurant_subscriptions_source",
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
    plan_code = Column(String(32), nullable=True)
    billing_cycle = Column(String(16), nullable=True)
    status = Column(String(24), nullable=False, default="not_configured", server_default="not_configured")
    period_amount_cents = Column(Integer, nullable=True)
    source = Column(String(16), nullable=False, default="admin", server_default="admin")
    current_period_end = Column(DateTime(timezone=True), nullable=True)
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

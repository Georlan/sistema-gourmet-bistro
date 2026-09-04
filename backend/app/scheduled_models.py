import datetime
import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint

from .database import Base, current_restaurante_id


class ScheduledOrder(Base):
    __tablename__ = "scheduled_orders"
    __table_args__ = (
        UniqueConstraint(
            "restaurante_id",
            "comanda_id",
            name="uq_scheduled_orders_tenant_comanda",
        ),
        Index(
            "ix_scheduled_orders_due",
            "restaurante_id",
            "released_at",
            "scheduled_for",
        ),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        default=lambda: current_restaurante_id.get(),
    )
    comanda_id = Column(
        String,
        ForeignKey("comandas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    scheduled_for = Column(DateTime(timezone=True), nullable=False)
    released_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
    )

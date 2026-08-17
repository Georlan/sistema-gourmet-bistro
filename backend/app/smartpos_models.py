import datetime

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint

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

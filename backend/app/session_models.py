import datetime

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func

from .database import Base, current_restaurante_id


class UserSessionVersion(Base):
    """Geração persistente dos JWTs operacionais de um usuário de tenant.

    Ausência de linha equivale à geração 1, preservando tokens emitidos antes da
    implantação desta camada. A primeira revogação cria a linha já na geração 2.
    """

    __tablename__ = "user_session_versions"
    __table_args__ = (
        CheckConstraint(
            "token_version >= 1",
            name="ck_user_session_versions_positive",
        ),
        UniqueConstraint(
            "restaurante_id",
            "user_id",
            name="uq_user_session_versions_tenant_user",
        ),
        Index(
            "ix_user_session_versions_tenant_user",
            "restaurante_id",
            "user_id",
        ),
    )

    user_id = Column(
        String,
        ForeignKey("usuarios.id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
    )
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
    )
    token_version = Column(
        Integer,
        default=1,
        server_default="1",
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        server_default=func.now(),
        onupdate=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    )

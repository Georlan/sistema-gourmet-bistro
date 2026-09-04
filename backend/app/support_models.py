import datetime

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)

from .database import Base, current_restaurante_id


class SupportSession(Base):
    """Sessão de suporte administrativo temporária e auditada do KÔMA.

    Permite que operadores autorizados da plataforma entrem no contexto operacional
    de um tenant para diagnóstico e resolução de problemas, com expiração estrita,
    motivo obrigatório, revogação instantânea e auditoria append-only.
    """

    __tablename__ = "support_sessions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'ended', 'expired')",
            name="ck_support_sessions_status",
        ),
        CheckConstraint(
            "duration_minutes >= 1 AND duration_minutes <= 120",
            name="ck_support_sessions_duration",
        ),
        Index("ix_support_sessions_tenant_status", "restaurante_id", "status"),
        Index("ix_support_sessions_token_jti", "token_jti"),
    )

    id = Column(String(64), primary_key=True)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    operator = Column(String(255), nullable=False)
    reason = Column(Text, nullable=False)
    duration_minutes = Column(Integer, default=30, nullable=False)
    token_jti = Column(String(64), nullable=False, unique=True)
    status = Column(String(32), default="active", nullable=False)
    started_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    )
    expires_at = Column(DateTime(timezone=True), nullable=False)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        server_default=func.now(),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        server_default=func.now(),
        onupdate=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    )


class SupportOperatorUser:
    """Representa a identidade de um operador KÔMA atuando em Modo Suporte.

    Não possui senha, hash ou registro na tabela de usuários do tenant.
    É instanciado em tempo de execução somente após validação criptográfica
    do JWT de suporte e consulta de vigência na tabela ``support_sessions``.
    """

    def __init__(
        self,
        *,
        operator: str,
        restaurante_id: int,
        session_id: str,
        reason: str,
    ):
        self.id = f"support:{operator}"
        self.nome = f"Suporte KÔMA ({operator})"
        self.email = str(operator)
        self.telefone = None
        self.cargo = "admin"
        self.role = "admin"
        self.restaurante_id = int(restaurante_id)
        self.status = "ativo"
        self.is_support_mode = True
        self.support_session_id = str(session_id)
        self.support_operator = str(operator)
        self.support_reason = str(reason)

    def __repr__(self) -> str:
        return f"<SupportOperatorUser {self.id} tenant={self.restaurante_id}>"


import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
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


class CustomerSupportFeedback(Base):
    """Mensagem enviada por um usuário autenticado do restaurante ao suporte KÔMA.

    O registro é tenant-scoped e permanece salvo mesmo quando os canais de aviso
    do operador KÔMA (e-mail/WhatsApp) estiverem temporariamente indisponíveis.
    """

    __tablename__ = "customer_support_feedback"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('question', 'suggestion', 'complaint', 'problem')",
            name="ck_customer_support_feedback_kind",
        ),
        CheckConstraint(
            "status IN ('new', 'read', 'resolved')",
            name="ck_customer_support_feedback_status",
        ),
        Index(
            "ix_customer_support_feedback_tenant_status_created",
            "restaurante_id",
            "status",
            "created_at",
        ),
    )

    id = Column(String(36), primary_key=True)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    reporter_user_id = Column(String(64), nullable=False)
    reporter_name = Column(String(255), nullable=True)
    reporter_role = Column(String(64), nullable=True)
    kind = Column(String(20), nullable=False)
    message = Column(Text, nullable=False)
    page_path = Column(String(300), nullable=True)
    context_metadata = Column(JSON, nullable=True)
    status = Column(String(20), default="new", nullable=False)
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


class SupportInvestigation(Base):
    """Registro durável de investigação de incidente ou possível bug do KÔMA."""

    __tablename__ = "support_investigations"
    __table_args__ = (
        CheckConstraint(
            "source IN ('customer_support', 'availability_worker', 'manual')",
            name="ck_support_investigations_source",
        ),
        CheckConstraint(
            "severity IN ('critical', 'high', 'medium', 'low')",
            name="ck_support_investigations_severity",
        ),
        CheckConstraint(
            "status IN ('queued', 'collecting', 'prepared', 'analyzing', 'completed', 'failed')",
            name="ck_support_investigations_status",
        ),
        CheckConstraint(
            "occurrence_count >= 1 AND attempts >= 0 AND max_attempts >= 1 AND max_attempts <= 10",
            name="ck_support_investigations_bounds",
        ),
        Index("ix_support_investigations_dedup_key", "dedup_key"),
        Index("ix_support_investigations_status_created", "status", "created_at"),
    )

    id = Column(String(40), primary_key=True)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    feedback_id = Column(
        String(36),
        ForeignKey("customer_support_feedback.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    source = Column(String(32), nullable=False, default="customer_support")
    dedup_key = Column(String(128), nullable=False)
    domain = Column(String(48), nullable=False, default="geral")
    severity = Column(String(16), nullable=False, default="medium")
    status = Column(String(24), nullable=False, default="prepared")
    evidence_status = Column(String(48), nullable=True)
    suspected_bug = Column(Boolean, nullable=False, default=False)
    occurrence_count = Column(Integer, nullable=False, default=1)
    attempts = Column(Integer, nullable=False, default=0)
    max_attempts = Column(Integer, nullable=False, default=3)
    untrusted_summary = Column(Text, nullable=True)
    evidence_snapshot = Column(JSON, nullable=True)
    initial_diagnosis = Column(JSON, nullable=True)
    agent_result = Column(JSON, nullable=True)
    last_error = Column(Text, nullable=True)
    last_seen_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        server_default=func.now(),
        nullable=False,
    )
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

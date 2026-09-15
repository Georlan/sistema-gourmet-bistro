from __future__ import annotations

import datetime
import uuid

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    JSON,
    String,
    Text,
    UniqueConstraint,
)

from .database import Base


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


class FiscalOfficialReferenceSnapshot(Base):
    """Snapshot imutável de uma publicação oficial observada pelo Fiscal Core.

    O snapshot guarda a identidade criptográfica e, quando disponível, o payload
    oficial normalizado que originou o hash. Registros existentes nunca são
    atualizados pelo watcher; uma nova publicação sempre cria uma nova linha.
    """

    __tablename__ = "fiscal_official_reference_snapshots"
    __table_args__ = (
        UniqueConstraint(
            "source_key",
            "identity_sha256",
            name="uq_fiscal_official_reference_snapshot_identity",
        ),
        Index(
            "ix_fiscal_official_reference_snapshot_source_observed",
            "source_key",
            "observed_at",
        ),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    source_key = Column(String(64), nullable=False)
    source_url = Column(Text, nullable=False)
    source_version = Column(String(160), nullable=True)
    content_sha256 = Column(String(64), nullable=True)
    identity_sha256 = Column(String(64), nullable=False)
    metadata_json = Column(JSON, nullable=True)
    payload_json = Column(JSON, nullable=True)
    effective_dates_json = Column(JSON, nullable=True)
    observed_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)


class FiscalOfficialReferenceState(Base):
    """Estado global das fontes oficiais observadas pelo Fiscal Core.

    `observed_*` representa o que a fonte oficial publica agora. `active_*`
    representa a baseline que o KÔMA validou e está autorizado a usar. Uma
    atualização detectada nunca substitui `active_*` silenciosamente.
    """

    __tablename__ = "fiscal_official_reference_states"
    __table_args__ = (
        CheckConstraint(
            "status IN ('current','changed','error')",
            name="ck_fiscal_official_reference_state_status",
        ),
    )

    source_key = Column(String(64), primary_key=True)
    source_url = Column(Text, nullable=False)

    observed_version = Column(String(160), nullable=True)
    observed_sha256 = Column(String(64), nullable=True)
    active_version = Column(String(160), nullable=True)
    active_sha256 = Column(String(64), nullable=True)
    observed_snapshot_id = Column(
        String(36),
        ForeignKey("fiscal_official_reference_snapshots.id", ondelete="RESTRICT"),
        nullable=True,
    )
    active_snapshot_id = Column(
        String(36),
        ForeignKey("fiscal_official_reference_snapshots.id", ondelete="RESTRICT"),
        nullable=True,
    )

    status = Column(String(16), nullable=False, default="current")
    metadata_json = Column(JSON, nullable=True)
    last_error = Column(Text, nullable=True)
    checked_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    changed_at = Column(DateTime(timezone=True), nullable=True)
    promoted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

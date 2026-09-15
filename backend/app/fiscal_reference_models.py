from __future__ import annotations

import datetime

from sqlalchemy import CheckConstraint, Column, DateTime, JSON, String, Text

from .database import Base


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


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

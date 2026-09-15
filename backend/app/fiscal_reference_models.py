from __future__ import annotations

import datetime

from sqlalchemy import CheckConstraint, Column, DateTime, JSON, String, Text

from .database import Base


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


class FiscalOfficialReferenceState(Base):
    """Estado global das fontes oficiais observadas pelo Fiscal Core.

    Esta tabela não é tenant-scoped: NCM, Calculadora RTC e documentação nacional
    são referências compartilhadas por todos os restaurantes. Uma mudança detectada
    nunca é promovida silenciosamente para regra ativa; ela apenas muda o estado
    para ``changed`` até que a versão seja validada pelo fluxo fiscal.
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
    source_version = Column(String(160), nullable=True)
    content_sha256 = Column(String(64), nullable=True)
    status = Column(String(16), nullable=False, default="current")
    metadata_json = Column(JSON, nullable=True)
    last_error = Column(Text, nullable=True)
    checked_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    changed_at = Column(DateTime(timezone=True), nullable=True)
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

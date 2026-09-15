from __future__ import annotations

import datetime
import uuid

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)

from .database import Base, current_restaurante_id


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


class FiscalCredentialSecret(Base):
    """Vault cifrado tenant-scoped para material fiscal sensível.

    O perfil fiscal guarda somente referências `dbenc://...`. O conteúdo desta
    tabela é sempre ciphertext Fernet e nunca deve ser serializado em respostas,
    logs ou eventos.
    """

    __tablename__ = "fiscal_credential_secrets"
    __table_args__ = (
        UniqueConstraint(
            "restaurante_id",
            "kind",
            name="uq_fiscal_credential_secret_tenant_kind",
        ),
        CheckConstraint(
            "kind IN ('certificate_a1','csc')",
            name="ck_fiscal_credential_secret_kind",
        ),
        Index(
            "ix_fiscal_credential_secret_tenant_kind",
            "restaurante_id",
            "kind",
        ),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
    )
    kind = Column(String(32), nullable=False)
    ciphertext = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=_utcnow,
        onupdate=_utcnow,
    )

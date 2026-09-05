from __future__ import annotations

import datetime
import uuid

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import declarative_base

from .database import Base, current_restaurante_id


# A evidência de aceite nasce antes do tenant e não é uma entidade multi-tenant.
# Mantê-la fora de Base.metadata evita tratá-la acidentalmente como tabela de
# domínio tenant-scoped. A migração Alembic explícita é a fonte do esquema.
ContractEvidenceBase = declarative_base()


class ContractAcceptance(ContractEvidenceBase):
    """Evidência append-only do clickwrap, global e sem leitura direta do runtime."""

    __tablename__ = "contract_acceptances"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    protocol = Column(String(64), nullable=False, unique=True, index=True)
    request_id = Column(String(36), nullable=False, unique=True, index=True)

    contracting_party_name = Column(String(255), nullable=False)
    contracting_party_tax_id_encrypted = Column(Text, nullable=False)
    contracting_party_tax_id_last4 = Column(String(4), nullable=False)
    restaurant_name = Column(String(255), nullable=False)
    representative_name = Column(String(255), nullable=False)
    representative_tax_id_encrypted = Column(Text, nullable=False)
    representative_tax_id_last4 = Column(String(4), nullable=False)
    representative_role = Column(String(100), nullable=False)
    email = Column(String(255), nullable=False)
    phone = Column(String(50), nullable=False)

    plan = Column(String(20), nullable=False)
    billing_cycle = Column(String(16), nullable=False)
    fixed_monthly_price = Column(Numeric(12, 2), nullable=False)
    billing_amount = Column(Numeric(12, 2), nullable=False)
    annual_monthly_equivalent = Column(Numeric(12, 2), nullable=True)
    marketplace_rate = Column(Numeric(8, 6), nullable=False)

    legal_version = Column(String(16), nullable=False)
    terms_hash = Column(String(64), nullable=False)
    commercial_hash = Column(String(64), nullable=False)
    dpa_hash = Column(String(64), nullable=False)
    privacy_hash = Column(String(64), nullable=False)
    terms_snapshot = Column(Text, nullable=False)
    commercial_snapshot = Column(Text, nullable=False)
    dpa_snapshot = Column(Text, nullable=False)
    privacy_snapshot = Column(Text, nullable=False)
    legal_source_commit = Column(String(40), nullable=False)
    legal_source_blob_sha = Column(String(40), nullable=False)

    powers_declared = Column(Boolean, nullable=False, default=True)
    accepted_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
        index=True,
    )
    source_ip_encrypted = Column(Text, nullable=False)
    source_ip_hash = Column(String(64), nullable=False)
    user_agent = Column(Text, nullable=False)
    user_agent_hash = Column(String(64), nullable=False)
    receipt_snapshot_encrypted = Column(Text, nullable=False)

    __table_args__ = (
        Index(
            "ix_contract_acceptances_email_accepted",
            "email",
            "accepted_at",
        ),
    )


class RestaurantContractAcceptance(Base):
    """Vínculo tenant-scoped entre restaurante e um aceite global já congelado."""

    __tablename__ = "restaurant_contract_acceptances"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    # FK para a tabela global é criada pela migração explícita. Não declaramos
    # ForeignKey aqui porque a tabela alvo vive em metadata separado por design.
    acceptance_id = Column(String(36), nullable=False, unique=True, index=True)
    linked_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "restaurante_id",
            "acceptance_id",
            name="uq_restaurant_contract_acceptance_link",
        ),
        Index(
            "ix_restaurant_contract_acceptances_tenant_linked",
            "restaurante_id",
            "linked_at",
        ),
    )

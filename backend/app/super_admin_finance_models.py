"""Owner finances are global, separate from restaurant operational data."""
import datetime as dt
import uuid
from sqlalchemy import Column, DateTime, Integer, JSON, Numeric, String, UniqueConstraint
from sqlalchemy.orm import declarative_base
from .config import settings

FinanceBase = declarative_base()
FINANCE_SCHEMA = None if settings.DATABASE_URL.startswith('sqlite') else 'koma_internal'


class OwnerFinanceMonth(FinanceBase):
    __tablename__ = 'super_admin_finance_months'
    __table_args__ = {'schema': FINANCE_SCHEMA}
    period = Column(String(7), primary_key=True)
    costs = Column(JSON, nullable=False)
    actor = Column(String(254), nullable=False)
    reason = Column(String(1000), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: dt.datetime.now(dt.timezone.utc))


class OwnerFinanceAudit(FinanceBase):
    __tablename__ = 'super_admin_finance_audit'
    __table_args__ = {'schema': FINANCE_SCHEMA}
    id = Column(String(36), primary_key=True)
    period = Column(String(7), nullable=False, index=True)
    before_data = Column(JSON, nullable=True)
    after_data = Column(JSON, nullable=False)
    actor = Column(String(254), nullable=False)
    reason = Column(String(1000), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: dt.datetime.now(dt.timezone.utc))


class SaaSCompanyReceipt(FinanceBase):
    """Idempotent ledger of KÔMA company receipts (subscriptions, VIP setup, modules)."""

    __tablename__ = 'super_admin_company_receipts'
    __table_args__ = (
        UniqueConstraint('provider', 'external_reference', name='uq_company_receipts_provider_ref'),
        {'schema': FINANCE_SCHEMA},
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurante_id = Column(Integer, nullable=False, index=True)
    source_type = Column(String(32), nullable=False)  # mp_recurring_payment | vip_onboarding | addon_module | manual_adjustment
    provider = Column(String(32), nullable=False)  # mercado_pago | pix | manual
    external_reference = Column(String(128), nullable=False)
    plan_code = Column(String(20), nullable=True)
    payment_method = Column(String(32), nullable=False)  # pix | credit_card | account_money | other
    status = Column(String(24), nullable=False, default='paid')  # open | paid | overdue | refunded
    competence_period = Column(String(7), nullable=False, index=True)
    gross_amount = Column(Numeric(12, 2), nullable=False)
    received_at = Column(DateTime(timezone=True), nullable=True)
    due_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: dt.datetime.now(dt.timezone.utc))

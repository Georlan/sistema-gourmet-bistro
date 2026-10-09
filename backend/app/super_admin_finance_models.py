"""Owner finances are global, separate from restaurant operational data."""
import datetime as dt
from sqlalchemy import Column, DateTime, JSON, String
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

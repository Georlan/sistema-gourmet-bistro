"""Recorded company receipts and owner supplied costs, never restaurant sales."""
import datetime as dt
import uuid
import re
from decimal import Decimal
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from ..database import SessionLocal, tenant_session_scope
from ..models import DirectPixFeeInvoice
from ..super_admin_finance_models import OwnerFinanceAudit, OwnerFinanceMonth
from .super_admin import _discover_restaurant_ids, get_current_admin

router = APIRouter(prefix='/api/super-admin/finance', tags=['SuperAdmin'])
COST_CATEGORIES = ('chatgpt', 'database', 'railway', 'tools', 'taxes', 'other')


class CostUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    costs: dict[str, Decimal | None]
    reason: str = Field(min_length=3, max_length=1000)

    @field_validator('costs')
    @classmethod
    def valid_costs(cls, values):
        if set(values) != set(COST_CATEGORIES):
            raise ValueError('Informe todas as categorias; use null para custos desconhecidos.')
        for value in values.values():
            if value is not None and (not value.is_finite() or value < 0 or value > 1000000 or value != value.quantize(Decimal('.01'))):
                raise ValueError('Custos devem ser valores em reais entre 0 e 1.000.000 com até 2 decimais.')
        return values

    @field_validator('reason')
    @classmethod
    def valid_reason(cls, value):
        if len(value.strip()) < 3:
            raise ValueError('Informe um motivo.')
        return value.strip()


def month_bounds(period):
    try:
        year, month = map(int, period.split('-'))
        start = dt.datetime(year, month, 1, tzinfo=ZoneInfo('America/Fortaleza'))
        end = start.replace(year=year + 1, month=1) if month == 12 else start.replace(month=month + 1)
        return start.astimezone(dt.timezone.utc), end.astimezone(dt.timezone.utc)
    except (ValueError, OverflowError):
        raise HTTPException(422, 'Mês inválido.')


@router.get('')
def finance_summary(period: str = Query(pattern=r'^20\d{2}-\d{2}$'), admin=Depends(get_current_admin)):
    start, end = month_bounds(period)
    with SessionLocal() as db:
        company_month = db.get(OwnerFinanceMonth, period)
        costs = company_month.costs if company_month else {key: None for key in COST_CATEGORIES}
        cost_updated_at = company_month.updated_at.isoformat() if company_month else None
        receipts = Decimal('0'); outstanding = Decimal('0'); rows = []
        for tenant_id in _discover_restaurant_ids(db):
            with tenant_session_scope(db, tenant_id):
                amount = DirectPixFeeInvoice.fees + DirectPixFeeInvoice.subscription_amount
                received = Decimal(str(db.query(func.coalesce(func.sum(amount), 0)).filter(
                    DirectPixFeeInvoice.restaurante_id == tenant_id, DirectPixFeeInvoice.status == 'paid',
                    DirectPixFeeInvoice.paid_at >= start, DirectPixFeeInvoice.paid_at < end).scalar()))
                open_amount = Decimal(str(db.query(func.coalesce(func.sum(amount), 0)).filter(
                    DirectPixFeeInvoice.restaurante_id == tenant_id, DirectPixFeeInvoice.status == 'open',
                    DirectPixFeeInvoice.period == period).scalar()))
                receipts += received; outstanding += open_amount
                rows.append({'tenant_id': str(tenant_id), 'received': str(received), 'outstanding': str(open_amount)})
        known_costs = sum((Decimal(value) for value in costs.values() if value is not None), Decimal('0'))
        unknown = [key for key, value in costs.items() if value is None]
        return {'period': period, 'received': str(receipts), 'outstanding': str(outstanding), 'tenants': rows,
                'costs': costs, 'known_costs': str(known_costs), 'unknown_costs': unknown,
                'recorded_result': str(receipts - known_costs) if not unknown else None,
                'coverage': 'Faturas consolidadas KÔMA pagas no mês. Recebimentos avulsos e pagamentos recorrentes externos não estão incluídos; resultado registrado não comprova lucro total.',
                'cost_updated_at': cost_updated_at}


@router.put('/costs/{period}')
def save_costs(period: str, payload: CostUpdate, admin=Depends(get_current_admin)):
    if not re.fullmatch(r'20\d{2}-\d{2}', period):
        raise HTTPException(422, 'Mês inválido.')
    month_bounds(period)
    values = {key: str(value) if value is not None else None for key, value in payload.costs.items()}
    with SessionLocal() as db:
        row = db.query(OwnerFinanceMonth).filter_by(period=period).with_for_update().one_or_none()
        before = dict(row.costs) if row else None
        if row is None:
            row = OwnerFinanceMonth(period=period)
            db.add(row)
        row.costs = values; row.actor = str(admin['user']); row.reason = payload.reason
        row.updated_at = dt.datetime.now(dt.timezone.utc)
        db.add(OwnerFinanceAudit(id=str(uuid.uuid4()), period=period, before_data=before,
            after_data=values, actor=row.actor, reason=payload.reason))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, 'O mês foi atualizado em paralelo. Recarregue antes de salvar.')
        return {'period': period, 'costs': values, 'saved': True}

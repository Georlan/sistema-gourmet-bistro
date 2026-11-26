"""Recorded company receipts and owner supplied costs, never restaurant sales."""
import datetime as dt
import uuid
import re
from decimal import Decimal, ROUND_CEILING
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from ..database import SessionLocal, tenant_session_scope
from ..models import DirectPixFeeInvoice, Restaurante
from ..saas_billing_models import SaaSSubscription
from ..services.billing_service import (
    effective_catalog_monthly_price,
    tenant_commercial_terms,
    tenant_founders_benefit,
)
from ..super_admin_finance_models import OwnerFinanceAudit, OwnerFinanceMonth, SaaSCompanyReceipt
from .super_admin import _discover_restaurant_ids, get_current_admin

router = APIRouter(prefix='/api/super-admin/finance', tags=['SuperAdmin'])
COST_CATEGORIES = ('chatgpt', 'database', 'railway', 'tools', 'taxes', 'other')
FIXED_COST_CATEGORIES = ('chatgpt', 'database', 'railway', 'tools')
VARIABLE_COST_CATEGORIES = ('taxes', 'other')
PLAN_BUCKETS = ('pocket', 'pro', 'premium', 'founders', 'other')


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


def _as_utc(value: dt.datetime | None) -> dt.datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=dt.timezone.utc)
    return value.astimezone(dt.timezone.utc)


def _zero_money() -> Decimal:
    return Decimal('0.00')


def _build_finance_snapshot(db, period: str) -> dict:
    start, end = month_bounds(period)
    now = dt.datetime.now(dt.timezone.utc)
    company_month = db.get(OwnerFinanceMonth, period)
    costs = company_month.costs if company_month else {key: None for key in COST_CATEGORIES}
    cost_updated_at = company_month.updated_at.isoformat() if company_month else None

    mrr_contracted = _zero_money()
    mrr_by_plan = {k: _zero_money() for k in PLAN_BUCKETS}
    recurring_received_by_plan = {k: _zero_money() for k in PLAN_BUCKETS}
    received_by_channel = {'pix': _zero_money(), 'credit_card': _zero_money(), 'account_money': _zero_money(), 'other': _zero_money()}
    received_by_source = {'recurring_plans': _zero_money(), 'vip_onboarding': _zero_money(), 'modules': _zero_money(), 'direct_pix_fees': _zero_money(), 'other': _zero_money()}
    invoices = {
        'open': {'count': 0, 'amount': _zero_money()},
        'overdue': {'count': 0, 'amount': _zero_money()},
        'paid': {'count': 0, 'amount': _zero_money()},
        'refunded': {'count': 0, 'amount': _zero_money()},
    }
    tenant_counts = {
        'total': 0,
        'paying': 0,
        'founders': 0,
        'trialing': 0,
        'onboarding': 0,
        'free_or_legacy': 0,
        'suspended': 0,
    }
    tenant_rows_map: dict[int, dict[str, Decimal]] = {}
    receipts = _zero_money()
    outstanding = _zero_money()

    for tenant_id in _discover_restaurant_ids(db):
        tenant_counts['total'] += 1
        tenant_paid = _zero_money()
        tenant_open = _zero_money()
        with tenant_session_scope(db, tenant_id):
            rest = db.query(Restaurante).filter(Restaurante.id == tenant_id).first()
            sub = db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == tenant_id).first()
            terms = tenant_commercial_terms(db, tenant_id)
            founder = tenant_founders_benefit(db, tenant_id)

            if (rest is not None and rest.saas_status == 'suspended') or (sub is not None and sub.status in {'canceled', 'suspended'}):
                tenant_counts['suspended'] += 1
            elif rest is not None and rest.billing_mode == 'legacy':
                tenant_counts['free_or_legacy'] += 1
            elif sub is not None and sub.status == 'trialing':
                tenant_counts['trialing'] += 1
            elif sub is not None and sub.status == 'onboarding':
                tenant_counts['onboarding'] += 1
            elif sub is not None and sub.status in {'active', 'past_due'}:
                tenant_counts['paying'] += 1
                if founder is not None and founder.active:
                    tenant_counts['founders'] += 1
                    monthly_eq = Decimal(str(terms.annual_monthly_equivalent)) if terms is not None else Decimal('79.90')
                    mrr_contracted += monthly_eq
                    mrr_by_plan['founders'] += monthly_eq
                elif terms is not None:
                    monthly_eq = Decimal(str(terms.annual_monthly_equivalent))
                    bucket = terms.plan if terms.plan in PLAN_BUCKETS else 'other'
                    mrr_contracted += monthly_eq
                    mrr_by_plan[bucket] += monthly_eq
                elif rest is not None:
                    monthly_eq = effective_catalog_monthly_price(db, tenant_id, rest.plano)
                    bucket = rest.plano if rest.plano in PLAN_BUCKETS else 'other'
                    mrr_contracted += monthly_eq
                    mrr_by_plan[bucket] += monthly_eq
            else:
                tenant_counts['free_or_legacy'] += 1

            dp_paid_rows = (
                db.query(DirectPixFeeInvoice)
                .filter(
                    DirectPixFeeInvoice.restaurante_id == tenant_id,
                    DirectPixFeeInvoice.status == 'paid',
                    DirectPixFeeInvoice.paid_at >= start,
                    DirectPixFeeInvoice.paid_at < end,
                )
                .all()
            )
            for inv in dp_paid_rows:
                val = Decimal(str(inv.fees or 0)) + Decimal(str(inv.subscription_amount or 0))
                tenant_paid += val
                receipts += val
                received_by_channel['pix'] += val
                received_by_source['direct_pix_fees'] += val
                invoices['paid']['count'] += 1
                invoices['paid']['amount'] += val

            dp_open_rows = (
                db.query(DirectPixFeeInvoice)
                .filter(
                    DirectPixFeeInvoice.restaurante_id == tenant_id,
                    DirectPixFeeInvoice.status == 'open',
                    DirectPixFeeInvoice.period == period,
                )
                .all()
            )
            for inv in dp_open_rows:
                val = Decimal(str(inv.fees or 0)) + Decimal(str(inv.subscription_amount or 0))
                tenant_open += val
                outstanding += val
                due = _as_utc(inv.due_at or inv.subscription_due_at)
                bucket_key = 'overdue' if (due is not None and due < now) else 'open'
                invoices[bucket_key]['count'] += 1
                invoices[bucket_key]['amount'] += val

        tenant_rows_map[int(tenant_id)] = {'received': tenant_paid, 'outstanding': tenant_open}

    mp_paid_rows = (
        db.query(SaaSCompanyReceipt)
        .filter(
            SaaSCompanyReceipt.status == 'paid',
            or_(
                (SaaSCompanyReceipt.received_at >= start) & (SaaSCompanyReceipt.received_at < end),
                (SaaSCompanyReceipt.received_at.is_(None)) & (SaaSCompanyReceipt.competence_period == period),
            ),
        )
        .all()
    )
    for rec in mp_paid_rows:
        val = Decimal(str(rec.gross_amount or 0))
        receipts += val
        channel = rec.payment_method if rec.payment_method in received_by_channel else 'other'
        received_by_channel[channel] += val
        source_map = {
            'mp_recurring_payment': 'recurring_plans',
            'vip_onboarding': 'vip_onboarding',
            'addon_module': 'modules',
        }
        src_bucket = source_map.get(rec.source_type, 'other')
        received_by_source[src_bucket] += val
        if rec.source_type == 'mp_recurring_payment':
            plan_bucket = rec.plan_code if rec.plan_code in PLAN_BUCKETS else 'other'
            recurring_received_by_plan[plan_bucket] += val
        invoices['paid']['count'] += 1
        invoices['paid']['amount'] += val
        if int(rec.restaurante_id) in tenant_rows_map:
            tenant_rows_map[int(rec.restaurante_id)]['received'] += val
        else:
            tenant_rows_map[int(rec.restaurante_id)] = {'received': val, 'outstanding': _zero_money()}

    mp_refund_rows = (
        db.query(SaaSCompanyReceipt)
        .filter(
            SaaSCompanyReceipt.status == 'refunded',
            or_(
                (SaaSCompanyReceipt.received_at >= start) & (SaaSCompanyReceipt.received_at < end),
                (SaaSCompanyReceipt.received_at.is_(None)) & (SaaSCompanyReceipt.competence_period == period),
            ),
        )
        .all()
    )
    for rec in mp_refund_rows:
        val = Decimal(str(rec.gross_amount or 0))
        invoices['refunded']['count'] += 1
        invoices['refunded']['amount'] += val

    mp_open_rows = (
        db.query(SaaSCompanyReceipt)
        .filter(
            SaaSCompanyReceipt.status.in_(['open', 'overdue']),
            SaaSCompanyReceipt.competence_period == period,
        )
        .all()
    )
    for rec in mp_open_rows:
        val = Decimal(str(rec.gross_amount or 0))
        outstanding += val
        due = _as_utc(rec.due_at)
        bucket_key = 'overdue' if (rec.status == 'overdue' or (due is not None and due < now)) else 'open'
        invoices[bucket_key]['count'] += 1
        invoices[bucket_key]['amount'] += val
        if int(rec.restaurante_id) in tenant_rows_map:
            tenant_rows_map[int(rec.restaurante_id)]['outstanding'] += val

    known_costs = sum((Decimal(value) for value in costs.values() if value is not None), _zero_money())
    unknown = [key for key, value in costs.items() if value is None]
    fixed_known = all(costs.get(k) is not None for k in FIXED_COST_CATEGORIES)
    variable_known = all(costs.get(k) is not None for k in VARIABLE_COST_CATEGORIES)
    fixed_costs = sum((Decimal(costs[k]) for k in FIXED_COST_CATEGORIES), _zero_money()) if fixed_known else None
    variable_costs = sum((Decimal(costs[k]) for k in VARIABLE_COST_CATEGORIES), _zero_money()) if variable_known else None

    net_received = receipts - invoices['refunded']['amount']
    recorded_result = (net_received - known_costs) if not unknown else None
    contribution_margin = (net_received - variable_costs) if variable_known else None
    paying_count = tenant_counts['paying']
    arpa = (mrr_contracted / Decimal(paying_count)).quantize(Decimal('0.01')) if paying_count > 0 else None
    break_even_tenants = (
        int((fixed_costs / arpa).to_integral_value(rounding=ROUND_CEILING))
        if (not unknown and fixed_costs is not None and arpa is not None and arpa > 0)
        else None
    )

    rows = [
        {
            'tenant_id': str(tid),
            'received': str(vals['received'].quantize(Decimal('0.01'))),
            'outstanding': str(vals['outstanding'].quantize(Decimal('0.01'))),
        }
        for tid, vals in sorted(tenant_rows_map.items())
    ]

    return {
        'period': period,
        'received': str(receipts.quantize(Decimal('0.01'))),
        'net_received': str(net_received.quantize(Decimal('0.01'))),
        'outstanding': str(outstanding.quantize(Decimal('0.01'))),
        'mrr_contracted': str(mrr_contracted.quantize(Decimal('0.01'))),
        'mrr_by_plan': {k: str(v.quantize(Decimal('0.01'))) for k, v in mrr_by_plan.items()},
        'received_by_channel': {k: str(v.quantize(Decimal('0.01'))) for k, v in received_by_channel.items()},
        'received_by_source': {k: str(v.quantize(Decimal('0.01'))) for k, v in received_by_source.items()},
        'recurring_received_by_plan': {k: str(v.quantize(Decimal('0.01'))) for k, v in recurring_received_by_plan.items()},
        'invoices': {
            k: {'count': v['count'], 'amount': str(v['amount'].quantize(Decimal('0.01')))}
            for k, v in invoices.items()
        },
        'tenant_counts': tenant_counts,
        'arpa': str(arpa) if arpa is not None else None,
        'break_even_tenants': break_even_tenants,
        'tenants': rows,
        'costs': costs,
        'known_costs': str(known_costs.quantize(Decimal('0.01'))),
        'unknown_costs': unknown,
        'fixed_costs': str(fixed_costs.quantize(Decimal('0.01'))) if fixed_costs is not None else None,
        'variable_costs': str(variable_costs.quantize(Decimal('0.01'))) if variable_costs is not None else None,
        'contribution_margin': str(contribution_margin.quantize(Decimal('0.01'))) if contribution_margin is not None else None,
        'recorded_result': str(recorded_result.quantize(Decimal('0.01'))) if recorded_result is not None else None,
        'coverage': 'Recebimentos KÔMA consolidados (faturas Pix direto e pagamentos recorrentes Mercado Pago reconciliados). Custos desconhecidos permanecem null; resultado não informado quando incompleto.',
        'cost_updated_at': cost_updated_at,
    }


@router.get('')
def finance_summary(period: str = Query(pattern=r'^20\d{2}-\d{2}$'), admin=Depends(get_current_admin)):
    with SessionLocal() as db:
        return _build_finance_snapshot(db, period)


@router.get('/cfo-summary')
def finance_cfo_summary(period: str = Query(pattern=r'^20\d{2}-\d{2}$'), admin=Depends(get_current_admin)):
    """Read-only structured summary for CFO / Chief of Staff AI without PII or secrets."""
    with SessionLocal() as db:
        snap = _build_finance_snapshot(db, period)
    return {
        'period': snap['period'],
        'generated_at': dt.datetime.now(dt.timezone.utc).isoformat(),
        'currency': 'BRL',
        'revenue': {
            'mrr_contracted': snap['mrr_contracted'],
            'mrr_by_plan': snap['mrr_by_plan'],
            'cash_received_gross': snap['received'],
            'cash_received_net': snap['net_received'],
            'refunded': snap['invoices']['refunded']['amount'],
            'outstanding': snap['outstanding'],
            'by_channel': snap['received_by_channel'],
            'by_source': snap['received_by_source'],
            'recurring_by_plan': snap['recurring_received_by_plan'],
        },
        'invoices': snap['invoices'],
        'tenants': snap['tenant_counts'],
        'unit_economics': {
            'arpa': snap['arpa'],
            'break_even_tenants': snap['break_even_tenants'],
        },
        'costs': {
            'categories': snap['costs'],
            'known_total': snap['known_costs'],
            'unknown_categories': snap['unknown_costs'],
            'fixed_total': snap['fixed_costs'],
            'variable_total': snap['variable_costs'],
            'updated_at': snap['cost_updated_at'],
        },
        'results': {
            'contribution_margin': snap['contribution_margin'],
            'operating_result': snap['recorded_result'],
        },
        'data_completeness': {
            'complete': len(snap['unknown_costs']) == 0,
            'unknown_cost_categories': snap['unknown_costs'],
            'coverage': snap['coverage'],
        },
    }


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

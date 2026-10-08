"""Hourly billing maintenance for an explicit deployment tenant allowlist."""
import asyncio
import datetime as dt
import logging
import os
from zoneinfo import ZoneInfo
from sqlalchemy import func

logger = logging.getLogger('koma.direct_pix_billing')


def maintain_tenant(db, tenant, *, now=None):
    from ..models import DirectPixFeeInvoice, DirectPixReceipt, RestaurantDirectPixConfig
    from ..saas_billing_models import SaaSSubscription
    from .direct_pix_billing import close_month, utc
    from .signup_notifications import enqueue_billing_owner
    now = now or dt.datetime.now(dt.timezone.utc)
    sub = db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == tenant).one_or_none()
    config = db.query(RestaurantDirectPixConfig).filter(RestaurantDirectPixConfig.restaurante_id == tenant).one_or_none()
    # Do not bill an incomplete onboarding or invent a pre-trial due date.
    if sub is None or sub.trial_started_at is None:
        return
    if config is None:
        remind_subscription(db, tenant, sub, now)
        return
    local_now = now.astimezone(ZoneInfo('America/Sao_Paulo'))
    first = db.query(func.min(DirectPixReceipt.confirmed_at)).filter(
        DirectPixReceipt.restaurante_id == tenant, DirectPixReceipt.invoice_id.is_(None)).scalar()
    latest = db.query(func.max(DirectPixFeeInvoice.period)).filter(DirectPixFeeInvoice.restaurante_id == tenant).scalar()
    if first:
        start = utc(first).astimezone(ZoneInfo('America/Sao_Paulo')).replace(day=1)
    elif latest:
        start = dt.datetime.strptime(latest, '%Y-%m').replace(tzinfo=ZoneInfo('America/Sao_Paulo'))
        start = (start.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    else:
        start = utc(sub.trial_started_at).astimezone(ZoneInfo('America/Sao_Paulo')).replace(day=1)
    end = local_now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    start = start.replace(hour=0, minute=0, second=0, microsecond=0)
    count = 0
    while start < end and count < 24:
        close_month(db, restaurant_id=tenant, period=start.strftime('%Y-%m'))
        start = (start.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
        count += 1
    rows = db.query(DirectPixFeeInvoice).filter(DirectPixFeeInvoice.restaurante_id == tenant,
        DirectPixFeeInvoice.status == 'open', DirectPixFeeInvoice.due_at.isnot(None)).all()
    for row in rows:
        due = utc(row.due_at)
        event = 'overdue' if now > due else 'due_soon' if now >= due - dt.timedelta(days=3) else None
        if event:
            enqueue_billing_owner(db, tenant_id=tenant, invoice_id=row.id, period=row.period,
                event=event, amount=row.fees + row.subscription_amount)

    remind_subscription(db, tenant, sub, now)


def remind_subscription(db, tenant, sub, now):
    from ..models import DirectPixFeeInvoice
    from .direct_pix_billing import utc
    from .signup_notifications import enqueue_billing_owner
    due = utc(sub.current_period_end) or utc(sub.trial_ends_at)
    if due and sub.status in {'active','trialing','past_due'}:
        event = 'overdue' if now > due else 'due_soon' if now >= due - dt.timedelta(days=3) else None
        consolidated = db.query(DirectPixFeeInvoice.id).filter(DirectPixFeeInvoice.restaurante_id == tenant,
            DirectPixFeeInvoice.subscription_amount > 0, DirectPixFeeInvoice.subscription_due_at == due).first()
        if event and not consolidated:
            from .billing_service import tenant_commercial_terms
            terms = tenant_commercial_terms(db, tenant)
            if terms:
                enqueue_billing_owner(db, tenant_id=tenant, invoice_id=f'subscription-{due:%Y%m%d}',
                    period=due.strftime('%Y-%m'), event=event, amount=terms.billing_amount)


def sweep():
    from ..database import SessionLocal, tenant_session_scope
    tenant_ids = {int(v.strip()) for v in os.getenv('DIRECT_PIX_BILLING_TENANT_IDS', '').split(',') if v.strip()}
    for tenant in sorted(tenant_ids):
        if tenant <= 0:
            continue
        try:
            with SessionLocal() as db:
                with tenant_session_scope(db, tenant):
                    maintain_tenant(db, tenant)
                    db.commit()
        except Exception:
            logger.exception('Billing maintenance failed tenant=%s', tenant)


async def run_worker():
    while True:
        try:
            await asyncio.to_thread(sweep)
        except Exception:
            logger.exception('Billing maintenance allowlist failed')
        await asyncio.sleep(3600)

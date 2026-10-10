"""Freeze accrued fees once per tenant/month. No implicit external charge."""
from __future__ import annotations
import datetime as dt
import calendar
from decimal import Decimal
from zoneinfo import ZoneInfo
from sqlalchemy.orm import Session
from sqlalchemy import or_
from ..models import DirectPixFeeInvoice, DirectPixReceipt, OnlinePaymentIntent, Restaurante
from ..saas_billing_models import SaaSSubscription
from .billing_service import tenant_commercial_terms


def utc(value):
    return value.replace(tzinfo=dt.timezone.utc) if value is not None and value.tzinfo is None else value


def invoice_due(sub, next_month):
    # The trial's original anniversary avoids drifting after a short February.
    anchor = utc(sub.trial_ends_at) or utc(sub.current_period_end)
    if anchor is None:
        return None  # No fabricated due date before the trial has actually started.
    local = anchor.astimezone(ZoneInfo('America/Sao_Paulo'))
    return next_month.replace(day=min(local.day, calendar.monthrange(next_month.year, next_month.month)[1]),
        hour=local.hour, minute=local.minute, second=local.second).astimezone(dt.timezone.utc)


def billing_summary(db: Session, restaurant_id: int, *, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    subscription_row = db.query(SaaSSubscription, Restaurante.billing_mode).join(
        Restaurante, Restaurante.id == SaaSSubscription.restaurante_id).filter(
        SaaSSubscription.restaurante_id == restaurant_id).one_or_none()
    sub = subscription_row[0] if subscription_row else None
    rows = db.query(DirectPixFeeInvoice).filter(DirectPixFeeInvoice.restaurante_id == restaurant_id,
        DirectPixFeeInvoice.status == 'open').order_by(
        DirectPixFeeInvoice.due_at, DirectPixFeeInvoice.id).all()
    total = sum((row.fees + row.subscription_amount for row in rows), Decimal('0.00'))
    oldest = next((row for row in rows if row.due_at is not None), rows[0] if rows else None)
    due = utc(oldest.due_at) if oldest else None
    payable_invoice = oldest
    sub_due = utc(sub.current_period_end) or utc(sub.trial_ends_at) if sub else None
    subscription_owed = bool(sub and subscription_row[1] == 'subscription' and sub.trial_started_at
        and sub.status in {'active','trialing','past_due'} and sub_due)
    if subscription_owed and (due is None or sub_due < due):
        due = sub_due
        payable_invoice = None
    grace = due + dt.timedelta(days=3) if due else None
    state = ('restricted' if grace and now > grace else 'overdue' if due and now > due
        else 'due_soon' if due and now >= due - dt.timedelta(days=3) else 'open' if oldest else 'current')
    return {'status': state, 'new_sales_allowed': state != 'restricted',
        'open_total': str(total), 'open_count': len(rows), 'invoice_id': payable_invoice.id if payable_invoice else None,
        'due_at': due.isoformat() if due else None, 'grace_until': grace.isoformat() if grace else None,
        'subscription_status': sub.status if sub else 'unconfigured',
        'subscription_owed': subscription_owed,
        'subscription_due_at': (utc(sub.current_period_end) or utc(sub.trial_ends_at)).isoformat()
            if sub and (sub.current_period_end or sub.trial_ends_at) else None}


def new_sales_allowed(db: Session, restaurant_id: int, *, now=None):
    cutoff = (now or dt.datetime.now(dt.timezone.utc)) - dt.timedelta(days=3)
    fee_overdue = db.query(db.query(DirectPixFeeInvoice.id).filter(
        DirectPixFeeInvoice.restaurante_id == restaurant_id, DirectPixFeeInvoice.status == 'open',
        DirectPixFeeInvoice.due_at < cutoff).exists()).scalar()
    if fee_overdue:
        return False
    from sqlalchemy import func
    subscription_overdue = db.query(db.query(SaaSSubscription.restaurante_id).join(
        Restaurante, Restaurante.id == SaaSSubscription.restaurante_id).filter(
        SaaSSubscription.restaurante_id == restaurant_id, Restaurante.billing_mode == 'subscription',
        SaaSSubscription.trial_started_at.isnot(None), SaaSSubscription.status.in_(['active','trialing','past_due']),
        func.coalesce(SaaSSubscription.current_period_end, SaaSSubscription.trial_ends_at) < cutoff).exists()).scalar()
    return not subscription_overdue


def close_month(db: Session, *, restaurant_id: int, period: str) -> DirectPixFeeInvoice:
    start_local = dt.datetime.strptime(period, '%Y-%m').replace(tzinfo=ZoneInfo('America/Sao_Paulo'))
    end_local = (start_local.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    if end_local > dt.datetime.now(dt.timezone.utc):
        raise ValueError('O mês ainda não foi encerrado.')
    # Tenant-level serialization makes retries/concurrent closings return the same snapshot.
    db.query(Restaurante).filter(Restaurante.id == restaurant_id).with_for_update().one()
    existing = db.query(DirectPixFeeInvoice).filter(DirectPixFeeInvoice.restaurante_id == restaurant_id,
        DirectPixFeeInvoice.period == period).one_or_none()
    if existing:
        return existing
    terms = tenant_commercial_terms(db, restaurant_id)
    sub = db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == restaurant_id).one_or_none()
    if terms is None or sub is None:
        raise ValueError('Assinatura e termos comerciais são obrigatórios para faturar.')
    # Do not duplicate an existing recurring card/account-money charge.
    if sub.billing_cycle in {'monthly','mensal'} and sub.payment_method_type != 'pix':
        raise ValueError('Mensalidade recorrente existente: consolidação requer migração explícita do billing para Pix.')
    receipts = db.query(DirectPixReceipt).join(OnlinePaymentIntent, OnlinePaymentIntent.id == DirectPixReceipt.intent_id).filter(
        DirectPixReceipt.restaurante_id == restaurant_id,
        OnlinePaymentIntent.restaurante_id == restaurant_id,
        OnlinePaymentIntent.status == 'approved',
        or_(OnlinePaymentIntent.fee_settlement.is_(None), OnlinePaymentIntent.fee_settlement != 'test'),
        DirectPixReceipt.confirmed_at >= start_local.astimezone(dt.timezone.utc),
        DirectPixReceipt.confirmed_at < end_local.astimezone(dt.timezone.utc),
        DirectPixReceipt.invoice_id.is_(None),
    ).with_for_update().all()
    # Sum stored, rounded fees: never recalculate from current catalog or order total.
    fees = sum((Decimal(str(r.fee)) for r in receipts), Decimal('0.00'))
    next_month_end = (end_local.replace(day=28)+dt.timedelta(days=4)).replace(day=1)
    due = sub.current_period_end or sub.trial_ends_at
    if due and due.tzinfo is None:
        due = due.replace(tzinfo=dt.timezone.utc)
    # Include a monthly installment only in the invoice whose following month contains its due date.
    fixed = (terms.billing_amount if sub.billing_cycle in {'monthly','mensal'} and due
             and end_local <= due < next_month_end else Decimal('0.00'))
    if fixed > 0 and sub.provider_subscription_id:
        from .saas_mercadopago import default_saas_mp_service
        old_payment = default_saas_mp_service.get_payment(str(sub.provider_subscription_id))
        old_reference = f"KOMA-SAAS-PIX-{restaurant_id}-{due:%Y%m%d}"
        if (old_payment.get('external_reference') == old_reference
            and old_payment.get('status') in {'pending','in_process','approved'}):
            # An already-issued fixed invoice keeps ownership of its installment.
            fixed = Decimal('0.00')
    invoice = DirectPixFeeInvoice(restaurante_id=restaurant_id, period=period, fees=fees,
        subscription_amount=fixed, subscription_due_at=due if fixed else None,
        due_at=due if fixed else invoice_due(sub, end_local), status='open' if fees+fixed > 0 else 'paid')
    db.add(invoice)
    db.flush()
    for receipt in receipts:
        receipt.invoice_id = invoice.id
    if fees + fixed > 0:
        from .signup_notifications import enqueue_billing_owner
        enqueue_billing_owner(db, tenant_id=restaurant_id, invoice_id=invoice.id,
            period=period, event='issued', amount=fees + fixed)
    return invoice


def reconcile_invoice_payment(db: Session, *, restaurant_id: int, invoice_id: str, payment: dict) -> bool:
    row = db.query(DirectPixFeeInvoice).filter(DirectPixFeeInvoice.restaurante_id == restaurant_id,
        DirectPixFeeInvoice.id == invoice_id).with_for_update().populate_existing().one_or_none()
    if row is None:
        return False
    expected_reference = f"KOMA-FEE-{restaurant_id}-{row.id}"
    if (str(payment.get('external_reference') or '') != expected_reference
        or str(payment.get('id') or '') != row.provider_payment_id
        or payment.get('currency_id') != 'BRL'
        or payment.get('payment_method_id') != 'pix'):
        raise ValueError('Pagamento não corresponde à fatura.')
    try:
        amount = Decimal(str(payment.get('transaction_amount')))
    except Exception as exc:
        raise ValueError('Valor de pagamento inválido.') from exc
    if not amount.is_finite() or amount != row.fees+row.subscription_amount:
        raise ValueError('Valor de pagamento diverge da fatura.')
    if row.status == 'paid' or payment.get('status') != 'approved':
        return row.status == 'paid'
    if row.subscription_amount > 0:
        from ..routes.saas_pix import _advance_paid_period
        sub = db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == restaurant_id).with_for_update().one()
        # Do not extend another year when an annual subscriber pays only usage fees.
        if sub.billing_cycle not in {'monthly','mensal'} or sub.payment_method_type != 'pix':
            raise ValueError('Assinatura mudou; a fatura exige conciliação antes de renovar.')
        due = row.subscription_due_at
        if due is not None and due.tzinfo is None:
            due = due.replace(tzinfo=dt.timezone.utc)
        _advance_paid_period(sub,due or dt.datetime.now(dt.timezone.utc))
    row.status = 'paid'
    row.paid_at = dt.datetime.now(dt.timezone.utc)
    from .signup_notifications import enqueue_billing_owner
    enqueue_billing_owner(db, tenant_id=restaurant_id, invoice_id=row.id,
        period=row.period, event='paid', amount=row.fees + row.subscription_amount)
    return True


def create_invoice_pix(db: Session, *, restaurant_id: int, invoice_id: str, payer_email: str) -> dict:
    import uuid
    from ..config import settings
    from .saas_mercadopago import default_saas_mp_service as provider, SaasMercadoPagoError
    provider._ensure_provider_ready()
    row = db.query(DirectPixFeeInvoice).filter(DirectPixFeeInvoice.restaurante_id == restaurant_id,
        DirectPixFeeInvoice.id == invoice_id).with_for_update().one_or_none()
    if row is None:
        raise ValueError('Fatura não encontrada.')
    amount = row.fees+row.subscription_amount
    if amount <= 0 or row.status == 'paid':
        return {'invoiceId':row.id,'status':'approved','amount':str(amount),'paymentMethodType':'pix'}
    if row.subscription_amount > 0:
        sub = db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == restaurant_id).one_or_none()
        trial_end = utc(sub.trial_ends_at) if sub else None
        if sub and (sub.status == 'onboarding' or trial_end and dt.datetime.now(dt.timezone.utc) < trial_end):
            return {'invoiceId': row.id, 'status': 'not_due', 'amount': str(amount),
                'paymentMethodType': 'pix', 'message': 'O Pix da mensalidade só será gerado depois dos 7 dias grátis.'}
    reference = f"KOMA-FEE-{restaurant_id}-{row.id}"
    if row.provider_payment_id:
        payment = provider.get_payment(row.provider_payment_id)
        paid = reconcile_invoice_payment(db,restaurant_id=restaurant_id,invoice_id=row.id,payment=payment)
        if paid:
            db.commit()
            return {'invoiceId':row.id,'status':'approved','amount':str(amount),'paymentMethodType':'pix'}
        if payment.get('status') in {'pending','in_process'}:
            # Return the original charge; never create a second charge while an older one can be paid.
            if row.payment_payload:
                return row.payment_payload
        elif payment.get('status') in {'cancelled','rejected','expired'}:
            # Only an authoritative terminal state permits another attempt.
            row.previous_payment_ids = [*(row.previous_payment_ids or []),row.provider_payment_id]
            row.payment_attempt = (row.payment_attempt or 0)+1
            row.provider_payment_id = None
            row.payment_payload = None
            db.flush()
        else:
            raise ValueError('O gateway ainda não confirmou o encerramento da cobrança anterior.')
    if not payer_email or '@' not in payer_email:
        raise ValueError('E-mail do administrador inválido para cobrança.')
    now = dt.datetime.now(dt.timezone.utc)
    expiration = now+dt.timedelta(days=7)
    payload = {'transaction_amount':float(amount),'description':f'KÔMA — fatura {row.period}',
        'payment_method_id':'pix','payer':{'email':payer_email},'external_reference':reference,
        'date_of_expiration':expiration.strftime('%Y-%m-%dT%H:%M:%S.000Z')}
    if settings.KOMA_PUBLIC_API_URL:
        payload['notification_url'] = f"{settings.KOMA_PUBLIC_API_URL}/api/integrations/saas-pix/mercado-pago/webhook"
    if provider.is_mock:
        if not provider.mock_allowed:
            raise ValueError('Cobrança de teste indisponível.')
        payment = {'id':f'mock-fee-{row.id}','status':'pending','external_reference':reference,
            'transaction_amount':float(amount),'payment_method_id':'pix','currency_id':'BRL',
            'point_of_interaction':{'transaction_data':{'qr_code':f'test-only-{row.id}'}},
            'date_of_expiration':expiration.isoformat()}
    else:
        with provider._client() as client:
            response = client.post('/v1/payments',json=payload,headers={'X-Idempotency-Key':str(uuid.uuid5(uuid.NAMESPACE_URL,f'{reference}/attempt/{row.payment_attempt or 0}'))})
            if response.status_code >= 400:
                raise SaasMercadoPagoError('Não foi possível gerar a cobrança da fatura.',status_code=response.status_code)
            payment = response.json()
            provider._validate_merchant_identity(payment)
    if not payment.get('id') or str(payment.get('external_reference')) != reference:
        raise ValueError('Resposta de cobrança inválida.')
    row.provider_payment_id = str(payment['id'])
    qr = (payment.get('point_of_interaction') or {}).get('transaction_data') or {}
    row.payment_payload = {'invoiceId':row.id,'status':payment.get('status'),'paymentId':row.provider_payment_id,
        'amount':str(amount),'fees':str(row.fees),'subscriptionAmount':str(row.subscription_amount),
        'qrCode':qr.get('qr_code'),'qrCodeBase64':qr.get('qr_code_base64'),'ticketUrl':qr.get('ticket_url'),
        'expiresAt':payment.get('date_of_expiration'),'paymentMethodType':'pix','automaticRenewal':False}
    db.flush()
    reconcile_invoice_payment(db,restaurant_id=restaurant_id,invoice_id=row.id,payment=payment)
    db.commit()
    return row.payment_payload

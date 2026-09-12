import calendar
import datetime as dt
from decimal import Decimal, InvalidOperation
from fastapi import HTTPException
from ..database import tenant_session_scope
from ..saas_billing_models import SaaSSubscription
from .billing_service import get_billing_setup_by_provider_sub, contract_billing_terms
from .saas_mercadopago import default_saas_mp_service, SaasMercadoPagoError

def reconcile_invoice(db, invoice_id):
    try:
        invoice = default_saas_mp_service.get_authorized_payment(invoice_id)
    except SaasMercadoPagoError as exc:
        raise HTTPException(502, "Não foi possível confirmar a cobrança.") from exc
    billing = get_billing_setup_by_provider_sub(db, "mercado_pago", str(invoice.get("preapproval_id") or ""))
    if not billing or not billing.restaurante_id or billing.payment_method_type != "credit_card":
        return {"status": "received", "reconciled": False}
    payment = invoice.get("payment") or {}
    if not payment.get("id"):
        return {"status": "received", "reconciled": False}
    try:
        verified = default_saas_mp_service.get_payment(str(payment["id"]))
        mandate = default_saas_mp_service.get_preapproval(billing.provider_subscription_id)
    except SaasMercadoPagoError as exc:
        raise HTTPException(502, "Não foi possível confirmar o pagamento da cobrança.") from exc
    if str(mandate.get("external_reference") or "") != billing.protocol:
        return {"status": "received", "reconciled": False}
    try:
        amount = Decimal(str(verified.get("transaction_amount")))
        expected = Decimal(str(contract_billing_terms(db, billing.protocol)["commercial"]["billingAmount"]))
        if verified.get("currency_id") != "BRL" or not amount.is_finite() or amount <= 0 or amount != expected:
            return {"status": "received", "reconciled": False}
    except (InvalidOperation, TypeError):
        return {"status": "received", "reconciled": False}
    with tenant_session_scope(db, billing.restaurante_id):
        sub = db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == billing.restaurante_id).with_for_update().one_or_none()
        if sub is None: return {"status": "received", "reconciled": False}
        if verified.get("status") == "approved":
            try:
                paid_at = dt.datetime.fromisoformat(str(verified.get("date_approved")).replace("Z", "+00:00"))
                if paid_at.tzinfo is None: paid_at = paid_at.replace(tzinfo=dt.timezone.utc)
            except ValueError:
                return {"status": "received", "reconciled": False}
            months = 12 if sub.billing_cycle in {"annual", "anual"} else 1
            month_index = paid_at.year * 12 + paid_at.month - 1 + months
            year, month = divmod(month_index, 12); month += 1
            end = paid_at.replace(year=year, month=month, day=min(paid_at.day, calendar.monthrange(year, month)[1]))
            prior = sub.current_period_end
            if prior and prior.tzinfo is None: prior = prior.replace(tzinfo=dt.timezone.utc)
            if prior is None or end > prior:
                sub.current_period_start = paid_at; sub.current_period_end = end
                if sub.status not in {"canceled", "suspended"}: sub.status = "active"
                sub.grace_until = None
        # Rejected or pending invoices cannot erase a previously paid period.
        sub.updated_at = dt.datetime.now(dt.timezone.utc)
        db.commit()
    return {"status": "received", "reconciled": True}

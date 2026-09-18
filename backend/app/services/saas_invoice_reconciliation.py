import calendar
import datetime as dt
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException

from ..database import tenant_session_scope
from ..saas_billing_models import SaaSSubscription
from .billing_service import (
    contract_billing_terms,
    get_billing_setup_by_provider_sub,
    tenant_commercial_terms,
)
from .saas_billing_policy import is_recurring_trial_payment_method
from .saas_mercadopago import SaasMercadoPagoError, default_saas_mp_service


def _payment_method_matches_subscription(payment_method_type: str, provider_payment_method: str | None) -> bool:
    """Confirma o meio financeiro quando ele é determinístico no provedor.

    Cartões retornam bandeiras/IDs como visa/master e não `credit_card`, então a
    autorização do mandate continua sendo a fonte de verdade para cartão. Pix e
    Saldo Mercado Pago possuem IDs canônicos e precisam bater exatamente para
    impedir que uma cobrança de outro meio atualize o período pago do tenant.
    """
    local_method = (payment_method_type or "").strip().lower()
    provider_method = (provider_payment_method or "").strip().lower()
    if local_method == "pix_automatic":
        return provider_method == "pix"
    if local_method == "account_money":
        return provider_method == "account_money"
    return local_method == "credit_card"


def reconcile_invoice(db, invoice_id):
    try:
        invoice = default_saas_mp_service.get_authorized_payment(invoice_id)
    except SaasMercadoPagoError as exc:
        if exc.status_code in {400, 404}:
            return {"status": "received", "reconciled": False, "reason": "invoice_not_found"}
        raise HTTPException(502, "Não foi possível confirmar a cobrança.") from exc

    billing = get_billing_setup_by_provider_sub(
        db,
        "mercado_pago",
        str(invoice.get("preapproval_id") or ""),
    )
    if (
        not billing
        or not billing.restaurante_id
        or not is_recurring_trial_payment_method(billing.payment_method_type)
    ):
        return {"status": "received", "reconciled": False}

    payment = invoice.get("payment") or {}
    if not payment.get("id"):
        return {"status": "received", "reconciled": False}

    try:
        verified = default_saas_mp_service.get_payment(str(payment["id"]))
        mandate = default_saas_mp_service.get_preapproval(billing.provider_subscription_id)
    except SaasMercadoPagoError as exc:
        if exc.status_code in {400, 404}:
            return {
                "status": "received",
                "reconciled": False,
                "reason": "payment_or_mandate_not_found",
            }
        raise HTTPException(502, "Não foi possível confirmar o pagamento da cobrança.") from exc

    if str(mandate.get("external_reference") or "") != billing.protocol:
        return {"status": "received", "reconciled": False}

    if not _payment_method_matches_subscription(
        billing.payment_method_type,
        verified.get("payment_method_id"),
    ):
        return {
            "status": "received",
            "reconciled": False,
            "reason": "payment_method_mismatch",
        }

    with tenant_session_scope(db, billing.restaurante_id):
        try:
            amount = Decimal(str(verified.get("transaction_amount")))
            current_terms = tenant_commercial_terms(
                db,
                int(billing.restaurante_id),
            )
            if current_terms is not None:
                expected = Decimal(str(current_terms.billing_amount))
            else:
                # Compatibilidade somente para tenant sem aceite atual. O protocolo
                # original continua sendo a evidência da autorização do provider.
                expected = Decimal(
                    str(
                        contract_billing_terms(
                            db,
                            billing.protocol,
                        )["commercial"]["billingAmount"]
                    )
                )
            if (
                verified.get("currency_id") != "BRL"
                or not amount.is_finite()
                or amount <= 0
                or amount != expected
            ):
                return {
                    "status": "received",
                    "reconciled": False,
                    "reason": "billing_amount_mismatch",
                }
        except RuntimeError:
            return {
                "status": "received",
                "reconciled": False,
                "reason": "commercial_terms_unavailable",
            }
        except (InvalidOperation, TypeError):
            return {"status": "received", "reconciled": False}

        sub = (
            db.query(SaaSSubscription)
            .filter(SaaSSubscription.restaurante_id == billing.restaurante_id)
            .with_for_update()
            .one_or_none()
        )
        if sub is None:
            return {"status": "received", "reconciled": False}

        if verified.get("status") == "approved":
            try:
                paid_at = dt.datetime.fromisoformat(
                    str(verified.get("date_approved")).replace("Z", "+00:00")
                )
                if paid_at.tzinfo is None:
                    paid_at = paid_at.replace(tzinfo=dt.timezone.utc)
            except ValueError:
                return {"status": "received", "reconciled": False}

            months = 12 if sub.billing_cycle in {"annual", "anual"} else 1
            month_index = paid_at.year * 12 + paid_at.month - 1 + months
            year, month = divmod(month_index, 12)
            month += 1
            end = paid_at.replace(
                year=year,
                month=month,
                day=min(paid_at.day, calendar.monthrange(year, month)[1]),
            )
            prior = sub.current_period_end
            if prior and prior.tzinfo is None:
                prior = prior.replace(tzinfo=dt.timezone.utc)
            if prior is None or end > prior:
                sub.current_period_start = paid_at
                sub.current_period_end = end
                if sub.status not in {"canceled", "suspended"}:
                    sub.status = "active"
                sub.grace_until = None

        # Rejected or pending invoices cannot erase a previously paid period.
        sub.updated_at = dt.datetime.now(dt.timezone.utc)
        db.commit()

    return {"status": "received", "reconciled": True}

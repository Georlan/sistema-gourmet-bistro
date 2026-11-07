import datetime
from decimal import Decimal
import pytest
from app.database import SessionLocal, tenant_session_scope
from app.models import DirectPixFeeInvoice, Restaurante, SuperAdminAuditLog
from app.saas_billing_models import SaaSSubscription
from app.routes.super_admin import confirm_invoice_manual_pix, ManualPixPaymentRequest


def test_confirm_invoice_manual_pix_success_and_idempotency():
    db = SessionLocal()
    tenant_id = 99881
    invoice_id = "inv-manual-test-01"
    now = datetime.datetime.now(datetime.timezone.utc)

    try:
        # Cria restaurante e assinatura mock
        rest = db.query(Restaurante).filter_by(id=tenant_id).first()
        if not rest:
            rest = Restaurante(id=tenant_id, nome="Restaurante Manual Pix Test", plano="pocket", saas_status="active")
            db.add(rest)
            db.flush()

        sub = db.query(SaaSSubscription).filter_by(restaurante_id=tenant_id).first()
        if not sub:
            sub = SaaSSubscription(
                restaurante_id=tenant_id,
                status="trialing",
                billing_cycle="monthly",
                payment_method_type="pix",
                trial_started_at=now - datetime.timedelta(days=7),
                trial_ends_at=now,
                current_period_end=now,
            )
            db.add(sub)
            db.flush()

        # Cria fatura aberta com R$ 79.90 de assinatura e R$ 0.00 de fees
        inv = db.query(DirectPixFeeInvoice).filter_by(id=invoice_id).first()
        if not inv:
            inv = DirectPixFeeInvoice(
                id=invoice_id,
                restaurante_id=tenant_id,
                period="2026-11",
                fees=Decimal("0.00"),
                subscription_amount=Decimal("79.90"),
                status="open",
                due_at=now,
                subscription_due_at=now,
            )
            db.add(inv)
            db.commit()

        # Confirma pagamento manual
        admin_ctx = {"user": "superadmin_test", "role": "superadmin"}
        req = ManualPixPaymentRequest(
            amount=Decimal("79.90"),
            bank_reference="E2E9988120261104123456789",
            reason="Comprovante de Pix conferido na conta PF do fundador pelo WhatsApp.",
            receipt_notes="Recebido via Banco do Brasil",
        )

        res = confirm_invoice_manual_pix(
            restaurant_id=tenant_id,
            invoice_id=invoice_id,
            payload=req,
            admin=admin_ctx,
        )

        assert res["success"] is True
        assert res["status"] == "paid"
        assert res["amount"] == "79.90"

        # Verifica banco e auditoria
        with tenant_session_scope(db, tenant_id):
            updated_inv = db.query(DirectPixFeeInvoice).filter_by(id=invoice_id).one()
            assert updated_inv.status == "paid"
            assert updated_inv.paid_at is not None

            updated_sub = db.query(SaaSSubscription).filter_by(restaurante_id=tenant_id).one()
            assert updated_sub.status == "active"
            end_val = updated_sub.current_period_end
            if end_val.tzinfo is None:
                end_val = end_val.replace(tzinfo=datetime.timezone.utc)
            assert end_val > now

            audit = db.query(SuperAdminAuditLog).filter_by(
                restaurante_id=tenant_id,
                action="invoice_manual_pix_confirmed",
            ).first()
            assert audit is not None
            assert audit.actor == "superadmin_test"
            assert "E2E9988120261104123456789" in str(audit.after_data)

        # Idempotência: segunda chamada retorna sucesso sem duplicar ou re-avançar
        res2 = confirm_invoice_manual_pix(
            restaurant_id=tenant_id,
            invoice_id=invoice_id,
            payload=req,
            admin=admin_ctx,
        )
        assert res2["success"] is True
        assert res2["status"] == "paid"
        assert res2["message"] == "Fatura já liquidada previamente."

    finally:
        # Cleanup
        db.query(SuperAdminAuditLog).filter_by(restaurante_id=tenant_id).delete()
        db.query(DirectPixFeeInvoice).filter_by(restaurante_id=tenant_id).delete()
        db.query(SaaSSubscription).filter_by(restaurante_id=tenant_id).delete()
        db.query(Restaurante).filter_by(id=tenant_id).delete()
        db.commit()
        db.close()

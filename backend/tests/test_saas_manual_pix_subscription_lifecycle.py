"""
Testes de ciclo de vida da mensalidade SaaS por Pix manual após os 7 dias grátis.

Requisitos validados:
1. Não depender de API externa (Mercado Pago ou Banco do Brasil).
2. Período de trial (7 dias): nenhuma cobrança Pix gerada enquanto trial estiver vigente.
3. Fim do trial (D+7): geração de fatura única e payload Pix BR Code offline usando o valor congelado no contrato.
4. Fatura única / Idempotência: requisições repetidas reutilizam a mesma fatura sem duplicar.
5. Tolerância (Grace Period de 3 dias): vendas permitidas até D+7+3; bloqueadas após expirar a carência.
6. Liquidação administrativa auditável: confirmação manual via super-admin exige valor exato e referência bancária.
7. Renovação mensal: avanço de 1 mês no período coberto e reativação da assinatura.
8. Idempotência na baixa: confirmações repetidas não duplicam a extensão do período.
9. Isolamento e proteção: assinatura de cartão não gera Pix manual; outro tenant não vê ou altera a fatura.
"""
import datetime as dt
from contextlib import contextmanager
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.database import SessionLocal, tenant_session_scope
from app.models import DirectPixFeeInvoice, Restaurante, SuperAdminAuditLog, Usuario
from app.routes.saas_pix import generate_or_get_subscription_pix, generate_subscription_manual_pix
from app.routes.super_admin import ManualPixPaymentRequest, confirm_invoice_manual_pix
from app.saas_billing_models import SaaSSubscription
from app.services.direct_pix_billing import (
    billing_summary,
    new_sales_allowed,
)


@contextmanager
def freeze_time(target_dt: dt.datetime):
    import datetime as real_datetime
    import app.routes.saas_pix as saas_pix_mod
    import app.routes.super_admin as super_admin_mod
    import app.services.direct_pix_billing as direct_pix_mod

    orig_dt_cls = real_datetime.datetime

    class MockDatetime(orig_dt_cls):
        @classmethod
        def now(cls, tz=None):
            if tz is not None:
                return target_dt.astimezone(tz)
            return target_dt

    fake_dt_module = SimpleNamespace(**{k: getattr(real_datetime, k) for k in dir(real_datetime) if not k.startswith("__")})
    fake_dt_module.datetime = MockDatetime

    orig_saas_pix_dt = saas_pix_mod.dt
    orig_direct_pix_dt = direct_pix_mod.dt
    orig_super_admin_dt = super_admin_mod.datetime

    saas_pix_mod.dt = fake_dt_module
    direct_pix_mod.dt = fake_dt_module
    super_admin_mod.datetime = fake_dt_module
    try:
        yield
    finally:
        saas_pix_mod.dt = orig_saas_pix_dt
        direct_pix_mod.dt = orig_direct_pix_dt
        super_admin_mod.datetime = orig_super_admin_dt


TENANT_ID = 99882
OTHER_TENANT_ID = 99883
BASE_DATE = dt.datetime(2026, 11, 1, 12, 0, 0, tzinfo=dt.timezone.utc)
CONTRACT_BILLING_AMOUNT = Decimal("109.00")


@pytest.fixture(autouse=True)
def commercial_terms_fixture(monkeypatch):
    terms = SimpleNamespace(billing_amount=CONTRACT_BILLING_AMOUNT)
    monkeypatch.setattr("app.routes.saas_pix.tenant_commercial_terms", lambda _db, _rid: terms)
    monkeypatch.setattr("app.services.direct_pix_billing.tenant_commercial_terms", lambda _db, _rid: terms)
    monkeypatch.setattr("app.services.billing_service.tenant_commercial_terms", lambda _db, _rid: terms)


@pytest.fixture(autouse=True)
def setup_teardown_tenant():
    db = SessionLocal()
    try:
        for tid in (TENANT_ID, OTHER_TENANT_ID):
            db.query(SuperAdminAuditLog).filter_by(restaurante_id=tid).delete()
            db.query(DirectPixFeeInvoice).filter_by(restaurante_id=tid).delete()
            db.query(SaaSSubscription).filter_by(restaurante_id=tid).delete()
            db.query(Usuario).filter_by(restaurante_id=tid).delete()
            db.query(Restaurante).filter_by(id=tid).delete()
        db.commit()

        rest = Restaurante(
            id=TENANT_ID,
            nome="Restaurante Teste Pix Manual",
            plano="pocket",
            billing_mode="subscription",
            saas_status="active",
        )
        other_rest = Restaurante(
            id=OTHER_TENANT_ID,
            nome="Outro Restaurante Isolado",
            plano="pocket",
            billing_mode="subscription",
            saas_status="active",
        )
        db.add_all([rest, other_rest])
        admin_user = Usuario(
            email="admin.teste@pixmanual.test",
            nome="Admin Teste",
            cargo="admin",
            restaurante_id=TENANT_ID,
            status="ativo",
        )
        db.add(admin_user)
        db.commit()

        yield rest, admin_user
    finally:
        for tid in (TENANT_ID, OTHER_TENANT_ID):
            db.query(SuperAdminAuditLog).filter_by(restaurante_id=tid).delete()
            db.query(DirectPixFeeInvoice).filter_by(restaurante_id=tid).delete()
            db.query(SaaSSubscription).filter_by(restaurante_id=tid).delete()
            db.query(Usuario).filter_by(restaurante_id=tid).delete()
            db.query(Restaurante).filter_by(id=tid).delete()
        db.commit()
        db.close()


def test_saas_manual_pix_subscription_full_lifecycle(setup_teardown_tenant, monkeypatch):
    monkeypatch.setenv("KOMA_SAAS_MANUAL_PIX_KEY", "pagamentos@example.com")
    _rest, admin_user = setup_teardown_tenant
    db = SessionLocal()

    trial_start = BASE_DATE
    trial_end = BASE_DATE + dt.timedelta(days=7)

    sub = SaaSSubscription(
        restaurante_id=TENANT_ID,
        status="trialing",
        billing_cycle="monthly",
        provider="mercado_pago",
        payment_method_type="pix",
        trial_started_at=trial_start,
        trial_ends_at=trial_end,
        current_period_start=trial_start,
        current_period_end=trial_end,
    )
    db.add(sub)
    db.commit()

    # FASE 1: Dia 0 (Início do Trial) -> Cobrança ainda não devida
    with freeze_time(trial_start):
        res = generate_subscription_manual_pix(user=admin_user, db=db)
        assert res["status"] == "not_due"
        assert "não há cobrança Pix vencida" in res["message"]
        assert new_sales_allowed(db, TENANT_ID) is True
        summary = billing_summary(db, TENANT_ID)
        assert summary["new_sales_allowed"] is True

    # FASE 2: Dia 3 (Meio do Trial) -> Cobrança continua não devida
    mid_trial = trial_start + dt.timedelta(days=3)
    with freeze_time(mid_trial):
        res = generate_or_get_subscription_pix(manual=True, user=admin_user, db=db)
        assert res["status"] == "not_due"
        assert new_sales_allowed(db, TENANT_ID) is True

    # FASE 3: Dia 7 (Fim dos 7 dias grátis) -> Mensalidade gerada pelo contrato congelado
    with freeze_time(trial_end):
        res = generate_subscription_manual_pix(user=admin_user, db=db)
        assert res["status"] == "pending"
        assert res["amount"] == "109.00"
        assert res["paymentMethodType"] == "pix"
        assert "000201" in res["qrCode"]
        assert "manual" in res["paymentId"]
        invoice_id = res["invoiceId"]
        assert invoice_id is not None

        inv = db.query(DirectPixFeeInvoice).filter_by(id=invoice_id).one()
        assert inv.subscription_amount == CONTRACT_BILLING_AMOUNT
        assert inv.fees == Decimal("0.00")
        assert inv.status == "open"

        # Fatura Única: segunda chamada reutiliza exatamente a mesma fatura
        res_repeat = generate_or_get_subscription_pix(manual=True, user=admin_user, db=db)
        assert res_repeat["invoiceId"] == invoice_id
        assert db.query(DirectPixFeeInvoice).filter_by(restaurante_id=TENANT_ID).count() == 1

    # FASE 4: Dia 8 (Carência de 3 dias ativa) -> Vendas continuam permitidas
    grace_day = trial_end + dt.timedelta(days=1)
    with freeze_time(grace_day):
        assert new_sales_allowed(db, TENANT_ID) is True
        summary = billing_summary(db, TENANT_ID)
        assert summary["new_sales_allowed"] is True
        assert summary["status"] in {"open", "due_soon", "overdue"}

    # FASE 5: Dia 11 (Carência expirada sem pagamento) -> Vendas bloqueadas
    expired_day = trial_end + dt.timedelta(days=4)
    with freeze_time(expired_day):
        assert new_sales_allowed(db, TENANT_ID) is False
        summary = billing_summary(db, TENANT_ID)
        assert summary["new_sales_allowed"] is False
        assert summary["status"] == "restricted"

    # Isolamento multitenant: outro restaurante não pode liquidar esta fatura
    with freeze_time(expired_day):
        admin_ctx = {"user": "superadmin_koma", "role": "superadmin"}
        payload = ManualPixPaymentRequest(
            amount=CONTRACT_BILLING_AMOUNT,
            bank_reference="E2E9988220261112999888777",
            reason="Comprovante conferido no extrato bancário oficial.",
            receipt_notes="Conta corrente KÔMA",
        )
        with pytest.raises(HTTPException) as cross_tenant_exc:
            confirm_invoice_manual_pix(
                restaurant_id=OTHER_TENANT_ID,
                invoice_id=invoice_id,
                payload=payload,
                admin=admin_ctx,
            )
        assert cross_tenant_exc.value.status_code == 404

    # FASE 6: Confirmação Administrativa Manual do Pix recebido
    with freeze_time(expired_day):
        confirm_res = confirm_invoice_manual_pix(
            restaurant_id=TENANT_ID,
            invoice_id=invoice_id,
            payload=payload,
            admin=admin_ctx,
        )
        assert confirm_res["success"] is True
        assert confirm_res["status"] == "paid"

        with tenant_session_scope(db, TENANT_ID):
            updated_inv = db.query(DirectPixFeeInvoice).filter_by(id=invoice_id).one()
            assert updated_inv.status == "paid"
            assert updated_inv.paid_at is not None

            updated_sub = db.query(SaaSSubscription).filter_by(restaurante_id=TENANT_ID).one()
            assert updated_sub.status == "active"
            end_val = updated_sub.current_period_end
            if end_val.tzinfo is None:
                end_val = end_val.replace(tzinfo=dt.timezone.utc)
            assert end_val > trial_end
            assert end_val.month == 12
            assert end_val.day == 8

            audit = db.query(SuperAdminAuditLog).filter_by(
                restaurante_id=TENANT_ID,
                action="invoice_manual_pix_confirmed",
            ).first()
            assert audit is not None
            assert audit.actor == "superadmin_koma"
            assert "E2E9988220261112999888777" in str(audit.after_data)

            assert new_sales_allowed(db, TENANT_ID) is True
            summary_after = billing_summary(db, TENANT_ID)
            assert summary_after["new_sales_allowed"] is True

    # FASE 7: Idempotência na confirmação administrativa
    with freeze_time(expired_day):
        idempotent_res = confirm_invoice_manual_pix(
            restaurant_id=TENANT_ID,
            invoice_id=invoice_id,
            payload=payload,
            admin=admin_ctx,
        )
        assert idempotent_res["success"] is True
        assert idempotent_res["status"] == "paid"
        assert idempotent_res["message"] == "Fatura já liquidada previamente."

        final_sub = db.query(SaaSSubscription).filter_by(restaurante_id=TENANT_ID).one()
        final_end = final_sub.current_period_end
        if final_end.tzinfo is None:
            final_end = final_end.replace(tzinfo=dt.timezone.utc)
        assert final_end.month == 12
        assert final_end.day == 8

    db.close()


def test_credit_card_subscription_cannot_generate_manual_pix(setup_teardown_tenant):
    _rest, admin_user = setup_teardown_tenant
    db = SessionLocal()
    trial_start = BASE_DATE
    trial_end = BASE_DATE + dt.timedelta(days=7)

    db.add(
        SaaSSubscription(
            restaurante_id=TENANT_ID,
            status="trialing",
            billing_cycle="monthly",
            provider="mercado_pago",
            payment_method_type="credit_card",
            trial_started_at=trial_start,
            trial_ends_at=trial_end,
            current_period_start=trial_start,
            current_period_end=trial_end,
        )
    )
    db.commit()

    with freeze_time(trial_end):
        with pytest.raises(HTTPException) as exc_info:
            generate_subscription_manual_pix(user=admin_user, db=db)
        assert exc_info.value.status_code == 409

    db.close()

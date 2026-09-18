from __future__ import annotations

import datetime
import hashlib
import hmac
import time
from decimal import Decimal

import pytest

from app.config import settings
from app.services.saas_mercadopago import SaasMercadoPagoError, SaasMercadoPagoService


def test_mock_service_creates_card_preapproval_with_seven_days_trial(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "test")
    service = SaasMercadoPagoService("mock-token")
    res = service.create_preapproval(
        protocol="KOMA-CTR-20260907-TEST12345678",
        plan="pro",
        billing_cycle="mensal",
        amount=Decimal("129.00"),
        card_token_id="token_card_123",
        payer_email="cliente@example.com",
    )
    assert res["status"] == "authorized"
    assert res["id"].startswith("mock-sub-")
    assert res["external_reference"] == "KOMA-CTR-20260907-TEST12345678"
    assert res["auto_recurring"]["frequency"] == 1
    assert res["auto_recurring"]["transaction_amount"] == 129.0
    assert res["auto_recurring"]["free_trial"] == {"frequency": 7, "frequency_type": "days"}


def test_mock_service_creates_annual_card_preapproval_frequency_12(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "test")
    service = SaasMercadoPagoService("mock-token")
    res = service.create_preapproval(
        protocol="KOMA-CTR-20260907-TESTANNUAL12",
        plan="pro",
        billing_cycle="anual",
        amount=Decimal("1393.20"),
        card_token_id="token_card_annual",
        payer_email="annual@example.com",
    )
    assert res["auto_recurring"]["frequency"] == 12
    assert res["auto_recurring"]["transaction_amount"] == 1393.20
    assert res["auto_recurring"]["free_trial"]["frequency"] == 7


def test_mock_service_creates_pix_automatic_pending_authorization_with_trial(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "test")
    service = SaasMercadoPagoService("mock-token")
    res = service.create_pix_automatic_preapproval(
        protocol="KOMA-CTR-20260907-PIXAUTO12345",
        plan="pro",
        billing_cycle="mensal",
        amount=Decimal("129.00"),
        payer_email="pix@example.com",
    )
    assert res["id"].startswith("mock-pix-auto-")
    assert res["status"] == "pending"
    assert res["external_reference"] == "KOMA-CTR-20260907-PIXAUTO12345"
    assert res["auto_recurring"]["free_trial"] == {"frequency": 7, "frequency_type": "days"}
    assert "preapproval_id=" in res["init_point"]


def test_mock_service_creates_account_money_pending_authorization_with_trial(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "test")
    service = SaasMercadoPagoService("mock-token")
    res = service.create_account_money_preapproval(
        protocol="KOMA-CTR-20260907-ACCMONEY123",
        plan="pro",
        billing_cycle="mensal",
        amount=Decimal("129.00"),
        payer_email="saldo@example.com",
    )
    assert res["id"].startswith("mock-acc-money-")
    assert res["status"] == "pending"
    assert res["external_reference"] == "KOMA-CTR-20260907-ACCMONEY123"
    assert res["auto_recurring"]["free_trial"] == {"frequency": 7, "frequency_type": "days"}
    assert "preapproval_id=" in res["init_point"]

    retrieved = service.get_preapproval(res["id"])
    assert retrieved["id"] == res["id"]
    assert retrieved["payment_method_id"] == "account_money"
    assert retrieved["status"] == "authorized"


def test_capabilities_never_advertise_upfront_pix(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "test")
    service = SaasMercadoPagoService("mock-token")
    caps = service.checkout_capabilities()
    assert caps["pix"] is False
    assert caps["pix_automatic"] is True
    assert caps["account_money"] is True
    assert caps["trialDays"] == 7
    assert caps["upfrontPaymentAllowed"] is False


def test_real_gateway_defaults_to_card_only_until_optional_methods_are_homologated(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("KOMA_SAAS_CHECKOUT_ENABLED", "true")
    monkeypatch.delenv("KOMA_SAAS_PIX_AUTOMATIC_ENABLED", raising=False)
    monkeypatch.delenv("KOMA_SAAS_ACCOUNT_MONEY_ENABLED", raising=False)
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_PUBLIC_KEY", "APP_USR-public-key")
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_WEBHOOK_SECRET", "webhook-secret")

    service = SaasMercadoPagoService("APP_USR-production-token")
    caps = service.checkout_capabilities()

    assert caps["credit_card"] is True
    assert caps["pix_automatic"] is False
    assert caps["account_money"] is False
    assert caps["pix"] is False
    assert caps["environment"] == "production"
    assert caps["isTestMode"] is False


def test_optional_recurring_methods_require_explicit_feature_flags(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("KOMA_SAAS_CHECKOUT_ENABLED", "true")
    monkeypatch.setenv("KOMA_SAAS_PIX_AUTOMATIC_ENABLED", "true")
    monkeypatch.setenv("KOMA_SAAS_ACCOUNT_MONEY_ENABLED", "true")
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_PUBLIC_KEY", "APP_USR-public-key")
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_WEBHOOK_SECRET", "webhook-secret")

    service = SaasMercadoPagoService("APP_USR-production-token")
    caps = service.checkout_capabilities()

    assert caps["credit_card"] is True
    assert caps["pix_automatic"] is True
    assert caps["account_money"] is True


def test_mock_provider_fails_closed_in_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    service = SaasMercadoPagoService("mock-token")
    assert service.is_mock is True
    assert service.mock_allowed is False

    with pytest.raises(SaasMercadoPagoError, match="não configurada"):
        service.create_preapproval(
            protocol="KOMA-CTR-20260907-FAILCLOSED01",
            plan="pro",
            billing_cycle="mensal",
            amount=Decimal("129.00"),
            card_token_id="token_card_123",
            payer_email="cliente@example.com",
        )

    with pytest.raises(SaasMercadoPagoError, match="não configurada"):
        service.create_pix_automatic_preapproval(
            protocol="KOMA-CTR-20260907-FAILCLOSED02",
            plan="pro",
            billing_cycle="mensal",
            amount=Decimal("129.00"),
            payer_email="cliente@example.com",
        )

    with pytest.raises(SaasMercadoPagoError, match="não configurada"):
        service.create_account_money_preapproval(
            protocol="KOMA-CTR-20260907-FAILCLOSED03",
            plan="pro",
            billing_cycle="mensal",
            amount=Decimal("129.00"),
            payer_email="cliente@example.com",
        )


def test_webhook_without_secret_is_rejected_in_production(monkeypatch):
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_WEBHOOK_SECRET", "")
    monkeypatch.setenv("ENVIRONMENT", "production")
    assert SaasMercadoPagoService.verify_webhook_signature(
        signature_header="",
        request_id="request-production",
        data_id="payment-production",
    ) is False


def test_webhook_without_secret_remains_available_for_test_mocks(monkeypatch):
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_WEBHOOK_SECRET", "")
    monkeypatch.setenv("ENVIRONMENT", "test")
    assert SaasMercadoPagoService.verify_webhook_signature(
        signature_header="",
        request_id="request-test",
        data_id="payment-test",
    ) is True


def test_webhook_signature_verification(monkeypatch):
    secret = "test_webhook_secret_key_12345"
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_WEBHOOK_SECRET", secret)
    now_ts = str(int(time.time()))
    request_id = "req-uuid-12345"
    data_id = "preapp-999888"
    manifest = f"id:{data_id.lower()};request-id:{request_id};ts:{now_ts};"
    v1_sig = hmac.new(secret.encode(), manifest.encode(), hashlib.sha256).hexdigest()
    header = f"ts={now_ts},v1={v1_sig}"
    assert SaasMercadoPagoService.verify_webhook_signature(
        signature_header=header,
        request_id=request_id,
        data_id=data_id,
    ) is True
    assert SaasMercadoPagoService.verify_webhook_signature(
        signature_header=header,
        request_id=request_id,
        data_id="other_id",
    ) is False
    old_ts = str(int(time.time()) - 400)
    old_manifest = f"id:{data_id.lower()};request-id:{request_id};ts:{old_ts};"
    old_sig = hmac.new(secret.encode(), old_manifest.encode(), hashlib.sha256).hexdigest()
    old_header = f"ts={old_ts},v1={old_sig}"
    assert SaasMercadoPagoService.verify_webhook_signature(
        signature_header=old_header,
        request_id=request_id,
        data_id=data_id,
    ) is False

    # Validação com espaços no header e data_id com maiúsculas
    header_with_spaces = f"ts = {now_ts} , v1 = {v1_sig}"
    assert SaasMercadoPagoService.verify_webhook_signature(
        signature_header=header_with_spaces,
        request_id=request_id,
        data_id=data_id,
    ) is True

    upper_id = "PREAPP-ABC-123"
    exact_manifest = f"id:{upper_id};request-id:{request_id};ts:{now_ts};"
    exact_sig = hmac.new(secret.encode(), exact_manifest.encode(), hashlib.sha256).hexdigest()
    assert SaasMercadoPagoService.verify_webhook_signature(
        signature_header=f"ts={now_ts},v1={exact_sig}",
        request_id=request_id,
        data_id=upper_id,
    ) is True


def test_test_token_is_forbidden_in_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    with pytest.raises(SaasMercadoPagoError, match="proibidas em ambiente de produção"):
        SaasMercadoPagoService("TEST-token-12345")


def test_test_token_is_allowed_in_homologation(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "homologation")
    service = SaasMercadoPagoService("TEST-token-12345")
    assert service.is_test_credentials is True
    assert service.environment == "homologation"
    caps = service.checkout_capabilities()
    assert caps["environment"] == "homologation"
    assert caps["isTestMode"] is True


def test_app_usr_token_is_treated_as_test_in_homologation(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "homologation")
    service = SaasMercadoPagoService("APP_USR-6809700222692248-test-token")
    assert service.is_test_credentials is True
    assert service.is_production_credentials is False
    assert service.environment == "homologation"
    caps = service.checkout_capabilities()
    assert caps["environment"] == "homologation"
    assert caps["isTestMode"] is True


def test_test_buyer_rejected_with_production_credentials_for_all_recurring_methods(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    service = SaasMercadoPagoService("APP_USR-prod-token")
    with pytest.raises(SaasMercadoPagoError, match="compradores de teste"):
        service.create_preapproval(
            protocol="KOMA-CTR-20260912-TESTBUYER01",
            plan="pro",
            billing_cycle="mensal",
            amount=Decimal("129.00"),
            card_token_id="tok_123",
            payer_email="test_user_12345@testuser.com",
        )
    with pytest.raises(SaasMercadoPagoError, match="compradores de teste"):
        service.create_pix_automatic_preapproval(
            protocol="KOMA-CTR-20260912-TESTBUYER02",
            plan="pro",
            billing_cycle="mensal",
            amount=Decimal("129.00"),
            payer_email="test_user_99999@testuser.com",
        )
    with pytest.raises(SaasMercadoPagoError, match="compradores de teste"):
        service.create_account_money_preapproval(
            protocol="KOMA-CTR-20260912-TESTBUYER03",
            plan="pro",
            billing_cycle="mensal",
            amount=Decimal("129.00"),
            payer_email="test_user_88888@testuser.com",
        )


def test_update_preapproval_amount_in_mock_preserves_existing_authorization(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "test")
    service = SaasMercadoPagoService("mock-token")
    result = service.update_preapproval_amount(
        "mock-sub-existing",
        amount=Decimal("249.00"),
        plan="premium",
    )
    assert result["id"] == "mock-sub-existing"
    assert result["status"] == "authorized"
    assert result["auto_recurring"] == {
        "transaction_amount": 249.0,
        "currency_id": "BRL",
    }
    assert result["reason"] == "KÔMA - Plano Premium"

    with pytest.raises(SaasMercadoPagoError, match="valor zero"):
        service.update_preapproval_amount(
            "mock-sub-existing",
            amount=Decimal("0.00"),
            plan="pocket",
        )


def test_update_preapproval_next_payment_date_in_mock(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "test")
    service = SaasMercadoPagoService("mock-token")
    future = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=7)
    res = service.update_preapproval_next_payment_date("mock-sub-999", future)
    assert res["id"] == "mock-sub-999"
    assert "next_payment_date" in res


def test_gateway_payer_email_resolution(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "homologation")
    monkeypatch.setenv("KOMA_SAAS_MERCADO_PAGO_TEST_PAYER_EMAIL", "test_user_qa@testuser.com")
    service = SaasMercadoPagoService("APP_USR-test-token")
    assert service._resolve_gateway_payer_email("real@restaurant.com") == "test_user_qa@testuser.com"
    assert service._resolve_gateway_payer_email("test_user_existing@testuser.com") == "test_user_existing@testuser.com"

    monkeypatch.setenv("ENVIRONMENT", "production")
    service_prod = SaasMercadoPagoService("APP_USR-prod-token")
    assert service_prod._resolve_gateway_payer_email("real@restaurant.com") == "real@restaurant.com"


def test_get_authorized_payment_propagates_status_code(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "homologation")
    service = SaasMercadoPagoService("APP_USR-test-token")

    class FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def get(self, url, **kwargs):
            class FakeResponse:
                status_code = 404
                text = "Not Found"

                def json(self):
                    return {"message": "Not Found"}

            return FakeResponse()

    monkeypatch.setattr(service, "_client", lambda: FakeClient())
    with pytest.raises(SaasMercadoPagoError) as exc_info:
        service.get_authorized_payment("123456")
    assert exc_info.value.status_code == 404

    with pytest.raises(SaasMercadoPagoError) as exc_info_search:
        service.find_preapproval("PROTO", "test@test.com")
    assert exc_info_search.value.status_code == 404


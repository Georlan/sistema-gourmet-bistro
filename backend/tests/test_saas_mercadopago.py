from __future__ import annotations

import datetime
import hashlib
import hmac
import time
from decimal import Decimal

import pytest

from app.config import settings
from app.services.saas_mercadopago import (
    SaasMercadoPagoError,
    SaasMercadoPagoService,
    default_saas_mp_service,
)


def test_mock_service_creates_preapproval_with_seven_days_trial():
    service = SaasMercadoPagoService("mock-token")
    assert service.is_mock is True

    res = service.create_preapproval(
        protocol="KOMA-CTR-20260907-TEST12345678",
        plan="pro",
        billing_cycle="mensal",
        amount=Decimal("189.00"),
        card_token_id="token_card_123",
        payer_email="cliente@example.com",
    )

    assert res["status"] == "authorized"
    assert res["id"].startswith("mock-sub-")
    assert res["payer_email"] == "cliente@example.com"
    assert res["external_reference"] == "KOMA-CTR-20260907-TEST12345678"
    assert res["auto_recurring"]["frequency"] == 1
    assert res["auto_recurring"]["frequency_type"] == "months"
    assert res["auto_recurring"]["transaction_amount"] == 189.0
    assert res["auto_recurring"]["free_trial"]["frequency"] == 7
    assert res["auto_recurring"]["free_trial"]["frequency_type"] == "days"


def test_mock_service_creates_annual_preapproval_frequency_12():
    service = SaasMercadoPagoService("mock-token")
    res = service.create_preapproval(
        protocol="KOMA-CTR-20260907-TESTANNUAL12",
        plan="pocket",
        billing_cycle="anual",
        amount=Decimal("1177.20"),
        card_token_id="token_card_annual",
        payer_email="annual@example.com",
    )
    assert res["auto_recurring"]["frequency"] == 12
    assert res["auto_recurring"]["transaction_amount"] == 1177.20
    assert res["auto_recurring"]["free_trial"]["frequency"] == 7


def test_mock_service_creates_annual_pix():
    service = SaasMercadoPagoService("mock-token")
    res = service.create_annual_pix(
        protocol="KOMA-CTR-20260907-PIX12345678",
        plan="pocket",
        amount=Decimal("1177.20"),
        payer_email="pix@example.com",
        payer_name="Dono do Restaurante",
        payer_tax_id="12345678909",
    )

    assert res["id"].startswith("mock-pix-")
    assert res["status"] == "pending"
    assert "br.gov.bcb.pix" in res["qr_code"]
    assert res["ticket_url"].endswith(res["id"] + "/ticket")


def test_webhook_signature_verification(monkeypatch):
    secret = "test_webhook_secret_key_12345"
    monkeypatch.setattr(settings, "KOMA_SAAS_MERCADO_PAGO_WEBHOOK_SECRET", secret)

    now_ts = str(int(time.time()))
    request_id = "req-uuid-12345"
    data_id = "preapp-999888"

    manifest = f"id:{data_id.lower()};request-id:{request_id};ts:{now_ts};"
    v1_sig = hmac.new(secret.encode(), manifest.encode(), hashlib.sha256).hexdigest()
    header = f"ts={now_ts},v1={v1_sig}"

    # Valid signature
    assert SaasMercadoPagoService.verify_webhook_signature(
        signature_header=header,
        request_id=request_id,
        data_id=data_id,
    ) is True

    # Tampered data_id
    assert SaasMercadoPagoService.verify_webhook_signature(
        signature_header=header,
        request_id=request_id,
        data_id="other_id",
    ) is False

    # Expired timestamp (> 300s)
    old_ts = str(int(time.time()) - 400)
    old_manifest = f"id:{data_id.lower()};request-id:{request_id};ts:{old_ts};"
    old_sig = hmac.new(secret.encode(), old_manifest.encode(), hashlib.sha256).hexdigest()
    old_header = f"ts={old_ts},v1={old_sig}"
    assert SaasMercadoPagoService.verify_webhook_signature(
        signature_header=old_header,
        request_id=request_id,
        data_id=data_id,
    ) is False

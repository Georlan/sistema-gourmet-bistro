from decimal import Decimal

import pytest

import app.services as services_package
from app.services.saas_mercadopago import SaasMercadoPagoError
from app.services.saas_pix_automatic import (
    UNIVERSAL_PIX_AUTOMATIC_CAPABILITY,
    UniversalPixAutomaticService,
)


def test_universal_pix_capability_is_fail_closed_until_receiver_api_exists():
    capability = UNIVERSAL_PIX_AUTOMATIC_CAPABILITY.as_dict()

    assert capability["enabled"] is False
    assert capability["mode"] == "universal_pix_automatic"
    assert capability["provider"] == "mercado_pago"
    assert capability["receiver"] == "koma_mercado_pago_account"
    assert capability["interoperability"] == "spi_any_compatible_payer_psp"
    assert capability["qrAuthorizationRequired"] is True
    assert capability["copyPasteAuthorizationRequired"] is True
    assert capability["reason"] == "provider_receiver_api_not_configured"


def test_checkout_boundary_never_reenables_legacy_hosted_pix_flag():
    caps = services_package._with_universal_pix_boundary(
        {
            "credit_card": True,
            "pix_automatic": True,
            "account_money": True,
            "publicKey": "APP_USR-public",
        }
    )

    assert caps["credit_card"] is True
    assert caps["account_money"] is True
    assert caps["pix_automatic"] is False
    assert caps["pixAutomatic"]["mode"] == "universal_pix_automatic"
    assert caps["pixAutomatic"]["enabled"] is False


def test_universal_pix_adapter_refuses_to_fallback_to_hosted_subscription_checkout():
    service = UniversalPixAutomaticService()

    with pytest.raises(SaasMercadoPagoError) as exc_info:
        service.create_authorization(
            protocol="KOMA-CTR-20260915-AABBCCDDEEFF",
            plan="premium",
            billing_cycle="monthly",
            amount=Decimal("309.00"),
            payer_email="cliente@example.com",
            trial_days=7,
        )

    assert exc_info.value.status_code == 503
    assert "interoperável" in str(exc_info.value)
    assert "QR Code/Copia e Cola" in str(exc_info.value)


def test_canonical_gateway_pix_entrypoint_uses_universal_adapter_not_preapproval_plan():
    with pytest.raises(SaasMercadoPagoError) as exc_info:
        services_package._hosted_saas_mp_service.create_pix_automatic_preapproval(
            protocol="KOMA-CTR-20260915-112233AABBCC",
            plan="pro",
            billing_cycle="monthly",
            amount=Decimal("209.00"),
            payer_email="cliente@example.com",
            trial_days=7,
        )

    assert exc_info.value.status_code == 503
    assert "Pix Automático universal" in str(exc_info.value)

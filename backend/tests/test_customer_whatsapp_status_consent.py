"""Voluntary order-only WhatsApp updates, including fast guest checkout."""
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.schemas import CardapioPedidoCreate
from app.services.customer_status_whatsapp import (
    checkout_status_consent,
    eligible_order_status_recipient,
)


def _request(**changes):
    raw = {
        "restaurante_id": 4,
        "cliente_nome": "Cliente de teste",
        "cliente_telefone": "11987654321",
        "itens": [{"produto_id": "prod-test", "quantidade": 1}],
    }
    raw.update(changes)
    return CardapioPedidoCreate(**raw)


def test_checkout_opt_in_disabled_by_default_even_when_phone_present():
    assert _request().whatsapp_status_opt_in is False
    assert _request(whatsapp_status_opt_in=True).whatsapp_status_opt_in is True
    with pytest.raises(ValidationError):
        _request(whatsapp_status_opt_in="true")


def test_voluntary_guest_consent_needs_no_token_account_or_email():
    assert checkout_status_consent(
        requested=True, phone="11987654321", fulfillment="retirada",
    )
    assert checkout_status_consent(
        requested=True, phone="5511987654321", fulfillment="delivery",
    )
    assert not checkout_status_consent(
        requested=False, phone="11987654321", fulfillment="delivery",
    )
    assert not checkout_status_consent(
        requested=True, phone="11987654321", fulfillment="consumo_local",
    )
    assert not checkout_status_consent(
        requested=True, phone="123", fulfillment="retirada",
    )
    assert not checkout_status_consent(
        requested=True, phone=None, fulfillment="delivery",
    )


def test_guest_order_eligibility_is_per_tenant_and_order_without_profile_attachment():
    order = SimpleNamespace(
        restaurante_id=7, cliente_id=None,
        delivery_telefone="11987654321", whatsapp_status_opt_in=True,
    )
    assert eligible_order_status_recipient(
        restaurant_id=7, order=order, customer=None,
    )
    assert not eligible_order_status_recipient(
        restaurant_id=8, order=order, customer=None,
    )
    assert not eligible_order_status_recipient(
        restaurant_id=7, order=order, customer=None, opted_out=True,
    )
    # No matching a guest phone to an unrelated Cliente record.
    other = SimpleNamespace(id="other", restaurante_id=7, telefone="11987654321")
    assert not eligible_order_status_recipient(
        restaurant_id=7, order=order, customer=other,
    )
    order.whatsapp_status_opt_in = False
    assert not eligible_order_status_recipient(
        restaurant_id=7, order=order, customer=None,
    )
    order.whatsapp_status_opt_in = True
    order.delivery_telefone = "not a valid phone"
    assert not eligible_order_status_recipient(
        restaurant_id=7, order=order, customer=None,
    )


def test_registered_order_requires_matching_customer_in_same_tenant():
    order = SimpleNamespace(
        restaurante_id=7, cliente_id="customer-1",
        delivery_telefone="11987654321", whatsapp_status_opt_in=True,
    )
    customer = SimpleNamespace(
        id="customer-1", restaurante_id=7, telefone="5511987654321",
    )
    assert eligible_order_status_recipient(
        restaurant_id=7, order=order, customer=customer,
    )
    assert not eligible_order_status_recipient(
        restaurant_id=7, order=order, customer=None,
    )
    customer.restaurante_id = 8
    assert not eligible_order_status_recipient(
        restaurant_id=7, order=order, customer=customer,
    )
    customer.restaurante_id = 7
    customer.telefone = "11911112222"
    assert not eligible_order_status_recipient(
        restaurant_id=7, order=order, customer=customer,
    )
    customer.telefone = "11987654321"
    customer.id = "other"
    assert not eligible_order_status_recipient(
        restaurant_id=7, order=order, customer=customer,
    )

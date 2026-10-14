"""No automated customer WhatsApp without verified, tenant-scoped consent."""
import datetime as dt
from types import SimpleNamespace

from app.schemas import CardapioPedidoCreate
from app.services.customer_status_whatsapp import (
    eligible_order_status_recipient,
    verified_checkout_consent,
)


def test_checkout_opt_in_is_disabled_by_default():
    request = CardapioPedidoCreate(
        restaurante_id=4,
        cliente_nome="Cliente de teste",
        cliente_telefone="11987654321",
        itens=[{"produto_id": "prod-test", "quantidade": 1}],
    )
    assert request.whatsapp_status_opt_in is False


def test_consent_requires_authenticated_phone_verified_customer():
    verified = SimpleNamespace(telefone="11987654321",
                               telefone_verificado_em=dt.datetime.now(dt.timezone.utc))
    unverified = SimpleNamespace(telefone="11987654321", telefone_verificado_em=None)
    assert verified_checkout_consent(requested=True, customer_token="session", customer=verified)
    assert not verified_checkout_consent(requested=False, customer_token="session", customer=verified)
    assert not verified_checkout_consent(requested=True, customer_token=None, customer=verified)
    assert not verified_checkout_consent(requested=True, customer_token="session", customer=unverified)
    assert not verified_checkout_consent(requested=True, customer_token="session", customer=None)


def test_eligibility_enforces_order_customer_tenant_and_phone():
    now = dt.datetime.now(dt.timezone.utc)
    order = SimpleNamespace(
        restaurante_id=7, cliente_id="customer-1",
        delivery_telefone="11987654321", whatsapp_status_opt_in=True,
    )
    customer = SimpleNamespace(
        id="customer-1", restaurante_id=7,
        telefone="5511987654321", telefone_verificado_em=now,
    )
    assert eligible_order_status_recipient(restaurant_id=7, order=order, customer=customer)
    assert not eligible_order_status_recipient(restaurant_id=8, order=order, customer=customer)
    customer.restaurante_id = 8
    assert not eligible_order_status_recipient(restaurant_id=7, order=order, customer=customer)
    customer.restaurante_id = 7
    customer.telefone = "11911112222"
    assert not eligible_order_status_recipient(restaurant_id=7, order=order, customer=customer)
    customer.telefone = "11987654321"
    order.whatsapp_status_opt_in = False
    assert not eligible_order_status_recipient(restaurant_id=7, order=order, customer=customer)
    order.whatsapp_status_opt_in = True
    customer.telefone_verificado_em = None
    assert not eligible_order_status_recipient(restaurant_id=7, order=order, customer=customer)

"""Explicit deployment allowlist for uncontracted payment test restaurants.

Never creates commercial terms, subscriptions, or automatic platform charges.
"""
import os

TEST_TERMS_VERSION = 'direct-pix-test-v1'


def test_tenant_allowed(restaurant_id: int) -> bool:
    values = os.getenv('DIRECT_PIX_TEST_TENANT_IDS', '').split(',')
    return str(restaurant_id) in {value.strip() for value in values if value.strip().isdigit()}


def test_registration_allowed(db, restaurant_id: int) -> bool:
    from ..saas_billing_models import SaaSSubscription
    return test_tenant_allowed(restaurant_id) and db.query(SaaSSubscription.id).filter(
        SaaSSubscription.restaurante_id == restaurant_id).first() is None

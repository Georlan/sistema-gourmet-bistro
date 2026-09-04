from app.routes import super_admin


def test_payment_status_never_exposes_provider_credentials():
    assert super_admin._payment_status(None) == "disconnected"


def test_tenant_read_model_uses_security_definer_discovery_on_postgres():
    source = __import__("inspect").getsource(super_admin._discover_restaurant_ids)
    assert "koma_internal.list_public_restaurants" in source
    assert "BYPASSRLS" not in source

from pathlib import Path

import pytest

from app.restaurant_profile_models import RestauranteOperationProfile
from app.restaurant_profile_templates import build_template_preview, list_template_keys


ROOT = Path(__file__).resolve().parents[2]


def _walk(value):
    if isinstance(value, dict):
        for key, item in value.items():
            yield key, item
            yield from _walk(item)
    elif isinstance(value, list):
        for item in value:
            yield from _walk(item)


@pytest.mark.parametrize("profile_key", ["pizzaria", "acai", "churrasco"])
def test_supported_profiles_are_preview_only_and_never_carry_prices(profile_key):
    assert profile_key in list_template_keys()
    preview = build_template_preview(profile_key)

    assert preview is not None
    assert preview["profile_key"] == profile_key
    assert preview["mode"] == "preview"
    assert preview["requires_confirmation"] is True

    forbidden_price_keys = {
        "price",
        "preco",
        "preço",
        "amount",
        "value",
        "valor",
        "discount",
        "desconto",
    }
    present_keys = {str(key).lower() for key, _ in _walk(preview)}
    assert forbidden_price_keys.isdisjoint(present_keys)


def test_unknown_profile_never_falls_back_to_an_unrelated_template():
    assert build_template_preview("generic") is None
    assert build_template_preview("hamburgueria") is None
    assert build_template_preview("unknown-profile") is None


def test_operation_profile_model_remains_metadata_only():
    table = RestauranteOperationProfile.__table__
    assert set(table.columns.keys()) == {"restaurante_id", "profile_key"}
    assert table.c.restaurante_id.primary_key is True
    assert table.c.profile_key.nullable is False
    assert str(table.c.profile_key.server_default.arg) == "generic"


def test_profile_storage_migration_enforces_rls_and_tenant_policy():
    migration = (
        ROOT
        / "backend"
        / "alembic"
        / "versions"
        / "7f8091a2b3c4_add_restaurant_operation_profiles.py"
    ).read_text(encoding="utf-8")

    assert "ENABLE ROW LEVEL SECURITY" in migration
    assert "FORCE ROW LEVEL SECURITY" in migration
    assert "restaurante_operation_profiles" in migration
    assert "app.current_restaurante_id" in migration
    for operation in ("SELECT", "INSERT", "UPDATE", "DELETE"):
        assert operation in migration


def test_superadmin_onboarding_does_not_create_catalog_or_modifiers_implicitly():
    onboarding = (
        ROOT / "backend" / "app" / "routes" / "super_admin_onboarding.py"
    ).read_text(encoding="utf-8")

    forbidden_domain_models = (
        "Categoria(",
        "Produto(",
        "GrupoModificador(",
        "OpcaoModificador(",
    )
    for token in forbidden_domain_models:
        assert token not in onboarding

    assert "Mercado Pago" in onboarding
    assert "explicitamente desconectado" in onboarding

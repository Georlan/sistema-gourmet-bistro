from __future__ import annotations

import datetime
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.main import app
from app.routes.onboarding import (
    _profile_is_configured,
    _required_progress,
    _trial_status_payload,
)
from app.services.onboarding_readiness import evaluate_operation_readiness
from app.services.operational_modes import (
    explicit_order_types,
    mode_is_allowed,
    normalize_active_order_types,
)


def test_onboarding_routes_are_registered_once():
    openapi_paths = app.openapi().get("paths", {})
    assert "get" in openapi_paths["/api/onboarding/status"]
    assert "put" in openapi_paths["/api/onboarding/operations"]
    assert "post" in openapi_paths["/api/onboarding/start-trial"]

    with TestClient(app) as client:
        assert client.get("/api/onboarding/status").status_code == 401
        assert client.put("/api/onboarding/operations", json={"order_types": ["retirada"]}).status_code == 401
        assert client.post("/api/onboarding/start-trial").status_code == 401


def test_trial_projection_reports_real_remaining_days_without_mutation():
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = _trial_status_payload(
        {
            "trial_started_at": now - datetime.timedelta(hours=1),
            "trial_ends_at": now + datetime.timedelta(days=1, hours=2),
            "trial_status": "active",
        }
    )
    assert payload["status"] == "active"
    assert payload["daysRemaining"] == 2
    assert payload["startsAt"]
    assert payload["endsAt"]


def test_expired_active_trial_is_projected_as_expired():
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = _trial_status_payload(
        {
            "trial_started_at": now - datetime.timedelta(days=8),
            "trial_ends_at": now - datetime.timedelta(seconds=1),
            "trial_status": "active",
        }
    )
    assert payload["status"] == "expired"
    assert payload["daysRemaining"] == 0


def test_profile_progress_requires_real_profile_content():
    empty = SimpleNamespace(endereco=None, subtitulo="", sobre_nos=None, logo_url=None, banner_url=None)
    configured = SimpleNamespace(
        endereco="Rua de teste, 100",
        subtitulo="",
        sobre_nos=None,
        logo_url=None,
        banner_url=None,
    )
    assert _profile_is_configured(empty) is False
    assert _profile_is_configured(configured) is True


def test_required_progress_has_four_configuration_items_only():
    steps = {
        "profile": True,
        "hours": True,
        "catalog": True,
        "operations": True,
        "mercadoPago": False,
        "firstOrder": False,
    }
    assert _required_progress(steps) == {"completed": 4, "total": 4, "percent": 100}


def test_required_progress_does_not_let_optional_payment_or_test_mask_setup():
    steps = {
        "profile": False,
        "hours": True,
        "catalog": False,
        "operations": True,
        "mercadoPago": True,
        "firstOrder": True,
    }
    assert _required_progress(steps) == {"completed": 2, "total": 4, "percent": 50}


def _config(**overrides):
    values = {
        "tipos_pedido_ativos": ["retirada"],
        "mapa_mesas_ativo": False,
        "delivery_ativo": False,
        "tipo_taxa_entrega": "fixa",
        "taxa_entrega_fixa": 7.0,
        "tabela_taxas_bairros": [],
        "tabela_taxas_km": [],
        "taxa_servico_ativa": False,
        "taxa_servico_padrao": 10.0,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _restaurant(**overrides):
    values = {"latitude": None, "longitude": None}
    values.update(overrides)
    return SimpleNamespace(**values)


def test_legacy_null_policy_does_not_change_runtime_until_explicitly_saved():
    legacy = _config(tipos_pedido_ativos=None)
    assert explicit_order_types(legacy) is None
    assert mode_is_allowed(legacy, "retirada") is True
    assert mode_is_allowed(legacy, "delivery") is True
    assert mode_is_allowed(legacy, "consumo_local") is True


def test_explicit_policy_is_runtime_authority():
    config = _config(tipos_pedido_ativos=["retirada", "delivery", "retirada"])
    assert normalize_active_order_types(config.tipos_pedido_ativos) == ["retirada", "delivery"]
    assert mode_is_allowed(config, "retirada") is True
    assert mode_is_allowed(config, "delivery") is True
    assert mode_is_allowed(config, "consumo_local") is False


def test_new_tenant_requires_explicit_modes_but_legacy_started_tenant_does_not():
    config = _config(tipos_pedido_ativos=None)
    new_tenant = evaluate_operation_readiness(
        config=config,
        restaurant=_restaurant(),
        table_count=0,
        legacy_policy_allowed=False,
    )
    legacy_tenant = evaluate_operation_readiness(
        config=config,
        restaurant=_restaurant(),
        table_count=0,
        legacy_policy_allowed=True,
    )
    assert new_tenant["ready"] is False
    assert "order_types" in new_tenant["blockers"]
    assert legacy_tenant["ready"] is True
    assert legacy_tenant["legacyPolicy"] is True


def test_dine_in_without_table_map_is_ready_without_tables():
    result = evaluate_operation_readiness(
        config=_config(tipos_pedido_ativos=["consumo_local"], mapa_mesas_ativo=False),
        restaurant=_restaurant(),
        table_count=0,
        legacy_policy_allowed=False,
    )
    assert result["ready"] is True


def test_dine_in_with_table_map_requires_one_table():
    result = evaluate_operation_readiness(
        config=_config(tipos_pedido_ativos=["consumo_local"], mapa_mesas_ativo=True),
        restaurant=_restaurant(),
        table_count=0,
        legacy_policy_allowed=False,
    )
    assert result["ready"] is False
    assert "dine_in_tables" in result["blockers"]


def test_delivery_requires_existing_delivery_configuration_only_when_selected():
    blocked = evaluate_operation_readiness(
        config=_config(tipos_pedido_ativos=["delivery"], delivery_ativo=False),
        restaurant=_restaurant(),
        table_count=0,
        legacy_policy_allowed=False,
    )
    pickup = evaluate_operation_readiness(
        config=_config(tipos_pedido_ativos=["retirada"], delivery_ativo=False),
        restaurant=_restaurant(),
        table_count=0,
        legacy_policy_allowed=False,
    )
    assert blocked["ready"] is False
    assert "delivery_configuration" in blocked["blockers"]
    assert pickup["ready"] is True

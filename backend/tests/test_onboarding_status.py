from __future__ import annotations

import datetime
from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from fastapi.testclient import TestClient

from app.main import app
from app.routes import onboarding as onboarding_routes
from app.routes.onboarding import (
    _operations_step_is_complete,
    _profile_is_configured,
    _required_progress,
    _trial_status_payload,
    start_trial_after_readiness,
)
from app.routes.super_admin_onboarding import (
    SuperAdminOperationsUpdateRequest,
    _commercial_release_preview,
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
    assert "put" in openapi_paths["/api/onboarding/operation-profile"]
    assert "post" in openapi_paths["/api/onboarding/tables/bootstrap"]
    assert "post" in openapi_paths["/api/onboarding/start-trial"]
    assert "get" in openapi_paths["/api/super-admin/onboarding/restaurantes/{tenant_id}/release"]
    assert "post" in openapi_paths["/api/super-admin/onboarding/restaurantes/{tenant_id}/release"]
    assert "post" in openapi_paths["/api/super-admin/onboarding/restaurantes/{tenant_id}/tables/bootstrap"]
    assert "put" in openapi_paths["/api/super-admin/onboarding/restaurantes/{tenant_id}/operations"]

    with TestClient(app) as client:
        assert client.get("/api/onboarding/status").status_code == 401
        assert client.put("/api/onboarding/operations", json={"order_types": ["retirada"]}).status_code == 401
        assert client.put("/api/onboarding/operation-profile", json={"operation_profile": "pizzaria"}).status_code == 401
        assert client.post("/api/onboarding/tables/bootstrap", json={"count": 30, "default_capacity": 4}).status_code == 401
        assert client.post("/api/onboarding/start-trial").status_code == 401
        assert client.get("/api/super-admin/onboarding/restaurantes/1/release").status_code == 401
        assert client.post("/api/super-admin/onboarding/restaurantes/1/release").status_code == 401
        assert client.post(
            "/api/super-admin/onboarding/restaurantes/1/tables/bootstrap",
            json={"count": 30, "default_capacity": 4, "reason": "implantação"},
        ).status_code == 401
        assert client.put(
            "/api/super-admin/onboarding/restaurantes/1/operations",
            json={"order_types": ["retirada", "delivery"], "reason": "correção administrativa"},
        ).status_code == 401


def test_restaurant_admin_cannot_start_commercial_trial():
    with pytest.raises(HTTPException) as error:
        start_trial_after_readiness(
            db=None,
            current_user=SimpleNamespace(cargo="admin", role="admin"),
        )
    assert error.value.status_code == 403


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


def test_saved_delivery_completes_modalities_step_while_delivery_setup_is_pending():
    operations = evaluate_operation_readiness(
        config=_config(tipos_pedido_ativos=["delivery"], delivery_ativo=False),
        restaurant=_restaurant(),
        table_count=0,
        legacy_policy_allowed=False,
    )

    assert operations["configured"] is True
    assert operations["ready"] is False
    assert "delivery_configuration" in operations["blockers"]
    assert _operations_step_is_complete(operations) is True

    steps = {
        "profile": True,
        "hours": True,
        "catalog": True,
        "operations": _operations_step_is_complete(operations),
        "mercadoPago": False,
        "firstOrder": False,
    }
    assert _required_progress(steps) == {"completed": 4, "total": 4, "percent": 100}



def test_superadmin_release_preview_reuses_canonical_onboarding_projection(monkeypatch):
    snapshot = {
        "restaurant": {"id": "7", "name": "Pizzaria QA", "plan": "pro", "operationProfile": "pizzaria"},
        "steps": {"profile": True, "hours": False, "catalog": False, "operations": True, "mercadoPago": False, "firstOrder": False},
        "operations": {
            "configured": True,
            "ready": False,
            "orderTypes": ["retirada", "delivery"],
            "tableMapEnabled": False,
            "capabilities": {
                "dineIn": {"enabled": False, "ready": True},
                "pickup": {"enabled": True, "ready": True},
                "delivery": {"enabled": True, "ready": False},
            },
            "blockers": ["delivery_configuration"],
        },
        "counts": {"products": 0, "activeProducts": 0, "orders": 0, "tables": 0},
        "catalogAssistance": {"status": "processing", "filename": "menu.pdf"},
        "progress": {"completed": 2, "total": 4, "percent": 50},
        "payments": {"mercadoPagoConnected": False, "pixOnlineAvailable": False},
        "onboarding": {"mode": "commercial", "releaseState": "configuring", "operationReleased": False, "requiresKomaRelease": True},
        "trial": {"status": "not_started", "startsAt": None, "endsAt": None, "daysRemaining": 0},
        "readiness": {
            "configurationComplete": False,
            "trialStarted": False,
            "operationReleased": False,
            "readyToOperate": False,
            "blockers": ["hours", "catalog"],
        },
        "readyForRelease": False,
    }

    monkeypatch.setattr(
        onboarding_routes,
        "_build_onboarding_status",
        lambda db, current_user: snapshot,
    )

    subscription = SimpleNamespace(
        status="onboarding",
        billing_cycle="monthly",
        payment_method_type="card",
        trial_started_at=None,
        trial_ends_at=None,
    )

    class QueryStub:
        def filter(self, *args, **kwargs):
            return self

        def one_or_none(self):
            return subscription

    class DbStub:
        def query(self, *args, **kwargs):
            return QueryStub()

    preview = _commercial_release_preview(DbStub(), 7)

    assert preview["operations"] is snapshot["operations"]
    assert preview["catalogAssistance"] is snapshot["catalogAssistance"]
    assert preview["progress"] is snapshot["progress"]
    assert preview["payments"] is snapshot["payments"]
    assert preview["onboarding"] is snapshot["onboarding"]
    assert preview["trial"] is snapshot["trial"]
    assert preview["readiness"] is snapshot["readiness"]
    assert preview["readyForRelease"] is False
    assert preview["trialStarted"] is False





def test_ready_owner_notification_only_fires_for_completed_commercial_setup(monkeypatch):
    calls = []
    monkeypatch.setattr(
        onboarding_routes,
        "enqueue_onboarding_ready_owner",
        lambda db, **kwargs: calls.append((db, kwargs)) or True,
    )
    db = object()
    base = {
        "restaurant": {"id": "12", "name": "Restaurante 12", "plan": "pocket"},
        "onboarding": {"mode": "commercial", "releaseState": "configuring"},
        "readiness": {"configurationComplete": False},
    }

    assert onboarding_routes._enqueue_release_ready_owner_notification(db, base) is False
    assert calls == []

    administrative = {
        **base,
        "onboarding": {"mode": "administrative", "releaseState": "released"},
        "readiness": {"configurationComplete": True},
    }
    assert onboarding_routes._enqueue_release_ready_owner_notification(db, administrative) is False
    assert calls == []

    ready = {
        **base,
        "onboarding": {"mode": "commercial", "releaseState": "awaiting_koma"},
        "readiness": {"configurationComplete": True},
    }
    assert onboarding_routes._enqueue_release_ready_owner_notification(db, ready) is True
    assert calls == [
        (
            db,
            {
                "tenant_id": "12",
                "restaurant_name": "Restaurante 12",
                "plan": "pocket",
            },
        )
    ]


def test_superadmin_operations_payload_is_narrow_and_requires_reason():
    payload = SuperAdminOperationsUpdateRequest(
        order_types=["retirada", "delivery"],
        reason="Correção da implantação",
    )
    assert payload.order_types == ["retirada", "delivery"]

    with pytest.raises(ValidationError):
        SuperAdminOperationsUpdateRequest(
            order_types=[],
            reason="Correção",
        )

    with pytest.raises(ValidationError):
        SuperAdminOperationsUpdateRequest(
            order_types=["retirada"],
            reason="Correção",
            taxa_entrega_fixa=7,
        )

@pytest.mark.parametrize("missing", ["nome", "endereco", "whatsapp"])
def test_commercial_setup_requires_all_identity_fields(missing):
    restaurant = SimpleNamespace(nome="Pizzaria", endereco="Rua A, 10", socials={"whatsapp": "85999999999"},
                                subtitulo="Slogan", sobre_nos="Sobre", logo_url="logo.png", banner_url="banner.png")
    if missing == "whatsapp":
        restaurant.socials["whatsapp"] = "  "
    else:
        setattr(restaurant, missing, "  ")
    assert _profile_is_configured(restaurant, require_essentials=True) is False
    # Existing released/legacy tenants retain their historical progress.
    assert _profile_is_configured(restaurant) is True

@pytest.mark.parametrize("socials", [{"whatsapp": "85999999999"}, '{"whatsapp":"85999999999"}'])
def test_commercial_setup_accepts_canonical_and_legacy_json_contact(socials):
    restaurant = SimpleNamespace(nome="Pizzaria", endereco="Rua A, 10", socials=socials)
    assert _profile_is_configured(restaurant, require_essentials=True) is True

@pytest.mark.parametrize("socials", [None, [], "invalid-json", {}])
def test_commercial_setup_rejects_missing_contact_without_error(socials):
    restaurant = SimpleNamespace(nome="Pizzaria", endereco="Rua A, 10", socials=socials)
    assert _profile_is_configured(restaurant, require_essentials=True) is False

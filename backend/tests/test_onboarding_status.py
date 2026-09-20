from __future__ import annotations

import datetime
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.main import app
from app.routes.onboarding import (
    _operation_readiness,
    _profile_is_configured,
    _required_progress,
    _trial_status_payload,
)


def test_onboarding_routes_are_registered_once():
    openapi_paths = app.openapi().get("paths", {})
    assert "/api/onboarding/status" in openapi_paths
    assert "get" in openapi_paths["/api/onboarding/status"]
    assert "/api/onboarding/start-trial" in openapi_paths
    assert "post" in openapi_paths["/api/onboarding/start-trial"]

    with TestClient(app) as client:
        response = client.get("/api/onboarding/status")
        assert response.status_code == 401
        response = client.post("/api/onboarding/start-trial")
        assert response.status_code == 401


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
    empty = SimpleNamespace(
        endereco=None,
        subtitulo="",
        sobre_nos=None,
        logo_url=None,
        banner_url=None,
    )
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

    assert _required_progress(steps) == {
        "completed": 4,
        "total": 4,
        "percent": 100,
    }


def test_required_progress_does_not_let_validation_or_optional_payment_mask_setup():
    steps = {
        "profile": False,
        "hours": True,
        "catalog": False,
        "operations": True,
        "mercadoPago": True,
        "firstOrder": True,
    }

    assert _required_progress(steps) == {
        "completed": 2,
        "total": 4,
        "percent": 50,
    }


def _operation_config(**overrides):
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
    values = {
        "pagamento_online_ativo": False,
        "latitude": None,
        "longitude": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_dine_in_with_table_map_requires_at_least_one_table():
    config = _operation_config(
        tipos_pedido_ativos=["consumo_local", "retirada"],
        mapa_mesas_ativo=True,
    )

    blocked = _operation_readiness(
        config=config,
        restaurant=_restaurant(),
        table_count=0,
        mercado_pago_connected=False,
    )
    assert blocked["ready"] is False
    assert "dine_in_tables" in blocked["blockers"]

    ready = _operation_readiness(
        config=config,
        restaurant=_restaurant(),
        table_count=1,
        mercado_pago_connected=False,
    )
    assert ready["ready"] is True


def test_delivery_and_service_charge_use_existing_configuration_as_capabilities():
    payload = _operation_readiness(
        config=_operation_config(
            tipos_pedido_ativos=["delivery"],
            delivery_ativo=True,
            tipo_taxa_entrega="fixa",
            taxa_entrega_fixa=6.0,
            taxa_servico_ativa=True,
            taxa_servico_padrao=10.0,
        ),
        restaurant=_restaurant(),
        table_count=0,
        mercado_pago_connected=False,
    )

    assert payload["ready"] is True
    assert payload["capabilities"]["delivery"] == {"enabled": True, "ready": True}
    assert payload["capabilities"]["serviceCharge"] == {"enabled": True, "ready": True}


def test_mercado_pago_blocks_only_when_online_payment_is_enabled():
    config = _operation_config(tipos_pedido_ativos=["retirada"])

    offline = _operation_readiness(
        config=config,
        restaurant=_restaurant(pagamento_online_ativo=False),
        table_count=0,
        mercado_pago_connected=False,
    )
    assert offline["ready"] is True
    assert "mercado_pago" not in offline["blockers"]

    online = _operation_readiness(
        config=config,
        restaurant=_restaurant(pagamento_online_ativo=True),
        table_count=0,
        mercado_pago_connected=False,
    )
    assert online["ready"] is False
    assert "mercado_pago" in online["blockers"]

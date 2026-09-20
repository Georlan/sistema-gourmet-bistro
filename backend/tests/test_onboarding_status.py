from __future__ import annotations

import datetime
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.main import app
from app.routes.onboarding import (
    _profile_is_configured,
    _required_progress,
    _should_start_trial_after_onboarding,
    _trial_status_payload,
)


def test_onboarding_status_route_is_registered_once():
    openapi_paths = app.openapi().get("paths", {})
    assert "/api/onboarding/status" in openapi_paths
    assert "get" in openapi_paths["/api/onboarding/status"]

    with TestClient(app) as client:
        response = client.get("/api/onboarding/status")
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


def test_required_progress_excludes_optional_mercado_pago_and_first_order():
    steps = {
        "profile": True,
        "hours": True,
        "catalog": True,
        "mercadoPago": False,
        "firstOrder": False,
    }

    assert _required_progress(steps) == {
        "completed": 3,
        "total": 3,
        "percent": 100,
    }


def test_required_progress_does_not_let_optional_steps_mask_missing_setup():
    steps = {
        "profile": False,
        "hours": True,
        "catalog": False,
        "mercadoPago": True,
        "firstOrder": True,
    }

    assert _required_progress(steps) == {
        "completed": 1,
        "total": 3,
        "percent": 33,
    }



def test_support_mode_never_starts_trial_from_status_check():
    support_user = SimpleNamespace(is_support_mode=True)
    tenant_admin = SimpleNamespace(is_support_mode=False)

    assert _should_start_trial_after_onboarding(
        required_complete=True,
        setup_pending=True,
        current_user=support_user,
    ) is False
    assert _should_start_trial_after_onboarding(
        required_complete=True,
        setup_pending=True,
        current_user=tenant_admin,
    ) is True
    assert _should_start_trial_after_onboarding(
        required_complete=False,
        setup_pending=True,
        current_user=tenant_admin,
    ) is False

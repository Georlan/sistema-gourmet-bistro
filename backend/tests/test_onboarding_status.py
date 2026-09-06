from __future__ import annotations

import datetime
from types import SimpleNamespace

from app.main import app
from app.routes.onboarding import _profile_is_configured, _trial_status_payload


def test_onboarding_status_route_is_registered_once():
    paths = [route.path for route in app.routes]
    assert paths.count("/api/onboarding/status") == 1


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

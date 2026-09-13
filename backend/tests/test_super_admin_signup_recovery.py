from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.services import signup_notifications


def test_superadmin_reissue_activation_route_is_protected_and_registered():
    paths = app.openapi().get("paths", {})
    route = "/api/super-admin/signups/{protocol}/activation-invite"
    assert route in paths
    assert "post" in paths[route]

    with TestClient(app) as client:
        response = client.post(
            "/api/super-admin/signups/KOMA-CTR-20260913-ABCDEF123456/activation-invite",
            json={"reason": "Teste sem autenticação"},
        )
    assert response.status_code in {401, 403}


def test_reissued_activation_can_use_new_delivery_kind(monkeypatch):
    calls = []

    def capture(db, **kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(signup_notifications, "enqueue", capture)
    monkeypatch.setattr(
        signup_notifications.settings,
        "KOMA_PUBLIC_APP_URL",
        "https://komafood.com.br",
    )

    signup_notifications.enqueue_activation(
        object(),
        protocol="KOMA-CTR-20260913-ABCDEF123456",
        restaurant_name="Restaurante QA",
        representative_name="Ana",
        email="ana@example.com",
        phone="5584999999999",
        token="new-secret-token",
        kind="activation-reissue-123456789abc",
    )

    assert len(calls) == 1
    assert calls[0]["kind"] == "activation-reissue-123456789abc"
    assert "new-secret-token" in calls[0]["message"]
    assert calls[0]["subject"] == "Seu KÔMA foi liberado — crie sua senha"

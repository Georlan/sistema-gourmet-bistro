from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from fastapi.websockets import WebSocketDisconnect

from app.config import settings
from app.main import app


client = TestClient(app)
OFFICIAL_ORIGIN = "https://sistema-gourmet-bistro.pages.dev"


def test_websocket_accepts_first_level_komafood_tenant_origins(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "CORS_ALLOWED_ORIGINS", OFFICIAL_ORIGIN)

    for origin in (
        "https://piloto-3.komafood.com.br",
        "https://pordosol.komafood.com.br",
        "https://pordosol-caixa.komafood.com.br",
    ):
        with client.websocket_connect(
            "/ws/cliente?restaurante_id=3",
            headers={"Origin": origin},
        ) as ws:
            assert ws is not None


def test_websocket_rejects_nested_or_spoofed_komafood_origins(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "CORS_ALLOWED_ORIGINS", OFFICIAL_ORIGIN)

    blocked = (
        "https://caixa.pordosol.komafood.com.br",
        "https://komafood.com.br.evil.example",
        "http://piloto-3.komafood.com.br",
        "https://piloto-3.komafood.com.br:8443",
    )
    for origin in blocked:
        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect(
                "/ws/cliente?restaurante_id=3",
                headers={"Origin": origin},
            ):
                pass
        assert exc_info.value.code == 1008

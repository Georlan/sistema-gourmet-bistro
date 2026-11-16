"""Regression tests for B0-10: internal Railway networking URL support for Evolution API."""

from unittest.mock import MagicMock

import httpx

from app.config import settings
from app.routes import super_admin_whatsapp
from app.services import tenant_order_whatsapp, whatsapp


INTERNAL_EVOLUTION_URL = "http://evolution-api.railway.internal:8080/"


def test_whatsapp_service_accepts_internal_http_url(monkeypatch):
    monkeypatch.setattr(settings, "EVOLUTION_API_URL", INTERNAL_EVOLUTION_URL)
    monkeypatch.setattr(settings, "EVOLUTION_API_KEY", "test-key")
    monkeypatch.setattr(settings, "EVOLUTION_INSTANCE_NAME", "koma-central")

    resolved = whatsapp._configuracao_evolution()
    assert resolved == (
        "http://evolution-api.railway.internal:8080",
        "test-key",
        "koma-central",
    )


def test_tenant_order_whatsapp_accepts_internal_http_url(monkeypatch):
    monkeypatch.setattr(settings, "EVOLUTION_API_URL", INTERNAL_EVOLUTION_URL)
    monkeypatch.setattr(settings, "EVOLUTION_API_KEY", "test-key")

    base, headers = tenant_order_whatsapp._provider()
    assert base == "http://evolution-api.railway.internal:8080"
    assert headers["apikey"] == "test-key"


def test_super_admin_probe_accepts_internal_http_url(monkeypatch):
    monkeypatch.setenv("EVOLUTION_API_URL", INTERNAL_EVOLUTION_URL)
    monkeypatch.setenv("EVOLUTION_API_KEY", "test-key")

    captured = {}

    class DummyClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get(self, url, headers=None, **kwargs):
            captured["url"] = url
            captured["headers"] = headers
            req = httpx.Request("GET", url)
            return httpx.Response(200, json=[], request=req)

    monkeypatch.setattr(super_admin_whatsapp.httpx, "Client", DummyClient)
    cfg = MagicMock(instance="koma-central", sender="5511999999999")
    status = super_admin_whatsapp._probe_connection(cfg)

    assert captured["url"].startswith("http://evolution-api.railway.internal:8080/")
    assert captured["headers"]["apikey"] == "test-key"
    assert status == "not_open"

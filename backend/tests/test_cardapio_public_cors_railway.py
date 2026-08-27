from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from app.config import OFFICIAL_PUBLIC_FRONTEND_ORIGIN, settings


def _railway_origins(monkeypatch) -> list[str]:
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("RAILWAY_PROJECT_ID", "koma-production")
    monkeypatch.delenv("RAILWAY_ENVIRONMENT_ID", raising=False)
    monkeypatch.delenv("RAILWAY_SERVICE_ID", raising=False)
    monkeypatch.setattr(settings, "CORS_ALLOWED_ORIGINS", "")
    return settings.get_cors_allowed_origins()


def test_railway_keeps_exact_official_public_origin_without_env_override(monkeypatch):
    origins = _railway_origins(monkeypatch)

    assert origins == [OFFICIAL_PUBLIC_FRONTEND_ORIGIN]
    assert "https://evil-hacker.pages.dev" not in origins


def test_public_order_preflight_succeeds_from_official_pages_origin(monkeypatch):
    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_railway_origins(monkeypatch),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-Koma-Customer-Token", "X-Request-ID"],
    )

    @app.post("/api/cardapio/pedidos")
    def create_public_order():
        return {"ok": True}

    response = TestClient(app).options(
        "/api/cardapio/pedidos",
        headers={
            "Origin": OFFICIAL_PUBLIC_FRONTEND_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-koma-customer-token",
        },
    )

    assert response.status_code in {200, 204}
    assert response.headers["access-control-allow-origin"] == OFFICIAL_PUBLIC_FRONTEND_ORIGIN
    assert "POST" in response.headers["access-control-allow-methods"]


def test_public_order_preflight_still_rejects_other_pages_projects(monkeypatch):
    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_railway_origins(monkeypatch),
        allow_credentials=False,
        allow_methods=["POST", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    response = TestClient(app).options(
        "/api/cardapio/pedidos",
        headers={
            "Origin": "https://evil-hacker.pages.dev",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert "access-control-allow-origin" not in response.headers

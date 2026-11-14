from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from app.config import (
    OFFICIAL_CUSTOM_DOMAIN_ORIGIN,
    OFFICIAL_PUBLIC_FRONTEND_ORIGIN,
    OFFICIAL_PUBLIC_FRONTEND_ORIGINS,
    settings,
)
from app.main import app as koma_app


def _railway_origins(monkeypatch) -> list[str]:
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("RAILWAY_PROJECT_ID", "koma-production")
    monkeypatch.delenv("RAILWAY_ENVIRONMENT_ID", raising=False)
    monkeypatch.delenv("RAILWAY_SERVICE_ID", raising=False)
    monkeypatch.setattr(settings, "CORS_ALLOWED_ORIGINS", "")
    return settings.get_cors_allowed_origins()


def test_railway_keeps_exact_official_public_origin_without_env_override(monkeypatch):
    origins = _railway_origins(monkeypatch)

    assert origins == list(OFFICIAL_PUBLIC_FRONTEND_ORIGINS)
    assert OFFICIAL_CUSTOM_DOMAIN_ORIGIN in origins
    assert "https://evil-hacker.pages.dev" not in origins


def test_real_app_cors_allows_checkout_idempotency_header():
    cors_middleware = next(
        middleware
        for middleware in koma_app.user_middleware
        if middleware.cls is CORSMiddleware
    )

    assert "X-Idempotency-Key" in cors_middleware.kwargs["allow_headers"]


def test_public_order_preflight_succeeds_from_official_pages_origin(monkeypatch):
    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_railway_origins(monkeypatch),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Content-Type",
            "X-Koma-Customer-Token",
            "X-Idempotency-Key",
            "X-Request-ID",
        ],
    )

    @app.post("/cardapio/pedidos")
    def create_public_order():
        return {"ok": True}

    response = TestClient(app).options(
        "/cardapio/pedidos",
        headers={
            "Origin": OFFICIAL_PUBLIC_FRONTEND_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": (
                "content-type,x-idempotency-key,x-koma-customer-token"
            ),
        },
    )

    assert response.status_code in {200, 204}
    assert response.headers["access-control-allow-origin"] == OFFICIAL_PUBLIC_FRONTEND_ORIGIN
    assert "POST" in response.headers["access-control-allow-methods"]
    assert "x-idempotency-key" in response.headers["access-control-allow-headers"].lower()


def test_public_order_preflight_still_rejects_other_pages_projects(monkeypatch):
    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_railway_origins(monkeypatch),
        allow_credentials=False,
        allow_methods=["POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-Idempotency-Key"],
    )

    response = TestClient(app).options(
        "/cardapio/pedidos",
        headers={
            "Origin": "https://evil-hacker.pages.dev",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-idempotency-key",
        },
    )

    assert "access-control-allow-origin" not in response.headers


def test_real_app_cors_sets_max_age_and_restricted_timing_allow_origin(monkeypatch):
    cors_middleware = next(
        middleware
        for middleware in koma_app.user_middleware
        if middleware.cls is CORSMiddleware
    )
    assert cors_middleware.kwargs["max_age"] == 7200

    monkeypatch.setattr(settings, "CORS_ALLOWED_ORIGINS", OFFICIAL_PUBLIC_FRONTEND_ORIGIN)
    client = TestClient(koma_app)

    allowed_preflight = client.options(
        "/health/live",
        headers={
            "Origin": OFFICIAL_PUBLIC_FRONTEND_ORIGIN,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert allowed_preflight.headers.get("access-control-max-age") == "7200"

    allowed_get = client.get(
        "/health/live",
        headers={"Origin": OFFICIAL_PUBLIC_FRONTEND_ORIGIN},
    )
    assert allowed_get.headers.get("timing-allow-origin") == OFFICIAL_PUBLIC_FRONTEND_ORIGIN

    subdomain_get = client.get(
        "/health/live",
        headers={"Origin": "https://d8-burger.komafood.com.br"},
    )
    assert subdomain_get.headers.get("timing-allow-origin") == "https://d8-burger.komafood.com.br"

    evil_get = client.get(
        "/health/live",
        headers={"Origin": "https://evil-hacker.pages.dev"},
    )
    assert "timing-allow-origin" not in evil_get.headers


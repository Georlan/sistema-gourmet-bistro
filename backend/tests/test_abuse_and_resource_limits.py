"""Regressões de disponibilidade e proteção contra abuso (RT-03, RT-04)."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app
from app.routes import saas_billing
from app.routes import websocket as ws_route
from app.websocket_manager import MAX_PUBLIC_WS_PER_IP, manager


def test_webhooks_reject_oversized_payloads_with_413(monkeypatch):
    monkeypatch.setenv("AVAILABILITY_WEBHOOK_SECRET", "audit-monitor-secret")
    oversized = json.dumps({"type": "payment", "data": {"id": "1", "pad": "A" * (270 * 1024)}})
    with TestClient(app) as client:
        for url in (
            "/payments/webhooks/mercado-pago",
            "/payments/webhooks/mercado-pago/acc-1",
            "/api/integrations/saas-billing/mercado-pago/webhook",
            "/api/integrations/saas-pix/mercado-pago/webhook",
            "/api/internal/support/availability-event",
        ):
            r = client.post(url, data=oversized, headers={"Content-Type": "application/json"})
            assert r.status_code == 413, f"Expected 413 for {url}, got {r.status_code}"


def test_global_http_body_limit_rejects_oversized_content_length():
    with TestClient(app) as client:
        r = client.post(
            "/auth/login",
            data=b"{}",
            headers={"Content-Type": "application/json", "Content-Length": str(13 * 1024 * 1024)},
        )
        assert r.status_code == 413


def test_public_ws_rejects_oversized_message_and_enforces_per_ip_cap(monkeypatch):
    monkeypatch.setattr(ws_route._ws_connect_rate_limiter, "requests_per_minute", 200)
    with TestClient(app) as client:
        # 1) Oversized message closes with 1009
        with client.websocket_connect(
            "/ws/cliente?restaurante_id=1",
            headers={"Origin": "https://app.komafood.com.br", "X-Forwarded-For": "203.0.113.120"},
        ) as ws:
            ws.send_text("X" * 5000)
            with pytest.raises(WebSocketDisconnect) as exc:
                ws.receive_text()
            assert exc.value.code == 1009

        # 2) Per-IP cap on concurrent /ws/cliente connections
        sockets = []
        try:
            for _ in range(MAX_PUBLIC_WS_PER_IP):
                ctx = client.websocket_connect(
                    "/ws/cliente?restaurante_id=1",
                    headers={"Origin": "https://app.komafood.com.br", "X-Forwarded-For": "203.0.113.121"},
                )
                sockets.append((ctx, ctx.__enter__()))

            with pytest.raises(WebSocketDisconnect) as cap_exc:
                with client.websocket_connect(
                    "/ws/cliente?restaurante_id=1",
                    headers={"Origin": "https://app.komafood.com.br", "X-Forwarded-For": "203.0.113.121"},
                ):
                    pass
            assert cap_exc.value.code == 1008

            # Another IP behind the same proxy can still connect
            with client.websocket_connect(
                "/ws/cliente?restaurante_id=1",
                headers={"Origin": "https://app.komafood.com.br", "X-Forwarded-For": "203.0.113.122"},
            ):
                pass
        finally:
            for ctx, _ws in sockets:
                ctx.__exit__(None, None, None)
            manager._public_client_ips.clear()
            manager._public_ip_counts.clear()


def test_contract_billing_endpoints_enforce_rate_limit():
    with saas_billing._billing_mutation_limiter._lock:
        saas_billing._billing_mutation_limiter.history.clear()
    with saas_billing._billing_status_limiter._lock:
        saas_billing._billing_status_limiter.history.clear()

    with TestClient(app) as client:
        hit_429 = False
        for _ in range(25):
            r = client.post(
                "/api/contracts/KOMA-CTR-20261126-AAAAAAAAAAAA/billing/activate-free",
                headers={"X-Forwarded-For": "203.0.113.130"},
            )
            if r.status_code == 429:
                hit_429 = True
                break
        assert hit_429

import json
import logging
import time

from fastapi.testclient import TestClient

from app.main import app, request_logger
from app.security import create_access_token


def test_unexpected_error_correlates_response_exception_and_tenant_without_leak(caplog):
    def controlled_failure():
        raise RuntimeError("private-token-must-not-appear")

    app.add_api_route("/_fixture/correlation", controlled_failure, methods=["GET"])
    request_logger.addHandler(caplog.handler)
    client = TestClient(app, raise_server_exceptions=False)
    started = time.perf_counter()
    try:
        for tenant in (5, 9):
            token = create_access_token(subject="fixture", restaurante_id=tenant, role="admin")
            response = client.get("/_fixture/correlation", headers={"Authorization": f"Bearer {token}"})
            assert response.status_code == 500
            request_id = response.headers["X-Request-ID"]
            events = [json.loads(record.getMessage()) for record in caplog.records if record.name == "koma.http"]
            correlated = [event for event in events if event.get("request_id") == request_id]
            assert {event["event"] for event in correlated} == {"http_exception", "http_request"}
            assert all(event["restaurante_id"] == tenant for event in correlated)
            assert all(event["instance"] and event["timestamp"] and event["path"] == "/_fixture/correlation" for event in correlated)
            assert next(event for event in correlated if event["event"] == "http_exception")["exception_type"] == "RuntimeError"
            serialized = "\n".join(record.getMessage() for record in caplog.records)
            assert token not in serialized
            assert "private-token-must-not-appear" not in serialized
            caplog.clear()
        anonymous = client.get("/health/live")
        events = [json.loads(record.getMessage()) for record in caplog.records if record.name == "koma.http"]
        assert next(event for event in events if event["request_id"] == anonymous.headers["X-Request-ID"])["restaurante_id"] is None
    finally:
        request_logger.removeHandler(caplog.handler)
        app.router.routes[:] = [item for item in app.router.routes if getattr(item, "path", None) != "/_fixture/correlation"]
    assert time.perf_counter() - started < 10

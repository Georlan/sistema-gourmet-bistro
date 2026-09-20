import asyncio

from app.routes import order_tracking


class _FakeSession:
    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


class _FakeRequest:
    async def is_disconnected(self):
        return True


def test_sse_releases_database_session_before_streaming(monkeypatch):
    session = _FakeSession()
    monkeypatch.setattr(order_tracking, "SessionLocal", lambda: session)
    monkeypatch.setattr(
        order_tracking,
        "resolve_public_tracking",
        lambda db, token: (7, "conv-1", "order-1", None),
    )

    response = asyncio.run(
        order_tracking.stream_eventos_pedido("safe-token", _FakeRequest())
    )

    assert response.media_type == "text/event-stream"
    assert session.closed is True


def test_sse_closes_short_session_when_token_is_invalid(monkeypatch):
    session = _FakeSession()
    monkeypatch.setattr(order_tracking, "SessionLocal", lambda: session)
    monkeypatch.setattr(order_tracking, "resolve_public_tracking", lambda db, token: None)

    try:
        asyncio.run(order_tracking.stream_eventos_pedido("invalid", _FakeRequest()))
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 404
    else:
        raise AssertionError("invalid capability token should fail")

    assert session.closed is True

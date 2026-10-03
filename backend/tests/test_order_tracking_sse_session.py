import asyncio
import threading

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import QueuePool

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


def test_sse_pool_wait_does_not_block_connection_release(monkeypatch):
    engine = create_engine(
        "sqlite://", poolclass=QueuePool, pool_size=1, max_overflow=0,
        pool_timeout=0.3, connect_args={"check_same_thread": False},
    )
    factory = sessionmaker(bind=engine)
    holder = factory()
    holder.execute(text("SELECT 1"))
    threads = []

    def resolve(db, token):
        threads.append(threading.get_ident())
        db.execute(text("SELECT 1"))
        return (6, "conversation", "order", None)

    monkeypatch.setattr(order_tracking, "SessionLocal", factory)
    monkeypatch.setattr(order_tracking, "resolve_public_tracking", resolve)

    async def scenario():
        loop_thread = threading.get_ident()

        async def release():
            await asyncio.sleep(0.03)
            holder.close()

        release_task = asyncio.create_task(release())
        try:
            response = await order_tracking.stream_eventos_pedido("safe", _FakeRequest())
            assert response.media_type == "text/event-stream"
            assert len(threads) == 1
            assert threads[0] != loop_thread
            assert engine.pool.checkedout() == 0
        finally:
            await release_task

    try:
        asyncio.run(scenario())
    finally:
        holder.close()
        engine.dispose()


def test_sse_resolver_exception_closes_session(monkeypatch):
    session = _FakeSession()
    monkeypatch.setattr(order_tracking, "SessionLocal", lambda: session)

    def fail(db, token):
        raise RuntimeError("database failure")

    monkeypatch.setattr(order_tracking, "resolve_public_tracking", fail)
    with pytest.raises(RuntimeError, match="database failure"):
        asyncio.run(order_tracking.stream_eventos_pedido("safe", _FakeRequest()))
    assert session.closed


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

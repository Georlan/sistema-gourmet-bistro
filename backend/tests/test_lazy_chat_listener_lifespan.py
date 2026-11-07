"""Regressao do orcamento de conexoes: chat LISTEN so sob demanda SSE."""

import asyncio
import importlib


def test_lifespan_does_not_start_chat_listener_without_subscribers(monkeypatch):
    main = importlib.import_module("app.main")
    database = importlib.import_module("app.database")
    chat = importlib.import_module("app.services.order_chat_hub")
    ws = importlib.import_module("app.websocket_manager")

    monkeypatch.setenv("RUN_MIGRATIONS_ON_STARTUP", "false")
    monkeypatch.setenv("ENABLE_OUTBOX_WORKER", "false")
    monkeypatch.setattr(database, "validate_postgres_runtime_role", lambda: None)
    monkeypatch.setattr(main, "should_create_schema_on_startup", lambda: False)
    monkeypatch.setattr(ws.manager, "start", lambda: None)
    monkeypatch.setattr(ws.manager, "stop", lambda: None)
    monkeypatch.setattr(chat.order_chat_hub, "stop", lambda: None)

    def unexpected_listener_start():
        raise AssertionError("Apenas uma inscricao SSE deve iniciar o LISTEN de chat")

    monkeypatch.setattr(chat.order_chat_hub, "ensure_started", unexpected_listener_start)

    async def scenario():
        async with main.lifespan(main.app):
            pass

    asyncio.run(scenario())


def test_chat_sse_subscription_starts_listener_on_demand():
    from app.services.order_chat_hub import OrderChatHub

    hub = OrderChatHub(listen_to_postgres=False)
    assert not hub._listener_ready.is_set()

    async def scenario():
        sub_id, queue = hub.subscribe_caixa(41)
        try:
            assert hub._listener_ready.is_set()
            assert queue.empty()
        finally:
            hub.unsubscribe_caixa(41, sub_id)

    asyncio.run(scenario())

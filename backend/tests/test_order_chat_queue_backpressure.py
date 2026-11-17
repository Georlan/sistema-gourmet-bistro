"""Backpressure, coalescing, tenant isolation and bounded shutdown tests for OrderChatHub."""

from __future__ import annotations

import asyncio
import json
import threading
import time

from app.services.order_chat_hub import OrderChatHub


def test_chat_queue_bounds_memory_coalesces_and_shuts_down_bounded():
    hub = OrderChatHub(listen_to_postgres=False, max_notify_queue_size=8)
    max_observed_queue = 0
    processed: list[tuple[int, str, str]] = []
    first_started = threading.Event()
    release_slow = threading.Event()

    def slow_publish(envelope):
        if not first_started.is_set():
            first_started.set()
            release_slow.wait(timeout=2.0)
        else:
            time.sleep(0.01)
        processed.append(
            (
                int(envelope["restaurante_id"]),
                str(envelope["conversation_id"]),
                str(envelope["kind"]),
            )
        )

    hub.publish_committed = slow_publish  # type: ignore[method-assign]

    async def scenario():
        loop = asyncio.get_running_loop()
        q_conv_9: asyncio.Queue = asyncio.Queue(maxsize=50)
        q_caixa_1: asyncio.Queue = asyncio.Queue(maxsize=50)
        q_conv_2: asyncio.Queue = asyncio.Queue(maxsize=50)
        with hub._lock:
            hub._conversation_subscribers["conv-9"] = {"s9": (loop, q_conv_9)}
            hub._caixa_subscribers[1] = {"c1": (loop, q_caixa_1)}
            hub._conversation_subscribers["conv-2"] = {"s2": (loop, q_conv_2)}

        hub.ensure_started()
        # Trigger first item so worker blocks on release_slow
        hub._handle_notify(json.dumps({"restaurante_id": 1, "conversation_id": "conv-1", "kind": "message"}))
        assert first_started.wait(timeout=1.0)

        nonlocal max_observed_queue
        # Flood 120 notifications across 20 conversations and 2 tenants
        for idx in range(120):
            tid = 1 if idx % 2 == 0 else 2
            cid = f"conv-{(idx % 20) + 1}"
            hub._handle_notify(
                json.dumps(
                    {
                        "restaurante_id": tid,
                        "conversation_id": cid,
                        "kind": "message",
                        "data": {"message_id": f"m-{idx}"},
                    }
                )
            )
            with hub._queue_cond:
                max_observed_queue = max(max_observed_queue, len(hub._notify_queue))

        assert max_observed_queue <= 8
        assert (hub._coalesced_notify_count + hub._overflow_refresh_count) > 0

        # Overflow refresh hints must reach conv-9 and caixa 1 immediately
        await asyncio.sleep(0.05)
        conv_9_events = []
        while not q_conv_9.empty():
            conv_9_events.append(q_conv_9.get_nowait())
        caixa_1_events = []
        while not q_caixa_1.empty():
            caixa_1_events.append(q_caixa_1.get_nowait())

        assert any(ev["event"] == "refresh" and ev["data"]["conversation_id"] == "conv-9" for ev in conv_9_events)
        assert any(ev["event"] == "refresh" for ev in caixa_1_events)

        release_slow.set()
        await asyncio.sleep(0.15)
        # In-queue coalescing upgraded conv-1 to kind='refresh'
        assert any(tid == 1 and cid == "conv-1" and kind == "refresh" for tid, cid, kind in processed)
        # Bounded shutdown must finish well within timeout even if backlog existed
        t0 = time.perf_counter()
        hub.stop(timeout=0.3)
        stop_ms = (time.perf_counter() - t0) * 1000.0
        assert stop_ms < 600.0

        print(
            "CHAT_QUEUE_BACKPRESSURE="
            + json.dumps(
                {
                    "burst": 121,
                    "max_queue": max_observed_queue,
                    "coalesced": hub._coalesced_notify_count,
                    "overflow_refresh": hub._overflow_refresh_count,
                    "processed_before_stop": len(processed),
                    "stop_ms": round(stop_ms, 2),
                }
            )
        )

    asyncio.run(scenario())


def test_chat_stop_does_not_hang_on_stuck_db_call():
    hub = OrderChatHub(listen_to_postgres=False, max_notify_queue_size=4)
    started = threading.Event()
    unblock = threading.Event()

    def stuck_publish(_envelope):
        started.set()
        unblock.wait(timeout=5.0)

    hub.publish_committed = stuck_publish  # type: ignore[method-assign]
    hub.ensure_started()
    hub._handle_notify(json.dumps({"restaurante_id": 1, "conversation_id": "conv-stuck", "kind": "message"}))
    assert started.wait(timeout=1.0)

    t0 = time.perf_counter()
    hub.stop(timeout=0.15)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    unblock.set()
    assert elapsed_ms < 400.0

import asyncio

import pytest
from fastapi import HTTPException

from app.routes.print_agent_events import _authenticate_agent_token, _sse
from app.services.print_delivery import PrintWakeupHub


def test_wakeup_hub_is_tenant_scoped():
    async def scenario():
        hub = PrintWakeupHub(listen_to_postgres=False)
        first_id, first_queue = hub.subscribe(11)
        second_id, second_queue = hub.subscribe(22)
        try:
            hub.publish(11, reason="test")
            payload = await asyncio.wait_for(first_queue.get(), timeout=0.2)
            assert payload["restaurante_id"] == 11
            assert payload["reason"] == "test"
            assert second_queue.empty()
        finally:
            hub.unsubscribe(11, first_id)
            hub.unsubscribe(22, second_id)
            hub.stop()

    asyncio.run(scenario())


def test_sse_contains_only_transport_hint():
    rendered = _sse(
        "print-job",
        {"restaurante_id": 7, "reason": "postgres-notify"},
    )
    assert rendered.startswith("event: print-job\n")
    assert '"restaurante_id":7' in rendered
    assert "payload_text" not in rendered
    assert "idempotency_key" not in rendered


def test_event_stream_requires_agent_token():
    with pytest.raises(HTTPException) as exc_info:
        _authenticate_agent_token("")
    assert exc_info.value.status_code == 401

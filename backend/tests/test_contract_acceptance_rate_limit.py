import time
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, HTTPException

from app.routes.contracts import _accept_contract_rate_limiter, accept_contract


def test_public_contract_acceptance_is_rate_limited_before_processing_payload():
    client_ip = "203.0.113.77"
    limiter = _accept_contract_rate_limiter
    previous = dict(limiter.history)
    try:
        limiter.history.clear()
        limiter.history[client_ip] = [time.time()] * limiter.requests_per_minute
        request = SimpleNamespace(client=SimpleNamespace(host=client_ip))

        with pytest.raises(HTTPException) as exc_info:
            accept_contract(
                payload=None,
                request=request,
                background_tasks=BackgroundTasks(),
            )

        assert exc_info.value.status_code == 429
    finally:
        limiter.history.clear()
        limiter.history.update(previous)

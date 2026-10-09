import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api_client import AgentAuthenticationError, KomaApiClient


@pytest.mark.parametrize("method", ["claim_jobs", "heartbeat"])
@pytest.mark.parametrize("failure", [429, 500, "network", "invalid_json"])
def test_outage_limits_calls_then_recovers(method, failure):
    client = KomaApiClient("https://api.example.test", "local-test")
    session = client.session = MagicMock()
    response = session.post.return_value
    response.status_code = failure if isinstance(failure, int) else 200
    if failure == "network":
        session.post.side_effect = requests.ConnectionError("offline")
    if failure == "invalid_json":
        response.json.side_effect = ValueError("invalid JSON")
    with patch("retry_budget.time.monotonic", return_value=100), \
         patch("retry_budget.random.uniform", side_effect=lambda low, high: high):
        for _ in range(100):
            getattr(client, method)()
    assert session.post.call_count == 1
    session.post.side_effect = None
    response.status_code = 200
    response.json.side_effect = None
    response.json.return_value = [] if method == "claim_jobs" else {}
    with patch("retry_budget.time.monotonic", return_value=101):
        getattr(client, method)()
        getattr(client, method)()
    assert session.post.call_count == 3  # successful empty queue is not an outage


@pytest.mark.parametrize("method", ["claim_jobs", "heartbeat"])
def test_auth_rejection_propagates_instead_of_recoverable_retry(method):
    client = KomaApiClient("https://api.example.test", "local-test")
    client.session = MagicMock()
    client.session.post.return_value.status_code = 401
    with pytest.raises(AgentAuthenticationError):
        getattr(client, method)()


def test_claim_backoff_does_not_block_confirmation_or_heartbeat():
    client = KomaApiClient("https://api.example.test", "local-test")
    client.session = MagicMock()
    client.session.post.return_value.status_code = 503
    with patch("retry_budget.time.monotonic", return_value=100):
        assert client.claim_jobs() == []
        client.session.post.return_value.status_code = 200
        client.session.post.return_value.json.return_value = {}
        assert client.heartbeat() == {}
        assert client.complete_job("already-printed") is True
    assert client.session.post.call_count == 3

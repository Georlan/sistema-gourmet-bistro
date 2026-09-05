"""Slow control-plane calls must not prevent the next spooler submission."""
import sys
import threading
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api_client import AgentAuthenticationError, KomaApiClient
from config import AgentConfig
from journal import PrintJournal
from worker import run_agent_loop


@pytest.mark.parametrize("blocked_call", ["diagnostics", "heartbeat", "confirmation"])
def test_slow_control_call_does_not_hold_next_ticket(tmp_path, blocked_call):
    blocked, printed_second = threading.Event(), threading.Event()
    control_client, ack_client, claim_client = MagicMock(), MagicMock(), MagicMock()
    journal = PrintJournal(str(tmp_path / "journal.db"))
    adapter = MagicMock()
    adapter.requires_physical_printer = False
    diagnostics = {"printers": [], "platform": "test"}
    diagnostic_calls = 0
    printed = []

    def slow():
        blocked.set()
        assert printed_second.wait(2), "A slow control call stopped the printing lane"

    def discover():
        nonlocal diagnostic_calls
        diagnostic_calls += 1
        if blocked_call == "diagnostics" and diagnostic_calls > 1:
            slow()
        return diagnostics

    def heartbeat(**kwargs):
        if blocked_call == "heartbeat":
            slow()
        return {}

    def acknowledge(items):
        if blocked_call == "confirmation":
            slow()
        return {item["job_id"] for item in items}

    def submit(payload, *args, **kwargs):
        printed.append(payload)
        if len(printed) == 2:
            printed_second.set()
        return True

    def claim(limit):
        # Ensure the blocking call is in-flight before the second ticket.
        if len(printed) == 1 or blocked_call != "confirmation":
            assert blocked.wait(2)
        return [{"id": f"job-{len(printed)}", "payload_text": f"ticket-{len(printed)}"}]

    adapter.get_diagnostics.side_effect = discover
    adapter.print_ticket.side_effect = submit
    control_client.heartbeat.side_effect = heartbeat
    ack_client.complete_jobs.side_effect = acknowledge
    claim_client.claim_jobs.side_effect = claim
    config = AgentConfig(adapter="file", agent_token="local-test-token")
    with patch("worker.KomaApiClient", side_effect=[claim_client, ack_client, control_client]), \
         patch("worker.PrintJournal", return_value=journal), \
         patch("worker.get_adapter", return_value=adapter), \
         patch("worker.DIAGNOSTIC_REFRESH_INTERVAL_SECONDS", 0):
        run_agent_loop(config, max_loops=2)
    assert printed == ["ticket-0", "ticket-1"]
    assert all(journal.is_printed(f"job-{n}") for n in range(2))
    assert len({id(c) for c in (claim_client, ack_client, control_client)}) == 3


@pytest.mark.parametrize("method,args", [("claim_jobs", (10,)), ("claim_next_job", ()),
    ("complete_jobs", ([{"job_id": "x"}],)), ("release_jobs", (["x"],))])
def test_revocation_stops_every_transport_lane(method, args):
    client = KomaApiClient("https://api.example.test", "test-token")
    client.session = MagicMock()
    client.session.post.return_value.status_code = 401
    with pytest.raises(AgentAuthenticationError):
        getattr(client, method)(*args)

import sys
from pathlib import Path
from threading import Event
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config import AgentConfig
from wake_listener import PUSH_FALLBACK_POLL_SECONDS, PrintWakeupListener
from worker import (
    DIAGNOSTIC_REFRESH_INTERVAL_SECONDS,
    IDLE_POLL_MAX_SECONDS,
    MAX_DIAGNOSTIC_AGE_SECONDS,
    compute_idle_poll_seconds,
    run_agent_loop,
)


def test_agent_defaults_match_90s_backend_ttl():
    cfg = AgentConfig()
    assert cfg.heartbeat_interval_seconds == 25.0
    assert cfg.poll_interval_seconds == 0.5
    assert DIAGNOSTIC_REFRESH_INTERVAL_SECONDS == 25.0
    assert MAX_DIAGNOSTIC_AGE_SECONDS == 75.0
    assert PUSH_FALLBACK_POLL_SECONDS == 60.0


def test_idle_poll_uses_60s_fallback_when_sse_is_healthy():
    listener = PrintWakeupListener("https://api.example.test", "token", Event())
    listener._consume_event("transport", '{"push_available":true}')

    assert compute_idle_poll_seconds(0.5, 0, listener) == 60.0
    assert compute_idle_poll_seconds(0.5, 10, listener) == 60.0


def test_idle_poll_backs_off_bounded_when_sse_unavailable():
    listener = PrintWakeupListener("https://api.example.test", "token", Event())
    assert listener.push_available is False

    waits = [compute_idle_poll_seconds(0.5, i, listener) for i in range(7)]
    assert waits == [0.5, 1.0, 2.0, 4.0, IDLE_POLL_MAX_SECONDS, IDLE_POLL_MAX_SECONDS, IDLE_POLL_MAX_SECONDS]


def test_new_order_and_transient_network_failure_adjust_backoff(tmp_path):
    cfg = AgentConfig(
        api_url="https://api.example.test",
        agent_token="tok",
        adapter="file",
        output_dir=str(tmp_path / "out"),
        config_path=str(tmp_path / "config.json"),
        poll_interval_seconds=0.5,
        heartbeat_interval_seconds=25.0,
    )
    client = MagicMock()
    # 1: empty, 2: transient network error, 3: empty, 4: job arrives, 5: empty
    client.claim_jobs.side_effect = [
        [],
        RuntimeError("network blip"),
        [],
        [{"id": "job-1", "payload_text": "Pedido #1", "destination": "COZINHA", "source_type": "pedido"}],
        [{"id": "job-2", "payload_text": "Pedido #2", "destination": "COZINHA", "source_type": "pedido"}],
        [],
        [],
    ]
    client.complete_jobs.return_value = {"confirmed": ["job-1", "job-2"], "rejected": []}
    client.heartbeat.return_value = {"status": "ok"}

    wait_calls = []

    class FakeEvent(Event):
        def wait(self, timeout=None):
            wait_calls.append(timeout)
            return False

    fake_event = FakeEvent()
    with patch("worker.KomaApiClient", return_value=client), \
         patch("worker.Event", return_value=fake_event):
        run_agent_loop(cfg, max_loops=7)

    # Loop 1 (empty -> 1s), Loop 2 (error -> 2s), Loop 3 (empty -> 4s),
    # Loop 4 & 5 (jobs claimed -> no wait, resets consecutive_empty_polls=0),
    # Loop 6 (empty after jobs -> 1s again, NOT 5s!), Loop 7 breaks before wait.
    assert wait_calls == [1.0, 2.0, 4.0, 1.0]
    assert (tmp_path / "out").exists()


def test_first_heartbeat_fires_immediately_even_when_system_uptime_is_low(tmp_path):
    from threading import Lock
    from worker import AgentMaintenance

    cfg = AgentConfig(
        api_url="https://api.example.test",
        agent_token="tok",
        adapter="file",
        output_dir=str(tmp_path / "out"),
        config_path=str(tmp_path / "config.json"),
        heartbeat_interval_seconds=25.0,
    )
    client = MagicMock()
    client.heartbeat.return_value = {"status": "ok"}
    adapter = MagicMock()
    adapter.get_diagnostics.return_value = {"printers": []}

    with patch("worker.KomaApiClient", return_value=client), \
         patch("worker.time.monotonic", return_value=1.0):
        maintenance = AgentMaintenance(cfg, adapter, Lock())
        maintenance.tick()

    client.heartbeat.assert_called_once()

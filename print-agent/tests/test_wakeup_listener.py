import sys
from pathlib import Path
from threading import Event
from unittest.mock import MagicMock, patch

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from wake_listener import PrintWakeupListener, iter_sse_events


def test_iter_sse_events_parses_transport_and_wakeup():
    lines = [
        "event: transport",
        'data: {"push_available":true}',
        "",
        "event: print-job",
        'data: {"restaurante_id":1}',
        "",
    ]
    assert list(iter_sse_events(lines)) == [
        ("transport", '{"push_available":true}'),
        ("print-job", '{"restaurante_id":1}'),
    ]


def test_ready_and_print_job_interrupt_idle_wait():
    wakeup = Event()
    listener = PrintWakeupListener("https://api.example.test", "token", wakeup)

    listener._consume_event("transport", '{"push_available":true}')
    assert listener.push_available is True
    assert wakeup.is_set() is False
    assert listener.fallback_poll_seconds(0.5) == 30.0

    listener._consume_event("ready", '{"push_available":true}')
    assert wakeup.is_set() is True

    wakeup.clear()
    listener._consume_event("print-job", '{"restaurante_id":1}')
    assert wakeup.is_set() is True


def test_transport_degradation_restores_configured_polling():
    listener = PrintWakeupListener(
        "https://api.example.test",
        "token",
        Event(),
    )
    listener._consume_event("transport", '{"push_available":true}')
    assert listener.fallback_poll_seconds(0.5) == 30.0

    listener._consume_event("transport", '{"push_available":false}')
    assert listener.push_available is False
    assert listener.fallback_poll_seconds(0.5) == 0.5


@pytest.mark.parametrize("failure", ["network", "empty_stream"])
def test_repeated_disconnects_back_off_without_disabling_polling(failure):
    listener = PrintWakeupListener("https://api.example.test", "token", Event())
    delays = []
    session = MagicMock()
    if failure == "network":
        session.get.side_effect = requests.ConnectionError("offline")
    else:
        session.get.return_value.status_code = 200
        session.get.return_value.iter_lines.return_value = []

    def wait(delay):
        delays.append(delay)
        if len(delays) == 8:
            listener._stop.set()

    with patch("wake_listener.requests.Session", return_value=session), \
         patch.object(listener._stop, "wait", side_effect=wait), \
         patch("wake_listener.random.uniform", side_effect=lambda low, high: high):
        listener._run()
    assert delays == [1, 2, 4, 8, 16, 30, 30, 30]
    assert listener.fallback_poll_seconds(0.5) == 0.5
    session.close.assert_called_once()


@pytest.mark.parametrize("status", [401, 403])
def test_authentication_rejection_stops_without_retry(status):
    wakeup = Event()
    listener = PrintWakeupListener("https://api.example.test", "token", wakeup)
    session = MagicMock()
    session.get.return_value.status_code = status
    with patch("wake_listener.requests.Session", return_value=session), \
         patch.object(listener._stop, "wait") as wait:
        listener._run()
    assert listener.authentication_failed.is_set()
    assert wakeup.is_set()
    wait.assert_not_called()
    session.get.assert_called_once()
    session.get.return_value.close.assert_called_once()


def test_ready_event_resets_backoff_and_wakes_queue_reconciliation():
    wakeup = Event()
    listener = PrintWakeupListener("https://api.example.test", "token", wakeup)
    response = MagicMock(status_code=200)
    response.iter_lines.return_value = ["event: ready", 'data: {"push_available":true}', ""]
    session = MagicMock()
    session.get.side_effect = [requests.ConnectionError(), requests.ConnectionError(), response]
    delays = []

    def wait(delay):
        delays.append(delay)
        if len(delays) == 3:
            listener._stop.set()

    with patch("wake_listener.requests.Session", return_value=session), \
         patch.object(listener._stop, "wait", side_effect=wait), \
         patch("wake_listener.random.uniform", side_effect=lambda low, high: high):
        listener._run()
    assert delays == [1, 2, 1]
    assert wakeup.is_set()
    response.close.assert_called_once()

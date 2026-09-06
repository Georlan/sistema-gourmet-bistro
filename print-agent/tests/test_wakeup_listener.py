import sys
from pathlib import Path
from threading import Event

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
    assert listener.fallback_poll_seconds(0.5) == 1.0

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
    assert listener.fallback_poll_seconds(0.5) == 1.0

    listener._consume_event("transport", '{"push_available":false}')
    assert listener.push_available is False
    assert listener.fallback_poll_seconds(0.5) == 0.5

from types import SimpleNamespace

from app.services.outbox.dispatcher import dispatch_single_outbox_event


class _ForbiddenSession:
    def commit(self):
        raise AssertionError("terminal outbox event must not be reopened or committed")


class _ForbiddenClient:
    def post(self, *args, **kwargs):
        raise AssertionError("terminal outbox event must never be delivered again")


def _terminal_event(status: str):
    return SimpleNamespace(
        id="outbox-terminal-replay",
        status=status,
        locked_by=None,
    )


def test_direct_dispatch_does_not_replay_delivered_event():
    event = _terminal_event("delivered")

    assert dispatch_single_outbox_event(
        _ForbiddenSession(),
        event,
        client=_ForbiddenClient(),
    ) is True
    assert event.status == "delivered"


def test_direct_dispatch_does_not_reopen_dead_letter_event():
    event = _terminal_event("dead_letter")

    assert dispatch_single_outbox_event(
        _ForbiddenSession(),
        event,
        client=_ForbiddenClient(),
    ) is False
    assert event.status == "dead_letter"

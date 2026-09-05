"""Commit hints must respect savepoints and rolled-back transactions."""
from sqlalchemy.orm import Session
from app.database import engine
from app.services.outbox import default_outbox_worker
from app.websocket_manager import manager


def observe(monkeypatch):
    calls = []
    monkeypatch.setattr(manager, "revoke", lambda *args: calls.append(args))
    monkeypatch.setattr(default_outbox_worker, "wake", lambda: calls.append("wake"))
    return calls


def notify(db, tenant):
    db.info.setdefault("revoked_websocket_sessions", set()).add((tenant, None))
    db.info["outbox_pending_notification"] = True


def test_savepoint_commit_waits_for_outer_commit(monkeypatch):
    calls = observe(monkeypatch)
    with Session(engine) as db:
        db.begin()
        with db.begin_nested():
            notify(db, 1)
        assert calls == []
        db.commit()
    assert calls == ["wake", (1, None)]


def test_nested_rollback_preserves_only_outer_notifications(monkeypatch):
    calls = observe(monkeypatch)
    with Session(engine) as db:
        db.begin()
        notify(db, 1)
        nested = db.begin_nested()
        notify(db, 2)
        nested.rollback()
        db.commit()
    assert calls == ["wake", (1, None)]


def test_outer_rollback_discards_committed_savepoint(monkeypatch):
    calls = observe(monkeypatch)
    with Session(engine) as db:
        db.begin()
        with db.begin_nested():
            notify(db, 1)
        db.rollback()
        db.commit()
    assert calls == []


def test_session_close_does_not_leak_notifications_on_reuse(monkeypatch):
    calls = observe(monkeypatch)
    db = Session(engine)
    db.begin()
    notify(db, 1)
    db.close()
    db.commit()
    db.close()
    assert calls == []

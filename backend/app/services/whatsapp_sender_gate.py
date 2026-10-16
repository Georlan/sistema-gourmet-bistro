"""Short persisted global sender reservations, never SQL locks over HTTP."""
import datetime as dt
import hashlib

from sqlalchemy.orm import Session

from ..models import CentralWhatsAppSenderState


def _key(config) -> str:
    # Instance is technical metadata, not a phone or a credential. A session
    # keeps its lane even if the configured representation of its number changes.
    return hashlib.sha256(config.instance.encode()).hexdigest()


def lock_sender(db: Session, config) -> CentralWhatsAppSenderState:
    if db.get_bind().dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    db.execute(insert(CentralWhatsAppSenderState.__table__).values(sender_key=_key(config), failures=0).on_conflict_do_nothing())
    return db.query(CentralWhatsAppSenderState).filter_by(sender_key=_key(config)).populate_existing().with_for_update().one()


def wait_until(state) -> dt.datetime | None:
    now = dt.datetime.now(dt.timezone.utc)
    dates = [value.replace(tzinfo=dt.timezone.utc) if value.tzinfo is None else value
        for value in (state.next_send_at, state.circuit_open_until) if value is not None]
    due = max(dates) if dates else None
    return due if due and due > now else None


def note_failure(db: Session, config, *, immediate: bool = False) -> None:
    state = lock_sender(db, config)
    state.failures += 1
    if immediate or state.failures >= 3:
        state.circuit_open_until = dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5)
    # Caller settles the outbox in the same short transaction.


def clear_failures(db: Session, config) -> None:
    state = lock_sender(db, config)
    state.failures = 0
    # Never shorten a shared pause opened by another in-flight request.

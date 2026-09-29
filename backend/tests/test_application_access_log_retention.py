import datetime

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import ApplicationAccessLog
import app.services.application_access_logs as access_logs


def test_access_log_is_minimal_encrypted_and_retained_for_six_calendar_months(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    ApplicationAccessLog.__table__.create(engine)
    factory = sessionmaker(bind=engine)
    monkeypatch.setattr(access_logs, "SessionLocal", factory)
    monkeypatch.setattr(access_logs, "_last_cleanup_monotonic", 0.0)

    db = factory()
    db.add_all([
        ApplicationAccessLog(
            id="expired",
            ip_address="203.0.113.10",
            accessed_at=datetime.datetime(
                2026, 3, 28, 12, 0, tzinfo=datetime.timezone.utc
            ),
        ),
        ApplicationAccessLog(
            id="boundary",
            ip_address="203.0.113.11",
            accessed_at=datetime.datetime(
                2026, 3, 29, 12, 0, tzinfo=datetime.timezone.utc
            ),
        ),
    ])
    db.commit()
    db.close()

    now = datetime.datetime(2026, 9, 29, 12, 0, tzinfo=datetime.timezone.utc)
    access_logs.record_application_access("198.51.100.77", accessed_at=now)

    db = factory()
    try:
        rows = db.query(ApplicationAccessLog).order_by(
            ApplicationAccessLog.accessed_at
        ).all()
        assert [row.id for row in rows if row.id in {"expired", "boundary"}] == [
            "boundary"
        ]
        current = next(row for row in rows if row.id not in {"boundary"})
        assert current.ip_address == "198.51.100.77"

        raw = db.execute(
            select(ApplicationAccessLog.__table__.c.ip_address).where(
                ApplicationAccessLog.__table__.c.id == current.id
            )
        ).scalar_one()
        assert raw != "198.51.100.77"
        assert raw.startswith("gAAAAA")
    finally:
        db.close()
        engine.dispose()


def test_six_calendar_months_handles_month_end():
    value = datetime.datetime(2026, 8, 31, 8, 30, tzinfo=datetime.timezone.utc)
    assert access_logs.six_calendar_months_before(value) == datetime.datetime(
        2026, 2, 28, 8, 30, tzinfo=datetime.timezone.utc
    )


def test_legal_hold_suspends_expired_access_log_cleanup(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    ApplicationAccessLog.__table__.create(engine)
    factory = sessionmaker(bind=engine)
    monkeypatch.setattr(access_logs, "SessionLocal", factory)
    monkeypatch.setattr(access_logs, "_last_cleanup_monotonic", 0.0)
    monkeypatch.setenv(
        "APPLICATION_ACCESS_LOG_LEGAL_HOLD_UNTIL",
        "2026-12-31T23:59:59+00:00",
    )

    db = factory()
    db.add(
        ApplicationAccessLog(
            id="expired-but-held",
            ip_address="203.0.113.50",
            accessed_at=datetime.datetime(
                2026, 1, 1, 12, 0, tzinfo=datetime.timezone.utc
            ),
        )
    )
    db.commit()
    db.close()

    access_logs.record_application_access(
        "198.51.100.80",
        accessed_at=datetime.datetime(
            2026, 9, 29, 12, 0, tzinfo=datetime.timezone.utc
        ),
    )

    db = factory()
    try:
        assert db.get(ApplicationAccessLog, "expired-but-held") is not None
        assert db.query(ApplicationAccessLog).count() == 2
    finally:
        db.close()
        engine.dispose()


def test_invalid_legal_hold_fails_conservative(monkeypatch):
    monkeypatch.setenv(
        "APPLICATION_ACCESS_LOG_LEGAL_HOLD_UNTIL",
        "valor-invalido",
    )
    now = datetime.datetime(2026, 9, 29, 12, 0, tzinfo=datetime.timezone.utc)
    assert access_logs.legal_hold_active(now) is True

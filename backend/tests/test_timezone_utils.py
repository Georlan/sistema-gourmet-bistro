import datetime

from app.timezone_utils import (
    elapsed_minutes_since,
    operational_day_bounds_utc,
    parse_operational_filter_datetime,
    to_database_utc,
    to_operational_local_time,
    to_utc,
)


def test_naive_database_timestamp_is_always_treated_as_utc():
    stored = datetime.datetime(2026, 8, 13, 18, 30)

    assert to_utc(stored) == datetime.datetime(
        2026, 8, 13, 18, 30, tzinfo=datetime.timezone.utc
    )
    assert to_operational_local_time(stored).isoformat() == "2026-08-13T15:30:00-03:00"
    assert to_database_utc(stored) == datetime.datetime(2026, 8, 13, 18, 30)


def test_elapsed_time_does_not_depend_on_server_timezone():
    opened_at = datetime.datetime(2026, 8, 13, 18, 0)
    now = datetime.datetime(2026, 8, 13, 19, 35, tzinfo=datetime.timezone.utc)

    assert elapsed_minutes_since(opened_at, now=now) == 95


def test_operational_date_filters_cover_the_full_fortaleza_day_in_utc():
    day = datetime.date(2026, 8, 13)
    start, next_start = operational_day_bounds_utc(day)

    assert start == datetime.datetime(2026, 8, 13, 3, 0, tzinfo=datetime.timezone.utc)
    assert next_start == datetime.datetime(2026, 8, 14, 3, 0, tzinfo=datetime.timezone.utc)
    assert parse_operational_filter_datetime("2026-08-13") == start
    assert parse_operational_filter_datetime(
        "2026-08-13", end_of_day=True
    ) == next_start

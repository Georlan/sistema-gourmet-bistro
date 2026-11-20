"""Testes B11/B2 residual: telemetria de pool_wait/hold, saturação do QueuePool e /health/ready."""

from __future__ import annotations

import json
import threading
import time

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import TimeoutError as SQLAlchemyTimeoutError
from sqlalchemy.pool import QueuePool

from app import database_diagnostics, main as main_module
from app.main import app


def test_pool_wait_contention_is_measured_and_logged_without_pii(caplog):
    engine = create_engine(
        "sqlite://",
        poolclass=QueuePool,
        pool_size=1,
        max_overflow=0,
        pool_timeout=2.0,
        connect_args={"check_same_thread": False},
    )
    database_diagnostics.install_pool_diagnostics(
        engine,
        lambda: 42,
        slow_seconds=5.0,
        slow_wait_seconds=0.04,
    )
    acquired = threading.Event()
    release = threading.Event()

    def holder():
        with engine.connect() as conn:
            conn.execute(text("SELECT :secret"), {"secret": "TOP_SECRET_PII"})
            acquired.set()
            release.wait(timeout=2.0)

    t = threading.Thread(target=holder)
    t.start()
    try:
        assert acquired.wait(timeout=2.0)
        releaser = threading.Timer(0.08, release.set)
        releaser.start()
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        finally:
            releaser.join()
    finally:
        release.set()
        t.join(timeout=2.0)

    snapshot = database_diagnostics.get_pool_metrics_snapshot(engine)
    assert snapshot["pool_type"] == "QueuePool"
    assert snapshot["pool_size"] == 1
    assert snapshot["checked_out"] == 0
    assert snapshot["overflow"] == 0
    assert snapshot["checkouts_total"] == 2
    assert snapshot["wait_timeouts_total"] == 0
    assert snapshot["slow_waits_total"] == 1
    assert snapshot["wait_ms"]["samples"] == 2
    assert snapshot["wait_ms"]["max"] >= 40.0
    assert snapshot["wait_ms"]["p95"] >= 40.0
    assert snapshot["hold_ms"]["samples"] == 2
    assert snapshot["hold_ms"]["max"] >= 40.0

    wait_logs = [
        json.loads(record.message)
        for record in caplog.records
        if "sql_pool_wait_slow" in record.message
    ]
    assert len(wait_logs) == 1
    assert wait_logs[0]["restaurante_id"] == 42
    assert wait_logs[0]["wait_ms"] >= 40.0
    assert "TOP_SECRET_PII" not in caplog.text
    assert "SELECT" not in caplog.text
    engine.dispose()


def test_pool_wait_timeout_increments_counter_and_logs_structured_event(caplog):
    engine = create_engine(
        "sqlite://",
        poolclass=QueuePool,
        pool_size=1,
        max_overflow=0,
        pool_timeout=0.05,
        connect_args={"check_same_thread": False},
    )
    database_diagnostics.install_pool_diagnostics(engine, lambda: 77, slow_wait_seconds=0.02)

    with engine.connect():
        with pytest.raises(SQLAlchemyTimeoutError):
            with engine.connect():
                pass

    snapshot = database_diagnostics.get_pool_metrics_snapshot(engine)
    assert snapshot["wait_timeouts_total"] == 1
    assert snapshot["checkouts_total"] == 1

    timeout_logs = [
        json.loads(record.message)
        for record in caplog.records
        if "sql_pool_timeout" in record.message
    ]
    assert len(timeout_logs) == 1
    assert timeout_logs[0]["restaurante_id"] == 77
    assert timeout_logs[0]["pool_size"] == 1
    assert timeout_logs[0]["checked_out"] == 1
    assert timeout_logs[0]["wait_ms"] >= 40.0
    engine.dispose()


def test_pool_telemetry_window_is_bounded_and_installation_is_idempotent():
    engine = create_engine(
        "sqlite://",
        poolclass=QueuePool,
        pool_size=2,
        max_overflow=0,
    )
    t1 = database_diagnostics.install_pool_diagnostics(engine, lambda: None, window_size=16)
    t2 = database_diagnostics.install_pool_diagnostics(engine, lambda: None, window_size=16)
    assert t1 is t2

    for _ in range(40):
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))

    snapshot = database_diagnostics.get_pool_metrics_snapshot(engine)
    assert snapshot["checkouts_total"] == 40
    assert snapshot["wait_ms"]["samples"] == 16
    assert snapshot["hold_ms"]["samples"] == 16
    engine.dispose()


def test_health_ready_exposes_db_pool_metrics_without_affecting_liveness(monkeypatch):
    queued_engine = create_engine(
        "sqlite://",
        poolclass=QueuePool,
        pool_size=4,
        max_overflow=0,
        connect_args={"check_same_thread": False},
    )
    database_diagnostics.install_pool_diagnostics(queued_engine, lambda: None)
    monkeypatch.setattr(main_module, "engine", queued_engine)
    try:
        with TestClient(app) as client:
            ready = client.get("/health/ready")
            live = client.get("/health/live")

        assert ready.status_code == 200
        body = ready.json()
        assert "db_pool" in body
        pool_info = body["db_pool"]
        assert pool_info["pool_type"] == "QueuePool"
        assert pool_info["pool_size"] == 4
        assert pool_info["checked_out"] == 0
        assert pool_info["overflow"] == 0
        assert pool_info["checkouts_total"] >= 1
        assert set(pool_info["wait_ms"].keys()) == {"samples", "p50", "p95", "max"}
        assert set(pool_info["hold_ms"].keys()) == {"samples", "p50", "p95", "max"}

        assert live.status_code == 200
        assert "db_pool" not in live.json()
    finally:
        queued_engine.dispose()


def test_diagnostics_hot_path_avoids_traceback_extract_stack():
    assert not hasattr(database_diagnostics, "extract_stack")
    origin = database_diagnostics._resolve_checkout_origin()
    assert isinstance(origin, str)
    assert len(origin) > 0

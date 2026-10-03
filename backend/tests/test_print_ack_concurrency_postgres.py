"""Real row-lock regression; only an explicitly named disposable local DB."""

import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import PrintJob, Restaurante
from app.routes.print_agents import (
    CompleteJobItem, CompleteJobRequest, CompleteJobsRequest, FailJobRequest,
    complete_job, complete_job_batch, fail_job,
)


@pytest.mark.parametrize("batch", [False, True])
def test_concurrent_failure_waits_for_durable_print_confirmation(batch):
    raw_url = os.getenv("PRINT_TEST_DATABASE_URL")
    if not raw_url:
        pytest.skip("Requires disposable local PostgreSQL print-test service")
    url = make_url(raw_url)
    assert url.host in {"localhost", "127.0.0.1"}
    assert url.database == "koma_print_test"
    schema = "print_ack_" + uuid.uuid4().hex
    admin = create_engine(url)
    engine = create_engine(url, execution_options={"schema_translate_map": {None: schema}})
    @event.listens_for(engine, "connect")
    def local_search_path(connection, record):
        with connection.cursor() as cursor:
            cursor.execute(f'SET search_path TO "{schema}", public')
        connection.commit()

    sessions = sessionmaker(bind=engine, autoflush=False)
    completion_loaded = threading.Event()
    completion_committed = threading.Event()
    release_completion = threading.Event()
    failure_attempted = threading.Event()
    failure_loaded = threading.Event()
    agent = SimpleNamespace(restaurante_id=99001, agent_id="test-agent")

    try:
        with admin.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        Base.metadata.create_all(engine, tables=[Restaurante.__table__, PrintJob.__table__])
        with sessions() as db:
            db.add(Restaurante(id=99001, nome="Disposable print regression", plano="pocket"))
            db.flush()
            db.add(PrintJob(
                id="test-job", restaurante_id=99001, document_type="producao",
                destination="COZINHA", source_type="pedido", source_id="test-order",
                payload_text="Controlled regression", status="printing", attempts=0,
                idempotency_key="test-print-ack", agent_id=agent.agent_id,
            ))
            db.commit()

        @event.listens_for(engine, "before_cursor_execute")
        def before_select(connection, cursor, statement, parameters, context, many):
            if statement.lstrip().startswith("SELECT") and "print_jobs" in statement:
                if threading.current_thread().name.endswith("_1"):
                    failure_attempted.set()

        @event.listens_for(engine, "after_cursor_execute")
        def after_select(connection, cursor, statement, parameters, context, many):
            if not (statement.lstrip().startswith("SELECT") and "print_jobs" in statement):
                return
            if threading.current_thread().name.endswith("_0"):
                completion_loaded.set()
                assert release_completion.wait(5)
            elif threading.current_thread().name.endswith("_1"):
                failure_loaded.set()
                assert completion_committed.wait(5)

        def confirm():
            with sessions() as db:
                if batch:
                    response = complete_job_batch(
                        CompleteJobsRequest(jobs=[CompleteJobItem(job_id="test-job")]),
                        BackgroundTasks(), agent=agent, db=db,
                    )
                else:
                    response = complete_job("test-job", CompleteJobRequest(), BackgroundTasks(), agent=agent, db=db)
                completion_committed.set()
                return response

        def fail():
            with sessions() as db:
                return fail_job("test-job", FailJobRequest(error="Delayed callback"),
                                BackgroundTasks(), agent=agent, db=db)

        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="print-ack") as executor:
            completed = executor.submit(confirm)
            try:
                assert completion_loaded.wait(5)
                failed = executor.submit(fail)
                assert failure_attempted.wait(5)
                # Failure must not consume a stale `printing` snapshot while
                # another request is about to commit `printed`.
                failure_waited_for_confirmation = not failure_loaded.wait(0.25)
            finally:
                release_completion.set()
            completed.result(timeout=5)
            response = failed.result(timeout=5)
            assert response["status"] == "printed"
            assert response["attempts"] == 0
            assert failure_waited_for_confirmation

        with sessions() as db:
            job = db.get(PrintJob, "test-job")
            assert job.status == "printed"
            assert job.attempts == 0
            assert job.agent_id == agent.agent_id
            assert job.printed_at is not None
            assert job.last_error is None
    finally:
        release_completion.set()
        engine.dispose()
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        admin.dispose()

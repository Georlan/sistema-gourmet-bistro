from types import SimpleNamespace

from fastapi import BackgroundTasks
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import PrintJob
from app import print_job_invariants  # noqa: F401
from app.routes.print_agents import FailJobRequest, fail_job


def test_delayed_failure_cannot_reopen_already_printed_job():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = SessionLocal()
    try:
        job = PrintJob(
            id="job-terminal-race",
            restaurante_id=1,
            document_type="producao",
            destination="COZINHA",
            source_type="pedido",
            source_id="pedido-1",
            payload_text="PEDIDO: #1-A",
            status="printed",
            attempts=0,
            idempotency_key="print-terminal-race",
            agent_id="agent-1",
            printer_name="G250",
        )
        db.add(job)
        db.commit()

        response = fail_job(
            "job-terminal-race",
            FailJobRequest(error="callback de falha atrasado"),
            BackgroundTasks(),
            agent=SimpleNamespace(restaurante_id=1, agent_id="agent-1"),
            db=db,
        )

        db.refresh(job)
        assert response["status"] == "printed"
        assert job.status == "printed"
        assert job.attempts == 0
        assert job.last_error is None
        assert job.agent_id == "agent-1"
    finally:
        db.close()
        engine.dispose()

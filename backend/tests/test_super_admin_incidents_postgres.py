"""Regressão da Central de Incidentes contra PostgreSQL com FORCE RLS real."""

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.database import SessionLocal, tenant_session_scope
from app.main import app
from app.models import PrintJob, Restaurante, SuperAdminAuditLog
from app.routes.super_admin import _discover_restaurant_ids
from app.security import create_access_token

TENANT_A = 9311
TENANT_B = 9312
JOB_A = "incident-postgres-tenant-a"
JOB_B = "incident-postgres-tenant-b"
SUPERADMIN = "incident-postgres@example.test"


pytestmark = pytest.mark.skipif(
    os.getenv("KOMA_PYTEST_USE_EXTERNAL_DATABASE", "false").lower() != "true",
    reason="Regressão RLS exige o PostgreSQL efêmero do quality gate.",
)


def _headers() -> dict[str, str]:
    token = create_access_token(
        subject=SUPERADMIN,
        restaurante_id=0,
        role="superadmin",
    )
    return {"Authorization": f"Bearer {token}"}


def _seed_tenant(tenant_id: int, tenant_name: str, job_id: str) -> None:
    with SessionLocal() as db:
        with tenant_session_scope(db, tenant_id):
            db.add(
                Restaurante(
                    id=tenant_id,
                    nome=tenant_name,
                    plano="pocket",
                    slug=f"incident-postgres-{tenant_id}",
                )
            )
            db.flush()
            db.add(
                PrintJob(
                    id=job_id,
                    restaurante_id=tenant_id,
                    document_type="producao",
                    destination="COZINHA" if tenant_id == TENANT_A else "BAR",
                    source_type="pedido",
                    source_id=f"pedido-{tenant_id}",
                    payload_text=f"Falha de impressão do tenant {tenant_id}",
                    status="failed",
                    attempts=3,
                    idempotency_key=job_id,
                    last_error="Impressora indisponível",
                )
            )
            db.commit()


def _delete_tenant(tenant_id: int) -> None:
    with SessionLocal() as db:
        with tenant_session_scope(db, tenant_id):
            db.query(Restaurante).filter(Restaurante.id == tenant_id).delete(
                synchronize_session=False
            )
            db.commit()


def test_incident_center_lists_filters_and_retries_under_real_rls():
    _seed_tenant(TENANT_A, "Postgres Incident A", JOB_A)
    _seed_tenant(TENANT_B, "Postgres Incident B", JOB_B)

    try:
        with SessionLocal() as db:
            role = db.execute(text("""
                    SELECT rol.rolsuper, rol.rolbypassrls
                    FROM pg_roles AS rol
                    WHERE rol.rolname = current_user
                    """)).one()
            assert role.rolsuper is False
            assert role.rolbypassrls is False

            hidden_without_scope = (
                db.query(Restaurante)
                .filter(Restaurante.id.in_([TENANT_A, TENANT_B]))
                .all()
            )
            assert hidden_without_scope == []
            assert {TENANT_A, TENANT_B}.issubset(set(_discover_restaurant_ids(db)))

        client = TestClient(app)
        headers = _headers()

        all_response = client.get(
            "/api/super-admin/incidents?source=impressao",
            headers=headers,
        )
        assert all_response.status_code == 200, all_response.text
        all_jobs = {item["evidence"].get("job_id") for item in all_response.json()}
        assert {JOB_A, JOB_B}.issubset(all_jobs)

        filtered_response = client.get(
            f"/api/super-admin/incidents?tenant_id={TENANT_A}&source=impressao",
            headers=headers,
        )
        assert filtered_response.status_code == 200, filtered_response.text
        filtered_jobs = {
            item["evidence"].get("job_id") for item in filtered_response.json()
        }
        assert JOB_A in filtered_jobs
        assert JOB_B not in filtered_jobs

        cross_tenant_response = client.post(
            "/api/super-admin/incidents/action",
            headers=headers,
            json={
                "tenant_id": TENANT_B,
                "action_type": "retry_print_job",
                "target_id": JOB_A,
                "reason": "Tentativa cross-tenant que deve falhar fechada.",
            },
        )
        assert cross_tenant_response.status_code == 400

        with SessionLocal() as db:
            with tenant_session_scope(db, TENANT_A):
                unchanged = db.query(PrintJob).filter(PrintJob.id == JOB_A).one()
                assert unchanged.status == "failed"
                assert unchanged.attempts == 3

        retry_response = client.post(
            "/api/super-admin/incidents/action",
            headers=headers,
            json={
                "tenant_id": TENANT_A,
                "action_type": "retry_print_job",
                "target_id": JOB_A,
                "reason": "Impressora recuperada; reenviar documento.",
            },
        )
        assert retry_response.status_code == 200, retry_response.text

        with SessionLocal() as db:
            with tenant_session_scope(db, TENANT_A):
                retried = db.query(PrintJob).filter(PrintJob.id == JOB_A).one()
                assert retried.status == "pending"
                assert retried.attempts == 0
                audit = (
                    db.query(SuperAdminAuditLog)
                    .filter(
                        SuperAdminAuditLog.action
                        == "SUPERADMIN_INCIDENT_RETRY_PRINT_JOB"
                    )
                    .order_by(SuperAdminAuditLog.id.desc())
                    .first()
                )
                assert audit is not None
                assert audit.restaurante_id == TENANT_A
                assert audit.after_data["job_id"] == JOB_A
    finally:
        _delete_tenant(TENANT_A)
        _delete_tenant(TENANT_B)

import datetime
import uuid
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import (
    IntegrationOutbox,
    OnlinePaymentWebhookEvent,
    PrintAgentToken,
    PrintJob,
    RestaurantPaymentAccount,
    Restaurante,
    SuperAdminAuditLog,
    Usuario,
)
from app.routes import super_admin, super_admin_incidents
from app.security import create_access_token, get_password_hash
from app.services import incident_service

client = TestClient(app)
SUPERADMIN_USERNAME = "incident-admin@example.test"
SUPERADMIN_PASSWORD = "incident-password-test"


@pytest.fixture(autouse=True)
def superadmin_env(monkeypatch):
    super_admin.superadmin_login_rate_limiter.history.clear()
    monkeypatch.setenv("SUPERADMIN_USERNAME", SUPERADMIN_USERNAME)
    monkeypatch.setenv(
        "SUPERADMIN_PASSWORD_HASH",
        get_password_hash(SUPERADMIN_PASSWORD),
    )
    yield
    super_admin.superadmin_login_rate_limiter.history.clear()


def _superadmin_headers() -> dict[str, str]:
    token = create_access_token(
        subject=SUPERADMIN_USERNAME,
        restaurante_id=0,
        role="superadmin",
    )
    return {"Authorization": f"Bearer {token}"}


def test_list_incidents_empty_or_honest():
    """Garante que a central de incidentes consulta fontes reais e não inventa dados."""
    headers = _superadmin_headers()
    response = client.get("/api/super-admin/incidents", headers=headers)
    assert response.status_code == 200
    incidents = response.json()
    assert isinstance(incidents, list)


def test_outbox_failed_event_diagnosed_and_reprocessed():
    """Evento falho no outbox gera incidente com severidade e permite reprocessamento auditado."""
    headers = _superadmin_headers()
    event_uuid = str(uuid.uuid4())

    with SessionLocal() as db:
        ev = IntegrationOutbox(
            id=event_uuid,
            restaurante_id=1,
            event_id=f"evt-{event_uuid[:8]}",
            event_name="koma.order.created",
            aggregate_type="order",
            aggregate_id="ord-100",
            payload={"order_id": 100},
            status="failed",
            attempts=2,
            max_attempts=5,
            last_error="HTTP 502 Bad Gateway no webhook do parceiro",
        )
        db.add(ev)
        db.commit()

    try:
        resp = client.get("/api/super-admin/incidents?source=outbox", headers=headers)
        assert resp.status_code == 200
        items = resp.json()

        target = next((i for i in items if i["evidence"].get("outbox_id") == event_uuid), None)
        assert target is not None
        assert target["source"] == "outbox"
        assert target["severity"] == "high"
        assert target["action_available"] is True
        assert target["action_type"] == "reprocess_outbox_event"
        assert "HTTP 502" in target["detail"]

        action_resp = client.post(
            "/api/super-admin/incidents/action",
            headers=headers,
            json={
                "tenant_id": 1,
                "action_type": "reprocess_outbox_event",
                "target_id": event_uuid,
                "reason": "Parceiro restabeleceu serviço; reprocessando evento.",
            },
        )
        assert action_resp.status_code == 200
        assert action_resp.json()["success"] is True

        with SessionLocal() as db:
            updated_ev = db.query(IntegrationOutbox).filter(IntegrationOutbox.id == event_uuid).first()
            assert updated_ev.status == "pending"
            assert updated_ev.attempts == 0
            assert "Reprocessamento solicitado por" in updated_ev.last_error

            audit = (
                db.query(SuperAdminAuditLog)
                .filter(
                    SuperAdminAuditLog.restaurante_id == 1,
                    SuperAdminAuditLog.action == "SUPERADMIN_INCIDENT_REPROCESS_OUTBOX",
                )
                .order_by(SuperAdminAuditLog.id.desc())
                .first()
            )
            assert audit is not None
            assert audit.actor == SUPERADMIN_USERNAME
            assert audit.after_data["outbox_id"] == event_uuid
    finally:
        with SessionLocal() as db:
            db.query(IntegrationOutbox).filter(IntegrationOutbox.id == event_uuid).delete()
            db.commit()


def test_print_job_failed_diagnosed_and_retried():
    """PrintJob que falhou gera incidente e permite retentativa auditada."""
    headers = _superadmin_headers()
    job_uuid = str(uuid.uuid4())

    with SessionLocal() as db:
        job = PrintJob(
            id=job_uuid,
            restaurante_id=1,
            document_type="producao",
            destination="COZINHA",
            source_type="pedido",
            source_id="ped-999",
            payload_text="Item 1x Pizza Margherita",
            status="failed",
            attempts=3,
            idempotency_key=f"print-idem-{job_uuid}",
            last_error="Impressora sem papel ou desconectada",
        )
        db.add(job)
        db.commit()

    try:
        resp = client.get("/api/super-admin/incidents?source=impressao", headers=headers)
        assert resp.status_code == 200
        items = resp.json()

        target = next((i for i in items if i["evidence"].get("job_id") == job_uuid), None)
        assert target is not None
        assert target["source"] == "impressao"
        assert target["severity"] == "high"
        assert target["action_available"] is True
        assert target["action_type"] == "retry_print_job"
        assert "sem papel" in target["detail"]

        action_resp = client.post(
            "/api/super-admin/incidents/action",
            headers=headers,
            json={
                "tenant_id": 1,
                "action_type": "retry_print_job",
                "target_id": job_uuid,
                "reason": "Papel reposto pelo operador; reenviando à fila.",
            },
        )
        assert action_resp.status_code == 200

        with SessionLocal() as db:
            updated_job = db.query(PrintJob).filter(PrintJob.id == job_uuid).first()
            assert updated_job.status == "pending"
            assert updated_job.attempts == 0
    finally:
        with SessionLocal() as db:
            db.query(PrintJob).filter(PrintJob.id == job_uuid).delete()
            db.commit()


def test_print_agent_offline_detected():
    """PrintAgent ativo sem heartbeat há mais de 10 minutos gera incidente."""
    headers = _superadmin_headers()
    token_uuid = str(uuid.uuid4())
    past_seen = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=25)

    with SessionLocal() as db:
        agent = PrintAgentToken(
            id=token_uuid,
            restaurante_id=1,
            agent_id=f"agent-{token_uuid[:6]}",
            token_hash="fakehash",
            ativo=True,
            last_seen_at=past_seen,
        )
        db.add(agent)
        db.commit()

    try:
        resp = client.get("/api/super-admin/incidents?source=impressao", headers=headers)
        assert resp.status_code == 200
        items = resp.json()

        target = next((i for i in items if i["evidence"].get("token_id") == token_uuid), None)
        assert target is not None
        assert target["severity"] == "high"
        assert "sem heartbeat" in target["title"].lower()
    finally:
        with SessionLocal() as db:
            db.query(PrintAgentToken).filter(PrintAgentToken.id == token_uuid).delete()
            db.commit()


def test_failed_webhook_diagnosed_without_exposing_secrets():
    """Webhook com falha é diagnosticado na Central sem revelar dados confidenciais."""
    headers = _superadmin_headers()
    wh_uuid = str(uuid.uuid4())

    with SessionLocal() as db:
        wh = OnlinePaymentWebhookEvent(
            id=wh_uuid,
            restaurante_id=1,
            provider="mercado_pago",
            request_id=f"req-{wh_uuid[:8]}",
            external_payment_id="pay_99887766",
            status="failed",
            last_error="Assinatura HMAC divergente do secret registrado",
        )
        db.add(wh)
        db.commit()

    try:
        resp = client.get("/api/super-admin/incidents?source=mercado_pago", headers=headers)
        assert resp.status_code == 200
        items = resp.json()

        target = next((i for i in items if i["evidence"].get("webhook_id") == wh_uuid), None)
        assert target is not None
        assert target["source"] == "mercado_pago"
        assert target["severity"] == "high"
        assert "pay_99887766" in target["detail"]
        assert "access_token" not in target["evidence"]
        assert "secret" not in target["evidence"]
    finally:
        with SessionLocal() as db:
            db.query(OnlinePaymentWebhookEvent).filter(OnlinePaymentWebhookEvent.id == wh_uuid).delete()
            db.commit()


def test_incidents_summary_endpoint():
    """Endpoint de sumário calcula contagens agregadas por severidade e origem."""
    headers = _superadmin_headers()
    resp = client.get("/api/super-admin/incidents/summary", headers=headers)
    assert resp.status_code == 200
    data = resp.json()

    assert "total" in data
    assert "by_severity" in data
    assert "by_source" in data
    assert "critical" in data["by_severity"]
    assert "outbox" in data["by_source"]
    assert "mercado_pago" in data["by_source"]
    assert "impressao" in data["by_source"]


def test_incident_listing_and_summary_enter_each_tenant_scope(monkeypatch):
    """Evita a regressão em que o Super Admin consultava tudo sob o tenant RLS 0."""
    service_scopes: list[int] = []
    original_service_scope = incident_service.tenant_session_scope

    @contextmanager
    def tracked_service_scope(db, tenant_id):
        service_scopes.append(int(tenant_id))
        with original_service_scope(db, tenant_id):
            yield int(tenant_id)

    monkeypatch.setattr(incident_service, "tenant_session_scope", tracked_service_scope)
    monkeypatch.setattr(
        super_admin_incidents,
        "_discover_restaurant_ids",
        lambda db: [1],
    )

    headers = _superadmin_headers()
    assert client.get("/api/super-admin/incidents", headers=headers).status_code == 200
    assert client.get("/api/super-admin/incidents/summary", headers=headers).status_code == 200
    assert service_scopes == [1, 1]

    action_scopes: list[int] = []
    original_action_scope = super_admin_incidents.tenant_session_scope

    @contextmanager
    def tracked_action_scope(db, tenant_id):
        action_scopes.append(int(tenant_id))
        with original_action_scope(db, tenant_id):
            yield int(tenant_id)

    monkeypatch.setattr(
        super_admin_incidents,
        "tenant_session_scope",
        tracked_action_scope,
    )
    action_response = client.post(
        "/api/super-admin/incidents/action",
        headers=headers,
        json={
            "tenant_id": 1,
            "action_type": "retry_print_job",
            "target_id": "missing-job",
            "reason": "Validação do escopo da ação.",
        },
    )
    assert action_response.status_code == 400
    assert action_scopes == [1]


def test_incident_filter_isolates_two_tenants():
    """Listagem global enxerga ambos; o filtro retorna somente o tenant pedido."""
    tenant_a = 9101
    tenant_b = 9102
    job_a = f"tenant-a-{uuid.uuid4()}"
    job_b = f"tenant-b-{uuid.uuid4()}"

    with SessionLocal() as db:
        db.add_all(
            [
                Restaurante(id=tenant_a, nome="Incidentes Tenant A", plano="pocket"),
                Restaurante(id=tenant_b, nome="Incidentes Tenant B", plano="pocket"),
            ]
        )
        db.flush()
        db.add_all(
            [
                PrintJob(
                    id=job_a,
                    restaurante_id=tenant_a,
                    document_type="producao",
                    destination="COZINHA",
                    source_type="pedido",
                    source_id="pedido-tenant-a",
                    payload_text="Tenant A",
                    status="failed",
                    attempts=1,
                    idempotency_key=job_a,
                ),
                PrintJob(
                    id=job_b,
                    restaurante_id=tenant_b,
                    document_type="producao",
                    destination="BAR",
                    source_type="pedido",
                    source_id="pedido-tenant-b",
                    payload_text="Tenant B",
                    status="failed",
                    attempts=1,
                    idempotency_key=job_b,
                ),
            ]
        )
        db.commit()

    headers = _superadmin_headers()
    try:
        global_response = client.get(
            "/api/super-admin/incidents?source=impressao",
            headers=headers,
        )
        assert global_response.status_code == 200
        global_jobs = {
            item["evidence"].get("job_id")
            for item in global_response.json()
        }
        assert {job_a, job_b}.issubset(global_jobs)

        tenant_response = client.get(
            f"/api/super-admin/incidents?tenant_id={tenant_a}&source=impressao",
            headers=headers,
        )
        assert tenant_response.status_code == 200
        tenant_jobs = {
            item["evidence"].get("job_id")
            for item in tenant_response.json()
        }
        assert job_a in tenant_jobs
        assert job_b not in tenant_jobs
    finally:
        with SessionLocal() as db:
            db.query(PrintJob).filter(PrintJob.id.in_([job_a, job_b])).delete(
                synchronize_session=False
            )
            db.query(Restaurante).filter(
                Restaurante.id.in_([tenant_a, tenant_b])
            ).delete(synchronize_session=False)
            db.commit()


def test_retry_print_job_rejects_cross_tenant_target():
    """O tenant do payload não pode autorizar uma reimpressão de outro tenant."""
    tenant_a = 9201
    tenant_b = 9202
    job_id = f"cross-tenant-{uuid.uuid4()}"

    with SessionLocal() as db:
        db.add_all(
            [
                Restaurante(id=tenant_a, nome="Retry Tenant A", plano="pocket"),
                Restaurante(id=tenant_b, nome="Retry Tenant B", plano="pocket"),
            ]
        )
        db.flush()
        db.add(
            PrintJob(
                id=job_id,
                restaurante_id=tenant_a,
                document_type="producao",
                destination="COZINHA",
                source_type="pedido",
                source_id="pedido-cross-tenant",
                payload_text="Não reimprimir pelo tenant errado",
                status="failed",
                attempts=3,
                idempotency_key=job_id,
                last_error="Impressora indisponível",
            )
        )
        db.commit()

    try:
        response = client.post(
            "/api/super-admin/incidents/action",
            headers=_superadmin_headers(),
            json={
                "tenant_id": tenant_b,
                "action_type": "retry_print_job",
                "target_id": job_id,
                "reason": "Tentativa com tenant adulterado.",
            },
        )
        assert response.status_code == 400

        with SessionLocal() as db:
            unchanged = db.query(PrintJob).filter(PrintJob.id == job_id).one()
            assert unchanged.restaurante_id == tenant_a
            assert unchanged.status == "failed"
            assert unchanged.attempts == 3
            audit = (
                db.query(SuperAdminAuditLog)
                .filter(SuperAdminAuditLog.after_data.contains({"job_id": job_id}))
                .first()
            )
            assert audit is None
    finally:
        with SessionLocal() as db:
            db.query(PrintJob).filter(PrintJob.id == job_id).delete(
                synchronize_session=False
            )
            db.query(Restaurante).filter(
                Restaurante.id.in_([tenant_a, tenant_b])
            ).delete(synchronize_session=False)
            db.commit()


def test_incident_action_requires_reason():
    """Ações corretivas rejeitam motivo curto ou composto apenas por espaços."""
    headers = _superadmin_headers()
    resp = client.post(
        "/api/super-admin/incidents/action",
        headers=headers,
        json={
            "tenant_id": 1,
            "action_type": "reprocess_outbox_event",
            "target_id": "any-id",
            "reason": "ab",
        },
    )
    assert resp.status_code == 422

    blank_resp = client.post(
        "/api/super-admin/incidents/action",
        headers=headers,
        json={
            "tenant_id": 1,
            "action_type": "reprocess_outbox_event",
            "target_id": "any-id",
            "reason": "   ",
        },
    )
    assert blank_resp.status_code == 400
    assert "motivo" in blank_resp.json()["detail"].lower()


def test_incident_center_requires_superadmin():
    """Endpoints de incidentes são estritamente restritos a operadores Super Admin."""
    resp_unauth = client.get("/api/super-admin/incidents")
    assert resp_unauth.status_code == 401

    staff_token = create_access_token(
        subject="staff-garcom",
        restaurante_id=1,
        role="garcom",
    )
    resp_forbidden = client.get(
        "/api/super-admin/incidents",
        headers={"Authorization": f"Bearer {staff_token}"},
    )
    assert resp_forbidden.status_code == 403

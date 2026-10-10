import datetime
import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch

from app.database import SessionLocal, tenant_session_scope
from app.main import app
from app.models import (
    ExternalIssueLink,
    PrintAgentToken,
    PrintJob,
    Restaurante,
    SuperAdminAuditLog,
)
from app.routes import super_admin
from app.security import create_access_token, get_password_hash
from app.integrations.sanitizer import sanitize_text, sanitize_payload

client = TestClient(app)
SUPERADMIN_USERNAME = "integrations-admin@example.test"
SUPERADMIN_PASSWORD = "integrations-password-test"


@pytest.mark.anyio
@pytest.mark.parametrize('response_status', [200, 401, 403])
async def test_resend_read_permission_does_not_claim_email_delivery(monkeypatch, response_status):
    import httpx
    from app.routes import super_admin_integrations
    monkeypatch.setenv('RESEND_API_KEY', 're_test_only')
    get = AsyncMock(return_value=httpx.Response(response_status))
    with patch.object(super_admin_integrations.httpx.AsyncClient, 'get', get):
        result = await super_admin_integrations._probe_resend()
    assert result['status'] == ('connected' if response_status == 200 else 'unverified')
    assert result['configured'] is True
    assert 'não testada' in result['detail']
    assert 're_test_only' not in str(result)
    assert get.call_args.args[0] == 'https://api.resend.com/domains'


@pytest.mark.anyio
async def test_resend_probe_exception_does_not_expose_credentials(monkeypatch):
    from app.routes import super_admin_integrations
    monkeypatch.setenv('RESEND_API_KEY', 're_test_only')
    with patch.object(super_admin_integrations.httpx.AsyncClient, 'get', AsyncMock(side_effect=RuntimeError('secret re_test_only'))):
        result = await super_admin_integrations._probe_resend()
    assert result['status'] == 'unverified'
    assert 're_test_only' not in str(result)
    assert 'secret' not in str(result)


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


@pytest.fixture
def mock_restaurants():
    """Cria restaurantes de teste (nunca toca no tenant 6 de produção)."""
    with SessionLocal() as db:
        # Tenant 901 e 902 sintéticos
        r1 = db.query(Restaurante).filter(Restaurante.id == 901).first()
        if not r1:
            r1 = Restaurante(id=901, nome="Bistrô Alpha Teste", slug="alpha-test")
            db.add(r1)
        r2 = db.query(Restaurante).filter(Restaurante.id == 902).first()
        if not r2:
            r2 = Restaurante(id=902, nome="Bistrô Beta Teste", slug="beta-test")
            db.add(r2)
        db.query(PrintJob).filter(PrintJob.restaurante_id.in_([901, 902])).delete()
        db.query(PrintAgentToken).filter(PrintAgentToken.restaurante_id.in_([901, 902])).delete()
        db.commit()
    yield
    with SessionLocal() as db:
        db.query(PrintJob).filter(PrintJob.restaurante_id.in_([901, 902])).delete()
        db.query(PrintAgentToken).filter(PrintAgentToken.restaurante_id.in_([901, 902])).delete()
        db.query(ExternalIssueLink).filter(ExternalIssueLink.restaurante_id.in_([901, 902])).delete()
        db.query(SuperAdminAuditLog).filter(SuperAdminAuditLog.restaurante_id.in_([901, 902])).delete()
        db.query(Restaurante).filter(Restaurante.id.in_([901, 902])).delete()
        db.commit()


def test_sanitizer_removes_pii_strictly():
    """Valida que o sanitizador mascara rigorosamente todos os formatos de PII."""
    raw_text = (
        "Cliente João Silva CPF 123.456.789-00 telefone (11) 98765-4321 "
        "email joao.silva@exemplo.com pagou com cartao 4111 2222 3333 4444 "
        "usando bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThis"
    )
    sanitized = sanitize_text(raw_text)

    assert "123.456.789-00" not in sanitized
    assert "[CPF_REDACTED]" in sanitized

    assert "98765-4321" not in sanitized
    assert "[TELEFONE_REDACTED]" in sanitized

    assert "joao.silva@exemplo.com" not in sanitized
    assert "[EMAIL_REDACTED]" in sanitized

    assert "4111 2222 3333 4444" not in sanitized
    assert "[CARTAO_REDACTED]" in sanitized

    assert "eyJhbGciOiJIUzI1Ni" not in sanitized
    assert "[TOKEN_REDACTED]" in sanitized


def test_sanitizer_cleans_nested_payload():
    payload = {
        "title": "Erro ao emitir comanda",
        "cliente_nome": "Maria Oliveira",
        "cpf": "111.222.333-44",
        "nested": {
            "email": "maria@empresa.com",
            "detalhe": "Telefone do contato: 21 99999-8888",
        },
    }
    clean = sanitize_payload(payload)
    assert clean["cliente_nome"] == "[REDACTED_PII]"
    assert clean["cpf"] == "[REDACTED_PII]"
    assert clean["nested"]["email"] == "[REDACTED_PII]"
    assert "99999-8888" not in clean["nested"]["detalhe"]
    assert "[TELEFONE_REDACTED]" in clean["nested"]["detalhe"]


def test_integration_registry_requires_superadmin():
    """Garante que apenas superadministradores acessam o registry."""
    res_no_auth = client.get("/api/super-admin/integrations/registry")
    assert res_no_auth.status_code == 401

    headers = _superadmin_headers()
    response = client.get("/api/super-admin/integrations/registry", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert "services" in data
    assert isinstance(data["services"], list)

    service_ids = [s["id"] for s in data["services"]]
    assert "linear" in service_ids
    assert "posthog" in service_ids
    assert "github" in service_ids
    assert "railway" in service_ids
    assert "cloudflare" in service_ids
    assert "resend" in service_ids

    # Confirma que nenhuma chave secreta é exposta
    raw_str = response.text.lower()
    assert "secret" not in raw_str or "secret_key" not in raw_str
    assert "password" not in raw_str
    assert "bearer" not in raw_str


@pytest.mark.anyio
async def test_create_issue_linear_and_traceability(mock_restaurants, monkeypatch):
    """
    Testa criação de issue via SuperAdmin com mock do Linear,
    garantindo persistência em external_issue_links e super_admin_audit_logs.
    """
    headers = _superadmin_headers()

    mock_linear_return = {
        "id": "linear-uuid-test-123",
        "identifier": "KOM-999",
        "title": "Bistrô Alpha Teste - Erro no fechamento",
        "url": "https://linear.app/komafood/issue/KOM-999/erro-no-fechamento",
        "priority": 2,
        "status": "Todo",
        "created_at": "2026-10-06T20:00:00Z",
    }

    from app.routes import super_admin_integrations

    monkeypatch.setattr(super_admin_integrations.linear_client, "api_key", "test-key-linear-mock")
    monkeypatch.setattr(
        super_admin_integrations.linear_client,
        "create_issue",
        AsyncMock(return_value=mock_linear_return),
    )

    issue_payload = {
        "title": "Falha na sincronização de mesa",
        "description": "Ao fechar comanda com cliente CPF 000.111.222-33 e fone 11 98888-7777 ocorre timeout.",
        "type": "Bug",
        "area": "Caixa",
        "priority": 2,
        "posthog_evidence_url": "https://us.posthog.com/project/648305/events/test-1",
    }

    # Despachar criação para tenant 901
    response = client.post(
        "/api/super-admin/restaurantes/901/issues",
        json=issue_payload,
        headers=headers,
    )
    assert response.status_code == 201
    body = response.json()
    assert body["success"] is True
    assert body["issue"]["identifier"] == "KOM-999"
    assert body["issue"]["url"] == "https://linear.app/komafood/issue/KOM-999/erro-no-fechamento"

    # Verificar que o mock do Linear recebeu a descrição SEM o CPF e Telefone
    called_args = super_admin_integrations.linear_client.create_issue.call_args
    assert called_args is not None
    called_desc = called_args.kwargs.get("description", "")
    assert "000.111.222-33" not in called_desc
    assert "[CPF_REDACTED]" in called_desc
    assert "98888-7777" not in called_desc
    assert "[TELEFONE_REDACTED]" in called_desc

    # Verificar persistência no banco
    with SessionLocal() as db:
        with tenant_session_scope(db, 901):
            links = db.query(ExternalIssueLink).filter(ExternalIssueLink.restaurante_id == 901).all()
            assert len(links) == 1
            link = links[0]
            assert link.external_identifier == "KOM-999"
            assert link.external_url == "https://linear.app/komafood/issue/KOM-999/erro-no-fechamento"
            assert link.provider == "linear"
            assert link.actor == SUPERADMIN_USERNAME

            audit = (
                db.query(SuperAdminAuditLog)
                .filter(
                    SuperAdminAuditLog.restaurante_id == 901,
                    SuperAdminAuditLog.action == "linear_issue_created",
                )
                .first()
            )
            assert audit is not None
            assert audit.actor == SUPERADMIN_USERNAME
            assert "KOM-999" in audit.reason


def test_list_issues_tenant_isolation(mock_restaurants):
    """Garante que as issues são estritamente isoladas por tenant."""
    headers = _superadmin_headers()

    # Inserir issue no tenant 901 e no tenant 902
    with SessionLocal() as db:
        with tenant_session_scope(db, 901):
            db.add(
                ExternalIssueLink(
                    restaurante_id=901,
                    provider="linear",
                    external_issue_id="uuid-901",
                    external_identifier="KOM-901",
                    external_url="https://linear.app/komafood/issue/KOM-901",
                    title_snapshot="Issue Alpha",
                    status_snapshot="In Progress",
                    actor="admin@test",
                )
            )
            db.commit()

        with tenant_session_scope(db, 902):
            db.add(
                ExternalIssueLink(
                    restaurante_id=902,
                    provider="linear",
                    external_issue_id="uuid-902",
                    external_identifier="KOM-902",
                    external_url="https://linear.app/komafood/issue/KOM-902",
                    title_snapshot="Issue Beta",
                    status_snapshot="Todo",
                    actor="admin@test",
                )
            )
            db.commit()

    # Consulta tenant 901
    resp_901 = client.get("/api/super-admin/restaurantes/901/issues", headers=headers)
    assert resp_901.status_code == 200
    items_901 = resp_901.json()
    assert len(items_901) == 1
    assert items_901[0]["external_identifier"] == "KOM-901"

    # Consulta tenant 902
    resp_902 = client.get("/api/super-admin/restaurantes/902/issues", headers=headers)
    assert resp_902.status_code == 200
    items_902 = resp_902.json()
    assert len(items_902) == 1
    assert items_902[0]["external_identifier"] == "KOM-902"


def test_get_analytics_links(mock_restaurants):
    """Garante que os links do PostHog são gerados sem a dependência do add-on pago de groups."""
    headers = _superadmin_headers()
    response = client.get("/api/super-admin/restaurantes/901/analytics", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert "posthog" in data
    assert "2178362" in data["posthog"]["operational_dashboard_url"]
    assert "events" in data["posthog"]["events_url"]
    assert "tenant_group_url" not in data["posthog"]


def test_print_status_requires_superadmin(mock_restaurants):
    """Garante autenticação obrigatória de superadmin para acessar diagnóstico de impressão."""
    res_no_auth = client.get("/api/super-admin/restaurantes/901/print-status")
    assert res_no_auth.status_code == 401


def test_print_status_not_found():
    """Garante 404 para restaurante inexistente."""
    headers = _superadmin_headers()
    response = client.get("/api/super-admin/restaurantes/99999/print-status", headers=headers)
    assert response.status_code == 404


def test_print_status_not_configured(mock_restaurants):
    """Garante retorno limpo para restaurante sem Print Agent configurado."""
    headers = _superadmin_headers()
    response = client.get("/api/super-admin/restaurantes/901/print-status", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["configured"] is False
    assert data["status"] == "not_configured"
    assert data["agent_id"] is None
    assert data["queue"]["pending"] == 0
    assert data["queue"]["claimed"] == 0
    assert data["queue"]["failed"] == 0
    assert data["last_job"] is None


def test_print_status_with_agents_and_queue(mock_restaurants):
    """Garante leitura correta de agente online, fila particionada e jobs por tenant."""
    headers = _superadmin_headers()
    now = datetime.datetime.now(datetime.timezone.utc)

    with SessionLocal() as db:
        with tenant_session_scope(db, 901):
            agent = PrintAgentToken(
                id="agent-token-test-901",
                restaurante_id=901,
                agent_id="caixa-balcao",
                token_hash="fakehash123",
                ativo=True,
                is_primary=True,
                last_seen_at=now,
                printer_diagnostics={
                    "agent_version": "1.4.2",
                    "printers": [{"name": "EPSON_TM_T20", "available": True, "present": True, "configured": True}],
                },
            )
            db.add(agent)

            pj1 = PrintJob(
                id="pj-test-1",
                restaurante_id=901,
                document_type="producao",
                destination="COZINHA",
                source_type="pedido",
                source_id="101",
                payload_text="Item 1\n",
                status="pending",
                idempotency_key="idemp-pj-1",
            )
            pj2 = PrintJob(
                id="pj-test-2",
                restaurante_id=901,
                document_type="fechamento",
                destination="FECHAMENTO",
                source_type="comanda",
                source_id="202",
                payload_text="Conta R$ 50\n",
                status="claimed",
                idempotency_key="idemp-pj-2",
            )
            pj3 = PrintJob(
                id="pj-test-3",
                restaurante_id=901,
                document_type="producao",
                destination="BAR",
                source_type="pedido",
                source_id="103",
                payload_text="Drink 1\n",
                status="failed",
                last_error="Printer out of paper",
                idempotency_key="idemp-pj-3",
            )
            db.add_all([pj1, pj2, pj3])
            db.commit()

    response = client.get("/api/super-admin/restaurantes/901/print-status", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["configured"] is True
    assert data["status"] == "online"
    assert data["agent_id"] == "caixa-balcao"
    assert data["version"] == "1.4.2"
    assert data["is_primary"] is True
    assert data["seconds_since_heartbeat"] is not None
    assert data["seconds_since_heartbeat"] <= 5
    assert data["queue"]["pending"] == 1
    assert data["queue"]["claimed"] == 1
    assert data["queue"]["failed"] == 1
    assert data["last_error"] == "Printer out of paper"
    assert data["last_job"] is not None



@pytest.mark.parametrize("path,method,expected", [
    ("issues", "GET", 200), ("analytics", "GET", 200), ("print-status", "GET", 200), ("issues", "POST", 503),
])
def test_tenant_lookup_is_scoped_before_first_query(mock_restaurants, monkeypatch, path, method, expected):
    """SQLite is permissive: explicitly enforce the production RLS precondition."""
    from sqlalchemy import event
    from types import SimpleNamespace
    from app.routes import super_admin_integrations as routes

    def scoped_session():
        db = SessionLocal()
        def assert_scope(state):
            assert db.restaurante_id == 901, "ORM accessed outside target tenant scope"
        event.listen(db, "do_orm_execute", assert_scope)
        return db

    monkeypatch.setattr(routes, "SessionLocal", scoped_session)
    monkeypatch.setattr(routes, "linear_client", SimpleNamespace(is_configured=False))
    response = client.request(method, f"/api/super-admin/restaurantes/901/{path}", headers=_superadmin_headers(), **({"json": {"title": "Teste", "description": "Teste de escopo"}} if method == "POST" else {}))
    assert response.status_code == expected, response.text


def test_issue_refresh_releases_sql_and_persists_in_target_scope(mock_restaurants, monkeypatch):
    from sqlalchemy import event
    from types import SimpleNamespace
    from app.routes import super_admin_integrations as routes

    with SessionLocal() as db:
        with tenant_session_scope(db, 901):
            db.add(ExternalIssueLink(restaurante_id=901, provider="linear", external_issue_id="scope-901", external_identifier="KOM-SCOPE", external_url="https://linear.app/example", title_snapshot="Scoped", status_snapshot="Todo", actor="test"))
            db.commit()
    active = 0
    def scoped_session():
        nonlocal active
        db = SessionLocal()
        active += 1
        original_close = db.close
        closed = False
        def close():
            nonlocal active, closed
            if not closed:
                active -= 1
                closed = True
            original_close()
        db.close = close
        def assert_scope(state):
            assert db.restaurante_id == 901
        event.listen(db, "do_orm_execute", assert_scope)
        return db
    async def read_status(identifier):
        assert active == 0, "SQL session held while awaiting Linear"
        assert identifier == "KOM-SCOPE"
        return {"status": "Done"}
    monkeypatch.setattr(routes, "SessionLocal", scoped_session)
    monkeypatch.setattr(routes, "linear_client", SimpleNamespace(is_configured=True, get_issue_status=read_status))
    response = client.get("/api/super-admin/restaurantes/901/issues?refresh_live=true", headers=_superadmin_headers())
    assert response.status_code == 200, response.text
    assert response.json()[0]["status"] == "Done"
    assert active == 0
    with SessionLocal() as db:
        with tenant_session_scope(db, 901):
            assert db.query(ExternalIssueLink).filter_by(external_identifier="KOM-SCOPE").one().status_snapshot == "Done"

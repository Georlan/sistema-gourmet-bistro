import datetime
import uuid
import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal, tenant_session_scope
from app.main import app
from app.models import Restaurante, SuperAdminAuditLog, Usuario
from app.routes import super_admin
from app.security import create_access_token, get_password_hash
from app.support_models import SupportSession

client = TestClient(app)
SUPERADMIN_USERNAME = "owner-access@example.test"
SUPERADMIN_PASSWORD = "test-password-not-for-production"


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


def test_start_support_session_success():
    """Inicia sessão de suporte com motivo válido, registra audit log e emite JWT de suporte."""
    headers = _superadmin_headers()
    payload = {
        "reason": "Investigação de divergência de fechamento de caixa reportada pelo cliente.",
        "duration_minutes": 45,
    }

    response = client.post(
        "/api/super-admin/support/1/start",
        json=payload,
        headers=headers,
    )
    assert response.status_code == 200, response.text
    data = response.json()

    assert data["session_id"] is not None
    assert data["access_token"] is not None
    assert data["token_type"] == "bearer"
    assert data["restaurant_id"] == 1
    assert data["operator"] == SUPERADMIN_USERNAME
    assert data["reason"] == payload["reason"]
    assert data["duration_minutes"] == 45
    assert "expires_at" in data

    # Prova persistência na tabela support_sessions
    with SessionLocal() as db:
        session_rec = (
            db.query(SupportSession)
            .filter(SupportSession.id == data["session_id"])
            .first()
        )
        assert session_rec is not None
        assert session_rec.status == "active"
        assert session_rec.operator == SUPERADMIN_USERNAME
        assert session_rec.restaurante_id == 1

        # Prova auditoria append-only
        audit = (
            db.query(SuperAdminAuditLog)
            .filter(
                SuperAdminAuditLog.restaurante_id == 1,
                SuperAdminAuditLog.action == "SUPERADMIN_SUPPORT_SESSION_START",
            )
            .order_by(SuperAdminAuditLog.id.desc())
            .first()
        )
        assert audit is not None
        assert audit.actor == SUPERADMIN_USERNAME
        assert audit.after_data["session_id"] == data["session_id"]


def test_start_support_session_validations():
    """Rejeita motivos curtos e requisições sem privilégios de Super Admin."""
    headers = _superadmin_headers()

    # Motivo menor que 5 caracteres
    resp_short = client.post(
        "/api/super-admin/support/1/start",
        json={"reason": "abc"},
        headers=headers,
    )
    assert resp_short.status_code == 422

    # Sem header de autorização
    resp_unauth = client.post(
        "/api/super-admin/support/1/start",
        json={"reason": "Investigando problema com suporte."},
    )
    assert resp_unauth.status_code == 401

    # Com token de usuário comum (não superadmin)
    staff_token = create_access_token(
        subject="garcom-1",
        restaurante_id=1,
        role="garcom",
    )
    resp_forbidden = client.post(
        "/api/super-admin/support/1/start",
        json={"reason": "Tentativa de escalonamento de privilégio."},
        headers={"Authorization": f"Bearer {staff_token}"},
    )
    assert resp_forbidden.status_code == 403


def test_support_mode_authenticates_operational_routes():
    """O token emitido em Support Mode permite acesso a rotas operacionais do tenant."""
    headers = _superadmin_headers()
    resp = client.post(
        "/api/super-admin/support/1/start",
        json={"reason": "Auditoria de catálogo operacional."},
        headers=headers,
    )
    assert resp.status_code == 200
    support_token = resp.json()["access_token"]
    support_headers = {"Authorization": f"Bearer {support_token}"}

    # Consulta endpoint protegido de caixa / produtos
    op_resp = client.get("/produtos/", headers=support_headers)
    assert op_resp.status_code == 200
    assert isinstance(op_resp.json(), list)


def test_support_mode_allows_access_to_suspended_restaurant():
    """Operador em Modo Suporte consegue acessar estabelecimento suspenso para diagnóstico."""
    headers = _superadmin_headers()

    # Suspende o restaurante 1 temporariamente para o teste
    with SessionLocal() as db:
        r = db.query(Restaurante).filter(Restaurante.id == 1).first()
        prev_status = r.saas_status
        r.saas_status = "suspended"
        db.commit()

    try:
        # Usuário operacional comum recebe 403
        normal_token = create_access_token(
            subject="u-normal",
            restaurante_id=1,
            role="admin",
        )
        normal_headers = {"Authorization": f"Bearer {normal_token}"}
        # Inserir usuário na base para passar da busca de usuario
        with SessionLocal() as db:
            existing = db.query(Usuario).filter(Usuario.id == "u-normal").first()
            if not existing:
                db.add(Usuario(
                    id="u-normal",
                    nome="Normal User",
                    email="u-normal@example.test",
                    cargo="admin",
                    restaurante_id=1,
                    status="ativo",
                    senha_hash=get_password_hash("pass"),
                ))
                db.commit()

        resp_blocked = client.get("/produtos/", headers=normal_headers)
        assert resp_blocked.status_code == 403
        assert "suspenso" in resp_blocked.json()["detail"].lower()

        # Operador de suporte KÔMA consegue acessar mesmo suspenso
        resp_support = client.post(
            "/api/super-admin/support/1/start",
            json={"reason": "Diagnóstico de pendência em restaurante suspenso."},
            headers=headers,
        )
        assert resp_support.status_code == 200
        support_token = resp_support.json()["access_token"]

        resp_allowed = client.get(
            "/produtos/",
            headers={"Authorization": f"Bearer {support_token}"},
        )
        assert resp_allowed.status_code == 200
    finally:
        with SessionLocal() as db:
            r = db.query(Restaurante).filter(Restaurante.id == 1).first()
            r.saas_status = prev_status
            db.commit()


def test_end_support_session_invalidates_token_immediately():
    """Encerrar a sessão de suporte invalida o token imediatamente, retornando 401."""
    headers = _superadmin_headers()
    start_resp = client.post(
        "/api/super-admin/support/1/start",
        json={"reason": "Sessão que será encerrada pelo superadmin."},
        headers=headers,
    )
    assert start_resp.status_code == 200
    session_id = start_resp.json()["session_id"]
    support_token = start_resp.json()["access_token"]
    support_headers = {"Authorization": f"Bearer {support_token}"}

    # Valida que o token funciona
    ok_resp = client.get("/produtos/", headers=support_headers)
    assert ok_resp.status_code == 200

    # Super Admin encerra a sessão
    end_resp = client.post(
        "/api/super-admin/support/1/end",
        json={"reason": "Chamado concluído pelo time de suporte."},
        headers=headers,
    )
    assert end_resp.status_code == 200
    assert end_resp.json()["closed_count"] >= 1

    # Nova requisição com o mesmo token de suporte agora falha com 401
    fail_resp = client.get("/produtos/", headers=support_headers)
    assert fail_resp.status_code == 401
    assert "encerrada" in fail_resp.json()["detail"].lower()


def test_operator_can_end_own_support_session():
    """Operador pode encerrar a sessão de suporte chamando /end-current com o próprio token de suporte."""
    headers = _superadmin_headers()
    start_resp = client.post(
        "/api/super-admin/support/1/start",
        json={"reason": "Sessão que o operador encerrará diretamente."},
        headers=headers,
    )
    assert start_resp.status_code == 200
    support_token = start_resp.json()["access_token"]
    support_headers = {"Authorization": f"Bearer {support_token}"}

    # Operador clica em "Encerrar Suporte" no banner
    end_resp = client.post(
        "/api/super-admin/support/end-current",
        json={"reason": "Encerramento voluntário pelo operador."},
        headers=support_headers,
    )
    assert end_resp.status_code == 200

    # Token agora é rejeitado
    fail_resp = client.get("/produtos/", headers=support_headers)
    assert fail_resp.status_code == 401


def test_get_active_support_session():
    """Consulta de sessão de suporte ativa informa status e tempo restante."""
    headers = _superadmin_headers()

    # Encerra qualquer sessão ativa anterior
    client.post("/api/super-admin/support/1/end", json={}, headers=headers)

    # Consulta quando não há sessão
    none_resp = client.get("/api/super-admin/support/1/active", headers=headers)
    assert none_resp.status_code == 200
    assert none_resp.json()["active"] is False

    # Inicia uma sessão de 30 minutos
    start_resp = client.post(
        "/api/super-admin/support/1/start",
        json={"reason": "Sessão para checagem ativa.", "duration_minutes": 30},
        headers=headers,
    )
    assert start_resp.status_code == 200

    # Consulta com sessão ativa
    active_resp = client.get("/api/super-admin/support/1/active", headers=headers)
    assert active_resp.status_code == 200
    data = active_resp.json()
    assert data["active"] is True
    assert data["session"]["operator"] == SUPERADMIN_USERNAME
    assert data["session"]["remaining_seconds"] > 0

import datetime
import uuid
import pytest
import jwt
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.database import SessionLocal, tenant_session_scope
from app.main import app
from app.models import Cliente, Restaurante, SuperAdminAuditLog, Usuario
from app.routes import super_admin
from app.security import (
    _authenticated_user_from_token,
    create_access_token,
    get_password_hash,
)
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


def test_support_mode_is_read_only_for_permission_guarded_tenant_mutations():
    """Modo Suporte navega e diagnostica, mas não altera configuração do tenant."""
    headers = _superadmin_headers()
    start = client.post(
        "/api/super-admin/support/1/start",
        json={"reason": "Diagnóstico somente leitura das configurações."},
        headers=headers,
    )
    assert start.status_code == 200, start.text
    support_headers = {
        "Authorization": f"Bearer {start.json()['access_token']}"
    }

    read = client.get("/caixa/configuracoes", headers=support_headers)
    assert read.status_code == 200, read.text

    write = client.put(
        "/caixa/configuracoes",
        headers=support_headers,
        json={},
    )
    assert write.status_code == 403, write.text
    assert "somente para diagnóstico" in write.json()["detail"]
    assert "Super Admin" in write.json()["detail"]

    # O encerramento explícito da própria sessão continua sendo uma ação de suporte válida.
    end = client.post(
        "/api/super-admin/support/end-current",
        headers=support_headers,
        json={"reason": "Diagnóstico concluído sem alteração do tenant."},
    )
    assert end.status_code == 200, end.text


def test_customer_pii_requires_audited_support_mode():
    """Super Admin direto não acessa PII tenant; Modo Suporte temporário pode."""
    phone = f"859{str(int(uuid.uuid4().hex[:8], 16))[-8:].zfill(8)}"
    customer_id = f"support-pii-{uuid.uuid4().hex}"

    with SessionLocal() as db:
        with tenant_session_scope(db, 1):
            db.add(
                Cliente(
                    id=customer_id,
                    restaurante_id=1,
                    nome="Cliente Suporte LGPD",
                    telefone=phone,
                )
            )
            db.commit()

    headers = _superadmin_headers()

    # O JWT administrativo global usa restaurante_id=0 e não autentica rotas
    # operacionais tenant-scoped; portanto não pode navegar diretamente na base.
    direct = client.get("/fidelidade/clientes", headers=headers)
    assert direct.status_code == 401

    start = client.post(
        "/api/super-admin/support/1/start",
        json={"reason": "Diagnóstico de cadastro do cliente solicitado pelo restaurante."},
        headers=headers,
    )
    assert start.status_code == 200, start.text
    support_headers = {
        "Authorization": f"Bearer {start.json()['access_token']}"
    }

    try:
        scoped = client.get("/fidelidade/clientes", headers=support_headers)
        assert scoped.status_code == 200, scoped.text
        assert any(
            row.get("id") == customer_id
            and row.get("telefone") == phone
            for row in scoped.json()
        )
    finally:
        client.post(
            "/api/super-admin/support/1/end",
            json={"reason": "Diagnóstico de PII concluído."},
            headers=headers,
        )
        with SessionLocal() as db:
            with tenant_session_scope(db, 1):
                customer = db.query(Cliente).filter(Cliente.id == customer_id).first()
                if customer is not None:
                    db.delete(customer)
                    db.commit()


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


def test_support_token_minimal_claims_and_authoritative_session_operator():
    """Valida que o JWT de suporte não contém reason nem operator,
    mas a autenticação carrega o operador diretamente da SupportSession autoritativa.
    Valida também que status encerrado/expirado e session_id/tenant/jti inválidos retornam 401.
    """
    headers = _superadmin_headers()
    start_resp = client.post(
        "/api/super-admin/support/1/start",
        json={"reason": "Auditoria de claims mínimos do token de suporte.", "duration_minutes": 30},
        headers=headers,
    )
    assert start_resp.status_code == 200
    data = start_resp.json()
    token = data["access_token"]
    session_id = data["session_id"]
    operator = data["operator"]

    # 1. Decode sem validar assinatura
    raw_claims = jwt.decode(token, options={"verify_signature": False})
    assert "reason" not in raw_claims
    assert "operator" not in raw_claims

    # Claims mantidos estritamente necessários
    assert raw_claims.get("support_mode") is True
    assert raw_claims.get("support_session_id") == session_id
    assert raw_claims.get("jti") is not None
    assert raw_claims.get("sub") == f"support:{operator}"
    assert raw_claims.get("restaurante_id") == 1
    assert raw_claims.get("role") == "admin"
    assert raw_claims.get("exp") is not None

    # 2. Autenticar o token e confirmar que SupportOperatorUser recebe o operador da SupportSession
    with SessionLocal() as db:
        user = _authenticated_user_from_token(token, db)
        assert user.is_support_mode is True
        assert user.support_operator == operator
        assert user.support_session_id == session_id
        assert user.restaurante_id == 1
        assert user.support_reason == "Auditoria de claims mínimos do token de suporte."

    # 3. Sessão encerrada retorna 401
    with SessionLocal() as db:
        sess = db.query(SupportSession).filter(SupportSession.id == session_id).first()
        sess.status = "ended"
        db.commit()

    with pytest.raises(HTTPException) as exc_info:
        with SessionLocal() as db:
            _authenticated_user_from_token(token, db)
    assert exc_info.value.status_code == 401
    assert "encerrada" in exc_info.value.detail.lower()

    # Re-ativa temporariamente para testar expiração
    with SessionLocal() as db:
        sess = db.query(SupportSession).filter(SupportSession.id == session_id).first()
        sess.status = "active"
        sess.expires_at = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=10)
        db.commit()

    # 4. Sessão expirada retorna 401
    with pytest.raises(HTTPException) as exc_info:
        with SessionLocal() as db:
            _authenticated_user_from_token(token, db)
    assert exc_info.value.status_code == 401
    assert "expirada" in exc_info.value.detail.lower()

    # 5. Validação de session id + tenant + jti
    # Cria token válido em nova sessão para os testes de mismatch
    start_resp2 = client.post(
        "/api/super-admin/support/1/start",
        json={"reason": "Sessão 2 para testes de validação de jti e tenant.", "duration_minutes": 30},
        headers=headers,
    )
    assert start_resp2.status_code == 200
    token2 = start_resp2.json()["access_token"]
    raw_claims2 = jwt.decode(token2, options={"verify_signature": False})
    valid_jti = raw_claims2["jti"]
    valid_session_id = raw_claims2["support_session_id"]

    # a) session id mismatch
    token_bad_session = create_access_token(
        subject=f"support:{operator}",
        restaurante_id=1,
        role="admin",
        extra_claims={
            "support_mode": True,
            "support_session_id": str(uuid.uuid4()),
            "jti": valid_jti,
        },
    )
    with pytest.raises(HTTPException) as exc_info:
        with SessionLocal() as db:
            _authenticated_user_from_token(token_bad_session, db)
    assert exc_info.value.status_code == 401

    # b) tenant mismatch
    token_bad_tenant = create_access_token(
        subject=f"support:{operator}",
        restaurante_id=999,
        role="admin",
        extra_claims={
            "support_mode": True,
            "support_session_id": valid_session_id,
            "jti": valid_jti,
        },
    )
    with pytest.raises(HTTPException) as exc_info:
        with SessionLocal() as db:
            _authenticated_user_from_token(token_bad_tenant, db)
    assert exc_info.value.status_code == 401

    # c) jti mismatch
    token_bad_jti = create_access_token(
        subject=f"support:{operator}",
        restaurante_id=1,
        role="admin",
        extra_claims={
            "support_mode": True,
            "support_session_id": valid_session_id,
            "jti": str(uuid.uuid4()),
        },
    )
    with pytest.raises(HTTPException) as exc_info:
        with SessionLocal() as db:
            _authenticated_user_from_token(token_bad_jti, db)
    assert exc_info.value.status_code == 401

    # d) missing support_session_id
    token_no_session = create_access_token(
        subject=f"support:{operator}",
        restaurante_id=1,
        role="admin",
        extra_claims={
            "support_mode": True,
            "jti": valid_jti,
        },
    )
    with pytest.raises(HTTPException) as exc_info:
        with SessionLocal() as db:
            _authenticated_user_from_token(token_no_session, db)
    assert exc_info.value.status_code == 401

    # e) missing jti
    token_no_jti = create_access_token(
        subject=f"support:{operator}",
        restaurante_id=1,
        role="admin",
        extra_claims={
            "support_mode": True,
            "support_session_id": valid_session_id,
        },
    )
    with pytest.raises(HTTPException) as exc_info:
        with SessionLocal() as db:
            _authenticated_user_from_token(token_no_jti, db)
    assert exc_info.value.status_code == 401

    # Limpeza
    client.post("/api/super-admin/support/1/end", json={}, headers=headers)


"""
Tests for role-based authorization and user status enforcement.
"""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db, current_restaurante_id
from app.models import ConfiguracaoRestaurante, Restaurante, Usuario
from app.security import get_password_hash
from app.main import app

DB_FILE = "./test_authorization.db"
SQLALCHEMY_DATABASE_URL = f"sqlite:///{DB_FILE}"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 30}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="module", autouse=True)
def cleanup_database_file():
    """Remove artefatos SQLite somente depois que todos os testes terminarem."""
    yield
    engine.dispose()
    for suffix in ("", "-wal", "-shm", "-journal"):
        Path(f"{DB_FILE}{suffix}").unlink(missing_ok=True)


def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def setup_database():
    token_var = current_restaurante_id.set(1)
    try:
        app.dependency_overrides[get_db] = override_get_db
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        db = TestingSessionLocal()

        db.merge(Restaurante(id=1, nome="Auth Test Bistro", plano="bistro"))
        db.add_all([
            Restaurante(id=2, nome="Outro Tenant", plano="premium"),
            Restaurante(id=3, nome="Tenant sem Configuração", plano="pocket"),
        ])
        db.flush()

        # Admin ativo
        db.add(Usuario(
            id="u-admin", restaurante_id=1, nome="Admin Auth",
            usuario="admin", senha_hash=get_password_hash("123"),
            role="admin", cargo="admin", status="ativo"
        ))
        # Garçom ativo
        db.add(Usuario(
            id="u-garcom", restaurante_id=1, nome="Garcom Auth",
            usuario="garcom", senha_hash=get_password_hash("123"),
            role="garcom", cargo="garcom", status="ativo"
        ))
        # Gerente ativo
        db.add(Usuario(
            id="u-gerente", restaurante_id=1, nome="Gerente Auth",
            usuario="gerente", senha_hash=get_password_hash("123"),
            role="gerente", cargo="gerente", status="ativo"
        ))
        # Operador de caixa ativo
        db.add(Usuario(
            id="u-caixa", restaurante_id=1, nome="Caixa Auth",
            usuario="caixa", senha_hash=get_password_hash("123"),
            role="caixa", cargo="caixa", status="ativo"
        ))
        # Usuário inativo
        db.add(Usuario(
            id="u-inativo", restaurante_id=1, nome="Inativo Auth",
            usuario="inativo", senha_hash=get_password_hash("123"),
            role="garcom", cargo="garcom", status="inativo"
        ))
        # Convite pendente com senha legada: não pode autenticar.
        db.add(Usuario(
            id="u-pendente", restaurante_id=1, nome="Pendente Auth",
            usuario="pendente", senha_hash=get_password_hash("123"),
            role="garcom", cargo="garcom", status="pendente_ativacao",
            token_convite="invite-pendente",
        ))
        db.add(Usuario(
            id="u-sem-config", restaurante_id=3, nome="Admin sem Config",
            usuario="sem-config", senha_hash=get_password_hash("123"),
            role="admin", cargo="admin", status="ativo"
        ))
        db.add(Usuario(
            id="u-outro-tenant", restaurante_id=2, nome="Outro Tenant User",
            usuario="outro-tenant", senha_hash=get_password_hash("123"),
            role="garcom", cargo="garcom", status="ativo"
        ))
        db.add_all([
            ConfiguracaoRestaurante(
                restaurante_id=1,
                nicho="hamburgueria",
                taxa_servico_padrao=10.0,
            ),
            ConfiguracaoRestaurante(
                restaurante_id=2,
                nicho="pizzaria",
                taxa_servico_padrao=12.0,
            ),
        ])

        db.commit()
        db.close()
        yield
    finally:
        current_restaurante_id.reset(token_var)
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def get_auth_headers(client, username, password):
    resp = client.post("/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, f"Login falhou para {username}: {resp.text}"
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def test_garcom_blocked_from_relatorios():
    """Garçom deve receber HTTP 403 ao tentar acessar relatórios."""
    client = TestClient(app)
    headers = get_auth_headers(client, "garcom", "123")

    resp = client.get("/relatorios/visao-geral", headers=headers)
    assert resp.status_code == 403, f"Esperado 403, obteve {resp.status_code}"
    assert "Acesso negado" in resp.json()["detail"]


def test_admin_allowed_relatorios():
    """Admin deve acessar relatórios normalmente."""
    client = TestClient(app)
    headers = get_auth_headers(client, "admin", "123")

    resp = client.get("/relatorios/visao-geral", headers=headers)
    assert resp.status_code == 200


@pytest.mark.parametrize(
    ("method", "path", "payload"),
    [
        ("put", "/comandas/itens/inexistente/status?status=pronto", None),
        ("delete", "/estoque/distribuidores/inexistente", None),
        (
            "post",
            "/produtos/categorias",
            {"id": "cat-negada", "nome": "Categoria negada", "destino_impressao": "COZINHA"},
        ),
        ("get", "/comandas/estatisticas/geral", None),
        ("post", "/auth/usuarios/u-gerente/reenviar-convite", None),
    ],
)
def test_garcom_blocked_from_sensitive_backoffice_routes(method, path, payload):
    """Garçom não pode administrar status, estoque, catálogo, BI ou equipe."""
    client = TestClient(app)
    headers = get_auth_headers(client, "garcom", "123")

    response = client.request(method, path, headers=headers, json=payload)

    assert response.status_code == 403, response.text
    assert "Acesso negado" in response.json()["detail"]


def test_gerente_allowed_by_central_permission_matrix():
    """Gerente acessa BI e administra catálogo pela mesma matriz central."""
    client = TestClient(app)
    headers = get_auth_headers(client, "gerente", "123")

    report_response = client.get("/relatorios/visao-geral", headers=headers)
    assert report_response.status_code == 200

    catalog_response = client.post(
        "/produtos/categorias",
        json={
            "id": "cat-gerente",
            "nome": "Categoria do gerente",
            "destino_impressao": "COZINHA",
        },
        headers=headers,
    )
    assert catalog_response.status_code == 201, catalog_response.text


def test_inactive_user_blocked():
    """Usuário inativo não deve receber token de acesso."""
    client = TestClient(app)

    resp = client.post(
        "/auth/login",
        json={"username": "inativo", "password": "123"},
    )

    assert resp.status_code == 403, f"Esperado 403, obteve {resp.status_code}"
    assert "access_token" not in resp.json()
    assert "inativa ou bloqueada" in resp.json()["detail"]


def test_pending_user_with_legacy_password_cannot_login():
    """Convite pendente não autentica, mesmo se houver hash legado no banco."""
    client = TestClient(app)

    response = client.post(
        "/auth/login",
        json={"username": "pendente", "password": "123"},
    )

    assert response.status_code == 403
    assert "access_token" not in response.json()
    assert "pendente" in response.json()["detail"].lower()


def test_invite_activation_rejects_weak_password():
    client = TestClient(app)

    response = client.post(
        "/auth/ativar",
        json={
            "token_convite": "invite-pendente",
            "email": "pendente@koma.test",
            "senha": "123",
        },
    )

    assert response.status_code == 422
    with TestingSessionLocal() as db:
        user = db.get(Usuario, "u-pendente")
        assert user.status == "pendente_ativacao"
        assert user.email is None


@pytest.mark.parametrize("username", ["gerente", "caixa"])
def test_manager_and_cashier_can_administer_team(username):
    client = TestClient(app)
    headers = get_auth_headers(client, username, "123")
    payload = {
        "nome": "Tentativa Privilegiada",
        "telefone": "81988887777",
        "cargo": "garcom",
    }

    assert client.get("/caixa/funcionarios", headers=headers).status_code == 200
    created_response = client.post(
        "/caixa/funcionarios",
        headers=headers,
        json=payload,
    )
    assert created_response.status_code == 201, created_response.text
    created = created_response.json()
    assert created["status"] == "pendente_ativacao"
    assert client.delete(
        f"/auth/usuarios/{created['id']}",
        headers=headers,
    ).status_code == 204

    with TestingSessionLocal() as db:
        assert (
            db.query(Usuario)
            .filter(Usuario.nome == "Tentativa Privilegiada")
            .count()
            == 0
        )


def test_admin_creates_only_pending_invite_in_own_tenant():
    client = TestClient(app)
    headers = get_auth_headers(client, "admin", "123")

    response = client.post(
        "/caixa/funcionarios",
        headers=headers,
        json={
            "nome": "  Nova Garçonete  ",
            "telefone": "(81) 99999-8877",
            "cargo": "garcom",
        },
    )

    assert response.status_code == 201, response.text
    created = response.json()
    assert created["nome"] == "Nova Garçonete"
    assert created["restaurante_id"] == 1
    assert created["status"] == "pendente_ativacao"
    assert created["cargo"] == "garcom"
    assert created["token_convite"]

    with TestingSessionLocal() as db:
        saved = db.get(Usuario, created["id"])
        assert saved is not None
        assert saved.restaurante_id == 1
        assert saved.telefone == "81999998877"
        assert saved.senha_hash is None


def test_admin_team_listing_is_scoped_to_authenticated_tenant():
    client = TestClient(app)
    headers = get_auth_headers(client, "admin", "123")

    response = client.get("/auth/usuarios", headers=headers)

    assert response.status_code == 200
    returned_ids = {user["id"] for user in response.json()}
    assert "u-admin" in returned_ids
    assert "u-outro-tenant" not in returned_ids


@pytest.mark.parametrize(
    "forbidden_cargo",
    ["admin", "superadmin", "atendente", "cozinha"],
)
def test_team_invite_rejects_privileged_or_unsupported_roles(forbidden_cargo):
    client = TestClient(app)
    headers = get_auth_headers(client, "admin", "123")

    response = client.post(
        "/caixa/funcionarios",
        headers=headers,
        json={
            "nome": "Cargo Inválido",
            "telefone": "81977776666",
            "cargo": forbidden_cargo,
        },
    )

    assert response.status_code == 422


@pytest.mark.parametrize("extra_field", ["senha", "role", "restaurante_id"])
def test_team_invite_rejects_security_sensitive_extra_fields(extra_field):
    client = TestClient(app)
    headers = get_auth_headers(client, "admin", "123")
    payload = {
        "nome": "Campo Proibido",
        "telefone": "81966665555",
        "cargo": "garcom",
        extra_field: "admin" if extra_field != "restaurante_id" else 2,
    }

    response = client.post(
        "/caixa/funcionarios",
        headers=headers,
        json=payload,
    )

    assert response.status_code == 422
    assert any(
        error["type"] == "extra_forbidden"
        and error["loc"][-1] == extra_field
        for error in response.json()["detail"]
    )


def test_direct_password_user_creation_endpoint_is_removed():
    client = TestClient(app)
    headers = get_auth_headers(client, "admin", "123")

    response = client.post(
        "/auth/usuarios",
        headers=headers,
        json={
            "nome": "Admin Paralelo",
            "usuario": "admin-paralelo",
            "senha": "senha-conhecida",
            "role": "admin",
            "restaurante_id": 2,
        },
    )

    assert response.status_code == 405
    with TestingSessionLocal() as db:
        assert (
            db.query(Usuario)
            .filter(Usuario.usuario == "admin-paralelo")
            .count()
            == 0
        )


def test_admin_cannot_delete_self():
    client = TestClient(app)
    headers = get_auth_headers(client, "admin", "123")

    response = client.delete("/auth/usuarios/u-admin", headers=headers)

    assert response.status_code == 409
    with TestingSessionLocal() as db:
        assert db.get(Usuario, "u-admin") is not None


def test_admin_cannot_delete_user_from_another_tenant():
    client = TestClient(app)
    headers = get_auth_headers(client, "admin", "123")

    response = client.delete("/auth/usuarios/u-outro-tenant", headers=headers)

    assert response.status_code == 404
    tenant_token = current_restaurante_id.set(2)
    try:
        with TestingSessionLocal() as db:
            assert db.get(Usuario, "u-outro-tenant") is not None
    finally:
        current_restaurante_id.reset(tenant_token)


def test_configuracoes_requires_authentication_and_does_not_provision():
    client = TestClient(app)

    response = client.get("/caixa/configuracoes?restaurante_id=3")

    assert response.status_code == 401
    with TestingSessionLocal() as db:
        assert (
            db.query(ConfiguracaoRestaurante)
            .filter(ConfiguracaoRestaurante.restaurante_id == 3)
            .count()
            == 0
        )


def test_configuracoes_cannot_be_redirected_to_another_tenant(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "KOMA_TEST_PREMIUM_RESTAURANTE_IDS", "1")
    client = TestClient(app)
    headers = get_auth_headers(client, "admin", "123")

    response = client.get(
        "/caixa/configuracoes?restaurante_id=2",
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["nicho"] == "hamburgueria"
    assert response.json()["taxa_servico_padrao"] == 10.0
    assert response.json()["plano"] == "bistro"
    assert response.json()["plano_efetivo"] == "premium"
    assert response.json()["plano_modo_teste"] is True


def test_configuracoes_missing_returns_404_without_writing():
    client = TestClient(app)
    headers = get_auth_headers(client, "sem-config", "123")

    response = client.get("/caixa/configuracoes", headers=headers)

    assert response.status_code == 404
    assert response.json()["detail"] == (
        "Configurações do restaurante ainda não foram provisionadas."
    )
    with TestingSessionLocal() as db:
        assert (
            db.query(ConfiguracaoRestaurante)
            .filter(ConfiguracaoRestaurante.restaurante_id == 3)
            .count()
            == 0
        )


def test_tenant_cannot_change_its_plan_through_configuration_payload():
    client = TestClient(app)
    headers = get_auth_headers(client, "admin", "123")

    response = client.put(
        "/caixa/configuracoes",
        headers=headers,
        json={"plano": "premium"},
    )

    assert response.status_code == 422
    assert any(
        error["type"] == "extra_forbidden"
        and error["loc"][-1] == "plano"
        for error in response.json()["detail"]
    )
    with TestingSessionLocal() as db:
        assert db.get(Restaurante, 1).plano == "bistro"


def test_tenant_plan_update_endpoint_is_not_exposed():
    client = TestClient(app)
    headers = get_auth_headers(client, "admin", "123")

    response = client.put(
        "/caixa/plano",
        headers=headers,
        json={"plano": "premium"},
    )

    assert response.status_code == 404
    with TestingSessionLocal() as db:
        assert db.get(Restaurante, 1).plano == "bistro"


def test_valid_configuration_update_preserves_subscription_plan():
    client = TestClient(app)
    headers = get_auth_headers(client, "admin", "123")

    response = client.put(
        "/caixa/configuracoes",
        headers=headers,
        json={"taxa_servico_ativa": False},
    )

    assert response.status_code == 200
    assert response.json()["taxa_servico_ativa"] is False
    with TestingSessionLocal() as db:
        assert db.get(Restaurante, 1).plano == "bistro"

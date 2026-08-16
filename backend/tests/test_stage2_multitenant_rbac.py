import pytest
from fastapi.testclient import TestClient

from app.database import (
    Base,
    SessionLocal,
    TenantScopeError,
    current_restaurante_id,
    engine,
    tenant_session_scope,
)
from app.main import app
from app.models import Categoria, ConfiguracaoRestaurante, ObservacaoPredefinida, Restaurante, Usuario
from app.security import create_access_token


TENANT_A = 29101
TENANT_B = 29102
WAITER_A = "stage2-waiter-a"
MANAGER_A = "stage2-manager-a"
USER_B = "stage2-user-b"
CATEGORY_A = "stage2-cat-a"
CATEGORY_B = "stage2-cat-b"

client = TestClient(app)


@pytest.fixture(autouse=True)
def stage2_data():
    Base.metadata.create_all(bind=engine)
    token = current_restaurante_id.set(None)
    db = SessionLocal(restaurante_id=None)
    try:
        db.query(ObservacaoPredefinida).filter(
            ObservacaoPredefinida.categoria_id.in_([CATEGORY_A, CATEGORY_B])
        ).delete(synchronize_session=False)
        db.query(Categoria).filter(Categoria.id.in_([CATEGORY_A, CATEGORY_B])).delete(
            synchronize_session=False
        )
        db.query(ConfiguracaoRestaurante).filter(
            ConfiguracaoRestaurante.restaurante_id.in_([TENANT_A, TENANT_B])
        ).delete(synchronize_session=False)
        db.query(Usuario).filter(
            Usuario.id.in_([WAITER_A, MANAGER_A, USER_B])
        ).delete(synchronize_session=False)
        db.query(Restaurante).filter(Restaurante.id.in_([TENANT_A, TENANT_B])).delete(
            synchronize_session=False
        )
        db.commit()

        db.add_all(
            [
                Restaurante(id=TENANT_A, nome="Stage2 Tenant A", plano="bistro"),
                Restaurante(id=TENANT_B, nome="Stage2 Tenant B", plano="bistro"),
            ]
        )
        db.flush()
        db.add_all(
            [
                Categoria(
                    id=CATEGORY_A,
                    restaurante_id=TENANT_A,
                    nome="Categoria A",
                ),
                Categoria(
                    id=CATEGORY_B,
                    restaurante_id=TENANT_B,
                    nome="Categoria B",
                ),
                Usuario(
                    id=WAITER_A,
                    restaurante_id=TENANT_A,
                    nome="Garçom Stage2",
                    role="garcom",
                    cargo="garcom",
                    status="ativo",
                ),
                Usuario(
                    id=MANAGER_A,
                    restaurante_id=TENANT_A,
                    nome="Gerente Stage2",
                    role="gerente",
                    cargo="gerente",
                    status="ativo",
                ),
                Usuario(
                    id=USER_B,
                    restaurante_id=TENANT_B,
                    nome="Usuário Stage2 B",
                    role="admin",
                    cargo="admin",
                    status="ativo",
                ),
                ConfiguracaoRestaurante(
                    restaurante_id=TENANT_A,
                    perm_garcom_print=False,
                ),
            ]
        )
        db.commit()
        yield
    finally:
        db.rollback()
        db.close()
        current_restaurante_id.reset(token)


def _headers(subject: str, restaurante_id: int, role: str) -> dict[str, str]:
    token = create_access_token(
        subject=subject,
        restaurante_id=restaurante_id,
        role=role,
    )
    return {"Authorization": f"Bearer {token}"}


def test_session_bound_select_is_tenant_scoped_without_contextvar():
    token = current_restaurante_id.set(None)
    try:
        with SessionLocal(restaurante_id=TENANT_A) as db:
            categories = db.query(Categoria).order_by(Categoria.id).all()
            ids = {category.id for category in categories}
            assert CATEGORY_A in ids
            assert CATEGORY_B not in ids
    finally:
        current_restaurante_id.reset(token)


def test_context_and_session_tenant_mismatch_fails_closed():
    token = current_restaurante_id.set(TENANT_B)
    try:
        with SessionLocal(restaurante_id=TENANT_A) as db:
            with pytest.raises(TenantScopeError, match="inconsistente"):
                db.query(Categoria).all()
    finally:
        current_restaurante_id.reset(token)


def test_cross_tenant_insert_is_rejected_before_sql():
    token = current_restaurante_id.set(None)
    try:
        with SessionLocal(restaurante_id=TENANT_A) as db:
            db.add(
                Categoria(
                    id="stage2-cross-tenant",
                    restaurante_id=TENANT_B,
                    nome="Não pode entrar",
                )
            )
            with pytest.raises(TenantScopeError, match="cross-tenant"):
                db.flush()
            db.rollback()
    finally:
        current_restaurante_id.reset(token)


def test_new_tenant_entity_without_id_inherits_bound_session():
    token = current_restaurante_id.set(None)
    try:
        with SessionLocal(restaurante_id=TENANT_A) as db:
            observation = ObservacaoPredefinida(
                categoria_id=CATEGORY_A,
                texto="Sem cebola Stage2",
            )
            db.add(observation)
            db.flush()
            assert observation.restaurante_id == TENANT_A
            db.rollback()
    finally:
        current_restaurante_id.reset(token)


def test_tenant_session_scope_restores_context_and_session_identity():
    token = current_restaurante_id.set(TENANT_B)
    try:
        with SessionLocal(restaurante_id=TENANT_B) as db:
            with tenant_session_scope(db, TENANT_A):
                assert current_restaurante_id.get() == TENANT_A
                assert db.restaurante_id == TENANT_A
                ids = {category.id for category in db.query(Categoria).all()}
                assert CATEGORY_A in ids
                assert CATEGORY_B not in ids

            assert current_restaurante_id.get() == TENANT_B
            assert db.restaurante_id == TENANT_B
            ids = {category.id for category in db.query(Categoria).all()}
            assert CATEGORY_B in ids
            assert CATEGORY_A not in ids
    finally:
        current_restaurante_id.reset(token)


def test_jwt_role_claim_cannot_promote_waiter():
    response = client.get(
        "/relatorios/visao-geral",
        headers=_headers(WAITER_A, TENANT_A, "admin"),
    )
    assert response.status_code == 403, response.text
    assert "Acesso negado" in response.json()["detail"]


def test_jwt_cannot_reference_user_from_another_tenant():
    response = client.get(
        "/produtos/catalogo",
        headers=_headers(USER_B, TENANT_A, "admin"),
    )
    assert response.status_code == 401, response.text


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", "/mesas/1/imprimir-recibo"),
        ("post", "/comandas/lancamentos/l-stage2-inexistente/reimprimir"),
    ],
)
def test_waiter_print_toggle_is_enforced_on_stage1_shadow_routes(method, path):
    response = client.request(
        method,
        path,
        headers=_headers(WAITER_A, TENANT_A, "garcom"),
    )
    assert response.status_code == 403, response.text
    assert "Permissão negada" in response.json()["detail"]


def test_manager_is_not_restricted_by_waiter_print_toggle():
    response = client.post(
        "/mesas/99999/imprimir-recibo",
        headers=_headers(MANAGER_A, TENANT_A, "gerente"),
    )
    assert response.status_code != 403, response.text

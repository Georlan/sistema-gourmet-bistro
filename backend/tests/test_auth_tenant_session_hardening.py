import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, TenantSession, current_restaurante_id
from app.models import Restaurante, Usuario
from app.routes.auth import _lookup_users_before_tenant, _select_login_identity
from app.schemas import LoginRequest
from app.security import (
    _authenticated_user_from_token,
    create_access_token,
    get_password_hash,
)


@pytest.fixture()
def auth_db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(class_=TenantSession, bind=engine)
    db = Session(restaurante_id=None)
    db.merge(Restaurante(id=2, nome="Tenant Dois", plano="pocket"))
    shared_hash = get_password_hash("senha-compartilhada")
    db.add_all(
        [
            Usuario(
                id="user-tenant-1",
                restaurante_id=1,
                nome="Operador Um",
                email="operador@koma.test",
                senha_hash=shared_hash,
                cargo="caixa",
                status="ativo",
            ),
            Usuario(
                id="user-tenant-2",
                restaurante_id=2,
                nome="Operador Dois",
                email="operador@koma.test",
                senha_hash=shared_hash,
                cargo="caixa",
                status="ativo",
            ),
        ]
    )
    db.commit()
    try:
        yield db
    finally:
        db.close()
        engine.dispose()


def test_same_credentials_never_choose_an_arbitrary_tenant(auth_db):
    candidates = _lookup_users_before_tenant(
        auth_db,
        "operador@koma.test",
    )

    assert {row["restaurante_id"] for row in candidates} == {1, 2}
    with pytest.raises(HTTPException) as exc:
        _select_login_identity(candidates, "senha-compartilhada")

    assert exc.value.status_code == 409
    assert "mais de um restaurante" in exc.value.detail


def test_explicit_tenant_disambiguates_login_without_exposing_other_account(auth_db):
    candidates = _lookup_users_before_tenant(
        auth_db,
        "operador@koma.test",
        restaurante_id=2,
    )
    identity = _select_login_identity(candidates, "senha-compartilhada")

    assert len(candidates) == 1
    assert identity["id"] == "user-tenant-2"
    assert identity["restaurante_id"] == 2


def test_login_request_rejects_invalid_tenant_selector():
    with pytest.raises(ValueError):
        LoginRequest(
            username="operador@koma.test",
            password="senha-compartilhada",
            restaurante_id=0,
        )


def test_signed_token_cannot_move_a_user_to_another_tenant(auth_db):
    token = create_access_token(
        subject="user-tenant-1",
        restaurante_id=2,
    )
    context = current_restaurante_id.set(2)
    auth_db.restaurante_id = 2
    try:
        with pytest.raises(HTTPException) as exc:
            _authenticated_user_from_token(token, auth_db)
    finally:
        current_restaurante_id.reset(context)

    assert exc.value.status_code == 401


def test_existing_token_stops_working_as_soon_as_account_is_deactivated(auth_db):
    context = current_restaurante_id.set(1)
    auth_db.restaurante_id = 1
    try:
        user = auth_db.get(Usuario, "user-tenant-1")
        user.status = "inativo"
        auth_db.commit()
        token = create_access_token(subject=user.id, restaurante_id=1)

        with pytest.raises(HTTPException) as exc:
            _authenticated_user_from_token(token, auth_db)
    finally:
        current_restaurante_id.reset(context)

    assert exc.value.status_code == 403


from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from starlette.requests import Request

from app.database import Base, TenantSession
from app.models import Restaurante, Usuario
from app.routes.auth import login
from app.schemas import LoginRequest
from app.security import get_password_hash


def _request() -> Request:
    return Request({
        "type": "http",
        "method": "POST",
        "path": "/auth/login",
        "headers": [],
        "client": ("127.0.0.1", 43123),
    })


def _snapshot_users(db):
    return [tuple(row) for row in db.execute(text(
        "SELECT id, restaurante_id, cargo, status FROM usuarios ORDER BY restaurante_id, id"
    )).all()]


def test_multi_tenant_login_is_actionable_and_does_not_mutate_user_rows():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(class_=TenantSession, bind=engine)
    db = Session(restaurante_id=None)
    try:
        db.merge(Restaurante(id=2, nome="Pizzaria Dois", plano="pocket"))
        shared_hash = get_password_hash("senha-compartilhada")
        db.add_all([
            Usuario(
                id="legacy-tenant-1",
                restaurante_id=1,
                nome="Operador Um",
                email="duplicado@koma.test",
                senha_hash=shared_hash,
                cargo="garcom",
                role="garcom",
                status="ativo",
            ),
            Usuario(
                id="legacy-tenant-2",
                restaurante_id=2,
                nome="Operador Dois",
                email="duplicado@koma.test",
                senha_hash=shared_hash,
                cargo="caixa",
                status="ativo",
            ),
        ])
        db.commit()
        before = _snapshot_users(db)

        try:
            login(
                LoginRequest(username="duplicado@koma.test", password="senha-compartilhada"),
                _request(),
                db,
            )
        except HTTPException as exc:
            assert exc.status_code == 409
            assert exc.detail["code"] == "restaurant_selection_required"
            assert exc.detail["restaurante_ids"] == [1, 2]
            assert exc.detail["restaurantes"] == [
                {"id": 1, "nome": "Kôma Bistrô"},
                {"id": 2, "nome": "Pizzaria Dois"},
            ]
        else:
            raise AssertionError("login ambíguo deveria exigir seleção de restaurante")

        assert _snapshot_users(db) == before

        response = login(
            LoginRequest(
                username="duplicado@koma.test",
                password="senha-compartilhada",
                restaurante_id=2,
            ),
            _request(),
            db,
        )
        assert response["usuario"]["id"] == "legacy-tenant-2"
        assert response["usuario"]["role"] == "caixa"
        assert response["usuario"]["cargo"] == "caixa"
        assert _snapshot_users(db) == before
    finally:
        db.close()
        engine.dispose()

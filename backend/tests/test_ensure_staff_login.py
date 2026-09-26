import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Restaurante, Usuario
from app.security import get_password_hash, verify_password
from tools.ensure_staff_login import (
    _read_password,
    apply_staff_login,
    build_plan,
)


def _engine(monkeypatch):
    monkeypatch.setenv("MIGRATION_DATABASE_URL", "sqlite:///:memory:")
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    with Session.begin() as db:
        db.add(
            Restaurante(
                id=1,
                nome="KÔMA Base",
                slug="base",
                billing_mode="legacy",
                saas_status="active",
            )
        )
    return engine


def test_ensure_staff_login_creates_active_cashier(monkeypatch):
    engine = _engine(monkeypatch)
    try:
        result = apply_staff_login(
            engine,
            expected_database=":memory:",
            tenant_id=1,
            email="CAIXA@GMAIL.COM",
            role="caixa",
            name="Caixa Teste",
            password="12345678",
        )

        assert result["validation"] == "passed"
        assert result["action"] == "created"
        assert result["password_verified"] is True

        Session = sessionmaker(bind=engine)
        with Session() as db:
            user = (
                db.query(Usuario)
                .filter_by(restaurante_id=1, email="caixa@gmail.com")
                .one()
            )
            assert user.nome == "Caixa Teste"
            assert user.cargo == "caixa"
            assert user.status == "ativo"
            assert verify_password("12345678", user.senha_hash)
    finally:
        engine.dispose()


def test_ensure_staff_login_updates_existing_identity_idempotently(monkeypatch):
    engine = _engine(monkeypatch)
    try:
        Session = sessionmaker(bind=engine)
        with Session.begin() as db:
            existing = Usuario(
                id="existing-caixa",
                restaurante_id=1,
                nome="Caixa Antigo",
                email="caixa@gmail.com",
                cargo="garcom",
                status="inativo",
                senha_hash=get_password_hash("senha-antiga"),
            )
            db.add(existing)

        result = apply_staff_login(
            engine,
            expected_database=":memory:",
            tenant_id=1,
            email="caixa@gmail.com",
            role="caixa",
            name="Caixa Teste",
            password="12345678",
        )

        assert result["action"] == "updated"
        assert result["user_id"] == "existing-caixa"

        with Session() as db:
            users = (
                db.query(Usuario)
                .filter_by(restaurante_id=1, email="caixa@gmail.com")
                .all()
            )
            assert len(users) == 1
            user = users[0]
            assert user.id == "existing-caixa"
            assert user.cargo == "caixa"
            assert user.status == "ativo"
            assert verify_password("12345678", user.senha_hash)
            assert not verify_password("senha-antiga", user.senha_hash)
    finally:
        engine.dispose()


def test_ensure_staff_login_dry_run_does_not_create_user(monkeypatch):
    engine = _engine(monkeypatch)
    try:
        plan = build_plan(
            engine,
            tenant_id=1,
            email="caixa@gmail.com",
            role="caixa",
            name="Caixa Teste",
        )
        assert plan["mode"] == "dry-run"
        assert plan["restaurant_exists"] is True
        assert plan["user_exists"] is False

        Session = sessionmaker(bind=engine)
        with Session() as db:
            assert db.query(Usuario).filter_by(restaurante_id=1).count() == 0
    finally:
        engine.dispose()


def test_staff_login_password_reader_accepts_eight_bytes(monkeypatch):
    monkeypatch.setenv("KOMA_STAFF_LOGIN_PASSWORD", "12345678")
    assert _read_password("KOMA_STAFF_LOGIN_PASSWORD") == "12345678"


def test_ensure_staff_login_refuses_missing_tenant(monkeypatch):
    engine = _engine(monkeypatch)
    try:
        try:
            apply_staff_login(
                engine,
                expected_database=":memory:",
                tenant_id=999,
                email="caixa@gmail.com",
                role="caixa",
                name="Caixa Teste",
                password="12345678",
            )
        except RuntimeError as exc:
            assert "restaurante id=999 não existe" in str(exc)
        else:
            raise AssertionError("deveria recusar tenant inexistente")
    finally:
        engine.dispose()

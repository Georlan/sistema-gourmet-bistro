import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Restaurante, Usuario
from app.security import verify_password
from tools.provision_demo_restaurant import DEMO_RESTAURANT_ID, DEMO_USERS, _imports, apply_demo
from tools.set_demo_passwords import _passwords, apply_passwords, build_plan


def _engine():
    _imports()
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    with Session.begin() as db:
        base = db.query(Restaurante).filter_by(id=1).one_or_none()
        if base is None:
            db.add(Restaurante(id=1, nome="KÔMA Base", slug="base", billing_mode="legacy"))
        else:
            base.nome = "KÔMA Base"
            base.slug = "base"
            base.billing_mode = "legacy"
    initial = {
        str(spec["password_env"]): f"Demo-{index}-Senha-Segura!"
        for index, spec in enumerate(DEMO_USERS, start=1)
    }
    apply_demo(engine, expected_database=":memory:", passwords=initial)
    return engine


def _eight_char_passwords():
    return {str(spec["password_env"]): "12345678" for spec in DEMO_USERS}


def test_demo_password_rotation_accepts_eight_bytes_and_updates_only_demo_users():
    engine = _engine()
    try:
        result = apply_passwords(engine, expected_database=":memory:", passwords=_eight_char_passwords())
        assert result["validation"] == "passed"
        assert result["restaurant_id"] == DEMO_RESTAURANT_ID

        Session = sessionmaker(bind=engine)
        with Session() as db:
            users = db.query(Usuario).filter_by(restaurante_id=DEMO_RESTAURANT_ID).all()
            assert len(users) == 3
            assert all(verify_password("12345678", user.senha_hash) for user in users)
            assert db.query(Restaurante).filter_by(id=1).one().nome == "KÔMA Base"
    finally:
        engine.dispose()


def test_demo_password_rotation_dry_run_does_not_mutate_hashes():
    engine = _engine()
    try:
        Session = sessionmaker(bind=engine)
        with Session() as db:
            before = {user.id: user.senha_hash for user in db.query(Usuario).filter_by(restaurante_id=2).all()}

        plan = build_plan(engine)
        assert plan["mode"] == "dry-run"
        assert len(plan["found_user_ids"]) == 3

        with Session() as db:
            after = {user.id: user.senha_hash for user in db.query(Usuario).filter_by(restaurante_id=2).all()}
        assert after == before
    finally:
        engine.dispose()


def test_environment_password_reader_accepts_exactly_eight_bytes(monkeypatch):
    for spec in DEMO_USERS:
        monkeypatch.setenv(str(spec["password_env"]), "12345678")
    values = _passwords()
    assert set(values) == {str(spec["password_env"]) for spec in DEMO_USERS}
    assert set(values.values()) == {"12345678"}


def test_demo_password_rotation_refuses_identity_mismatch():
    engine = _engine()
    try:
        Session = sessionmaker(bind=engine)
        with Session.begin() as db:
            user = db.query(Usuario).filter_by(id="demo-caixa-2").one()
            user.email = "outro@exemplo.test"

        try:
            apply_passwords(engine, expected_database=":memory:", passwords=_eight_char_passwords())
        except RuntimeError as exc:
            assert "identidade divergente" in str(exc)
        else:
            raise AssertionError("rotação deveria falhar com identidade divergente")
    finally:
        engine.dispose()

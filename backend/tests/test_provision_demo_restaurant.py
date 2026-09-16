from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Categoria, Mesa, Produto, Restaurante, Usuario
from app.security import verify_password
from tools.provision_demo_restaurant import (
    DEMO_RESTAURANT_ID,
    DEMO_SLUG,
    DEMO_USERS,
    _imports,
    apply_demo,
    build_plan,
)


def _engine():
    # Carrega todos os modelos usados pelo provisionador antes do create_all.
    _imports()
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    with Session.begin() as db:
        # O metadata global do runtime já semeia o tenant 1 após create_all.
        base = db.query(Restaurante).filter_by(id=1).one_or_none()
        if base is None:
            base = Restaurante(id=1, nome="KÔMA Base", slug="base", billing_mode="legacy")
            db.add(base)
        else:
            base.nome = "KÔMA Base"
            base.slug = "base"
            base.billing_mode = "legacy"
    return engine


def _passwords():
    return {
        str(spec["password_env"]): f"Demo-{index}-Senha-Segura!"
        for index, spec in enumerate(DEMO_USERS, start=1)
    }


def test_demo_dry_run_is_non_mutating():
    engine = _engine()
    try:
        plan = build_plan(engine)
        assert plan["mode"] == "dry-run"
        assert plan["existing_restaurant_ids"] == [1]
        assert plan["demo_restaurant"]["id"] == DEMO_RESTAURANT_ID
        assert plan["demo_restaurant"]["slug"] == DEMO_SLUG

        Session = sessionmaker(bind=engine)
        with Session() as db:
            assert db.query(Restaurante).filter_by(id=DEMO_RESTAURANT_ID).count() == 0
    finally:
        engine.dispose()


def test_demo_apply_creates_minimum_operational_fixture_and_is_idempotent():
    engine = _engine()
    passwords = _passwords()
    try:
        first = apply_demo(engine, expected_database=":memory:", passwords=passwords)
        second = apply_demo(engine, expected_database=":memory:", passwords=passwords)
        assert first["validation"] == "passed"
        assert second["validation"] == "passed"

        Session = sessionmaker(bind=engine)
        with Session() as db:
            demo = db.query(Restaurante).filter_by(id=DEMO_RESTAURANT_ID).one()
            assert demo.nome == "KÔMA Demo"
            assert demo.slug == DEMO_SLUG
            assert demo.status_override == "Forçado Aberto"
            assert demo.billing_mode == "legacy"

            users = db.query(Usuario).filter_by(restaurante_id=DEMO_RESTAURANT_ID).all()
            assert len(users) == 3
            assert {user.cargo for user in users} == {"admin", "caixa", "garcom"}
            for user in users:
                spec = next(item for item in DEMO_USERS if item["id"] == user.id)
                password = passwords[str(spec["password_env"])]
                assert user.senha_hash != password
                assert verify_password(password, user.senha_hash)

            assert db.query(Mesa).filter_by(restaurante_id=DEMO_RESTAURANT_ID).count() == 6
            assert db.query(Categoria).filter_by(restaurante_id=DEMO_RESTAURANT_ID).count() == 4
            assert db.query(Produto).filter_by(restaurante_id=DEMO_RESTAURANT_ID).count() == 11
            assert db.query(Categoria).filter_by(
                restaurante_id=DEMO_RESTAURANT_ID,
                destino_impressao="BAR",
            ).count() == 1

            # O tenant principal não é alterado pelo provisionamento da demo.
            base = db.query(Restaurante).filter_by(id=1).one()
            assert base.nome == "KÔMA Base"
    finally:
        engine.dispose()


def test_demo_apply_refuses_unexpected_third_tenant():
    engine = _engine()
    try:
        Session = sessionmaker(bind=engine)
        with Session.begin() as db:
            db.add(Restaurante(id=3, nome="Tenant inesperado", slug="nao-demo", billing_mode="legacy"))

        try:
            apply_demo(engine, expected_database=":memory:", passwords=_passwords())
        except RuntimeError as exc:
            assert "tenants inesperados" in str(exc)
        else:
            raise AssertionError("provisionamento deveria falhar fechado com tenant inesperado")
    finally:
        engine.dispose()

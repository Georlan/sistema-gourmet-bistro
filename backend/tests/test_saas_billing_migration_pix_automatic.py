from __future__ import annotations

import importlib.util
from pathlib import Path
import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.contract_models import ContractAcceptance
from app.database import Base
from app.models import Restaurante
from app.saas_billing_models import SaaSBillingSetup, SaaSSubscription

MIGRATION_FILE = (
    Path(__file__).resolve().parents[1]
    / "alembic/versions/ce3f5a7b9d12_allow_pix_automatic_payment_method.py"
)


def _load_migration_module():
    spec = importlib.util.spec_from_file_location("migration_ce3f5a7b9d12", str(MIGRATION_FILE))
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    # Enable foreign keys and check constraints in SQLite
    with engine.connect() as conn:
        conn.exec_driver_sql("PRAGMA foreign_keys = ON")

    Restaurante.__table__.create(engine)
    ContractAcceptance.__table__.create(engine)
    SaaSBillingSetup.__table__.create(engine)
    SaaSSubscription.__table__.create(engine)

    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = Session()
    try:
        yield session
    finally:
        session.close()


def test_saas_billing_setup_accepts_pix_automatic(db_session):
    setup = SaaSBillingSetup(
        protocol="koma_setup_pix_auto_1",
        payment_method_type="pix_automatic",
        provider="mercado_pago",
        status="pending",
    )
    db_session.add(setup)
    db_session.commit()
    assert setup.id is not None
    assert setup.payment_method_type == "pix_automatic"


def test_saas_billing_setup_accepts_credit_card_and_legacy_pix(db_session):
    setup_card = SaaSBillingSetup(
        protocol="koma_setup_card_1",
        payment_method_type="credit_card",
        provider="mercado_pago",
        status="pending",
    )
    setup_pix = SaaSBillingSetup(
        protocol="koma_setup_pix_legacy_1",
        payment_method_type="pix",
        provider="mercado_pago",
        status="pending",
    )
    db_session.add_all([setup_card, setup_pix])
    db_session.commit()
    assert setup_card.id is not None
    assert setup_pix.id is not None


def test_saas_billing_setup_rejects_invalid_payment_method(db_session):
    setup_invalid = SaaSBillingSetup(
        protocol="koma_setup_invalid_1",
        payment_method_type="boleto",
        provider="mercado_pago",
        status="pending",
    )
    db_session.add(setup_invalid)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_saas_subscription_accepts_pix_automatic(db_session):
    restaurante = Restaurante(
        nome="Bistrô Teste Assinatura",
    )
    db_session.add(restaurante)
    db_session.commit()

    sub = SaaSSubscription(
        restaurante_id=restaurante.id,
        provider="mercado_pago",
        payment_method_type="pix_automatic",
        billing_cycle="monthly",
        status="trialing",
    )
    db_session.add(sub)
    db_session.commit()
    assert sub.id is not None
    assert sub.payment_method_type == "pix_automatic"


def test_saas_subscription_accepts_none_and_card(db_session):
    rest1 = Restaurante(nome="Rest 1")
    rest2 = Restaurante(nome="Rest 2")
    db_session.add_all([rest1, rest2])
    db_session.commit()

    sub_none = SaaSSubscription(
        restaurante_id=rest1.id,
        payment_method_type=None,
        billing_cycle="monthly",
        status="trialing",
    )
    sub_card = SaaSSubscription(
        restaurante_id=rest2.id,
        payment_method_type="credit_card",
        billing_cycle="annual",
        status="active",
    )
    db_session.add_all([sub_none, sub_card])
    db_session.commit()
    assert sub_none.payment_method_type is None
    assert sub_card.payment_method_type == "credit_card"


def test_saas_subscription_rejects_invalid_payment_method(db_session):
    restaurante = Restaurante(
        nome="Bistrô Teste Inválido",
    )
    db_session.add(restaurante)
    db_session.commit()

    sub = SaaSSubscription(
        restaurante_id=restaurante.id,
        payment_method_type="crypto",
        billing_cycle="monthly",
        status="trialing",
    )
    db_session.add(sub)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_migration_metadata_and_revisions():
    mod = _load_migration_module()
    assert mod.revision == "ce3f5a7b9d12"
    assert mod.down_revision == "bd24e5f60718"
    assert "pix_automatic" in mod.NEW_SETUPS_SQL
    assert "pix_automatic" in mod.NEW_SUBS_SQL
    assert "pix_automatic" not in mod.OLD_SETUPS_SQL
    assert "pix_automatic" not in mod.OLD_SUBS_SQL


def test_migration_downgrade_guard_protects_pix_automatic_data(monkeypatch):
    mod = _load_migration_module()

    class MockBind:
        def __init__(self, count: int):
            self._count = count
            self.dialect = type("Dialect", (), {"name": "postgresql"})()

        def execute(self, statement):
            class Result:
                def __init__(self, val):
                    self._val = val

                def scalar(self):
                    return self._val

            return Result(self._count)

    class MockOp:
        @staticmethod
        def get_bind():
            return MockBind(count=2)

    monkeypatch.setattr(mod, "op", MockOp)

    with pytest.raises(RuntimeError) as exc_info:
        mod.downgrade()
    assert "Downgrade abortado" in str(exc_info.value)
    assert "pix_automatic" in str(exc_info.value)

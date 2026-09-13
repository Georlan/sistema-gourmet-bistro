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
    / "alembic/versions/df4a6b8c0e23_allow_account_money_payment_method.py"
)


def _load_migration_module():
    spec = importlib.util.spec_from_file_location("migration_df4a6b8c0e23", str(MIGRATION_FILE))
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


def test_saas_billing_setup_accepts_account_money(db_session):
    setup = SaaSBillingSetup(
        protocol="koma_setup_acc_money_1",
        payment_method_type="account_money",
        provider="mercado_pago",
        status="pending",
    )
    db_session.add(setup)
    db_session.commit()
    assert setup.id is not None
    assert setup.payment_method_type == "account_money"


def test_saas_billing_setup_accepts_all_allowed_methods(db_session):
    setup_card = SaaSBillingSetup(
        protocol="koma_setup_card_1",
        payment_method_type="credit_card",
        provider="mercado_pago",
        status="pending",
    )
    setup_pix_auto = SaaSBillingSetup(
        protocol="koma_setup_pix_auto_1",
        payment_method_type="pix_automatic",
        provider="mercado_pago",
        status="pending",
    )
    setup_acc = SaaSBillingSetup(
        protocol="koma_setup_acc_1",
        payment_method_type="account_money",
        provider="mercado_pago",
        status="pending",
    )
    db_session.add_all([setup_card, setup_pix_auto, setup_acc])
    db_session.commit()
    assert setup_card.id is not None
    assert setup_pix_auto.id is not None
    assert setup_acc.id is not None


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


def test_saas_subscription_accepts_account_money(db_session):
    restaurante = Restaurante(
        nome="Bistrô Teste Assinatura Saldo MP",
    )
    db_session.add(restaurante)
    db_session.commit()

    sub = SaaSSubscription(
        restaurante_id=restaurante.id,
        provider="mercado_pago",
        payment_method_type="account_money",
        billing_cycle="monthly",
        status="trialing",
    )
    db_session.add(sub)
    db_session.commit()
    assert sub.id is not None
    assert sub.payment_method_type == "account_money"


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
    assert mod.revision == "df4a6b8c0e23"
    assert mod.down_revision == "ce3f5a7b9d12"
    assert "account_money" in mod.NEW_SETUPS_SQL
    assert "account_money" in mod.NEW_SUBS_SQL
    assert "account_money" not in mod.OLD_SETUPS_SQL
    assert "account_money" not in mod.OLD_SUBS_SQL


def test_migration_downgrade_guard_protects_account_money_data(monkeypatch):
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
    assert "account_money" in str(exc_info.value)

from __future__ import annotations

import datetime
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, current_restaurante_id, get_db
from app.main import app
from app.models import (
    CaixaTurno,
    Categoria,
    Comanda,
    ConfiguracaoRestaurante,
    Pagamento,
    Produto,
    Restaurante,
    Usuario,
)
from app.routes import onboarding
from app.saas_billing_models import SaaSSubscription
from app.security import get_current_user, get_password_hash
from app.services.onboarding_readiness import evaluate_operational_readiness

RID = 99021
USER_ID = "onboarding-admin"


@pytest.fixture()
def onboarding_setup(monkeypatch):
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    token = current_restaurante_id.set(RID)
    try:
        with Session() as db:
            db.add(Restaurante(
                id=RID,
                nome="Onboarding Teste",
                slug="onboarding-teste",
                plano="pro",
                endereco="Rua Teste, 100",
                socials={"whatsapp": "85999999999"},
                horarios_funcionamento=[{"days": "seg-sex", "hours": "10:00-22:00"}],
            ))
            db.add(Usuario(
                id=USER_ID,
                restaurante_id=RID,
                nome="Dona Teste",
                email="dona-onboarding@example.test",
                telefone="85999999999",
                cargo="admin",
                status="ativo",
                senha_hash=get_password_hash("senha-onboarding"),
            ))
            db.add(ConfiguracaoRestaurante(
                restaurante_id=RID,
                mapa_mesas_ativo=False,
                delivery_ativo=False,
                taxa_servico_ativa=False,
                operation_capabilities={
                    "order_modes": ["pickup"],
                    "online_menu": False,
                    "service_tax": False,
                },
            ))
            db.add(Categoria(id="cat-onboarding", restaurante_id=RID, nome="Principal"))
            db.add(Produto(
                id="prod-onboarding",
                restaurante_id=RID,
                categoria_id="cat-onboarding",
                nome="Produto publicado",
                preco=10,
                ativo=True,
            ))
            db.add(SaaSSubscription(
                restaurante_id=RID,
                provider="mercado_pago",
                status="onboarding",
                billing_cycle="monthly",
                payment_method_type="pix",
            ))
            db.commit()

        def override_db():
            tenant_token = current_restaurante_id.set(RID)
            db = Session()
            try:
                yield db
            finally:
                db.close()
                current_restaurante_id.reset(tenant_token)

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(
            id=USER_ID,
            restaurante_id=RID,
            cargo="admin",
            role="admin",
        )
        yield TestClient(app), Session
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)
        current_restaurante_id.reset(token)
        engine.dispose()


def test_status_is_read_only_and_does_not_start_trial(onboarding_setup):
    client, Session = onboarding_setup

    response = client.get("/api/onboarding/status")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["configuration"]["complete"] is True
    assert body["operation"]["started"] is False
    assert body["readiness"]["ready"] is False
    assert body["trial"]["status"] == "setup"
    with Session() as db:
        subscription = db.query(SaaSSubscription).filter_by(restaurante_id=RID).one()
        assert subscription.trial_started_at is None
        assert db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=RID).one().operation_started_at is None


def test_inactive_product_does_not_complete_catalog(onboarding_setup):
    _client, Session = onboarding_setup
    with Session() as db:
        db.query(Produto).filter_by(restaurante_id=RID).update({"ativo": False})
        db.commit()
        restaurant = db.query(Restaurante).filter_by(id=RID).one()
        config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=RID).one()
        result = evaluate_operational_readiness(db, tenant_id=RID, restaurant=restaurant, config=config)

    assert result["configuration"]["complete"] is False
    catalog = next(check for check in result["configuration"]["checks"] if check["id"] == "catalog")
    assert catalog["ok"] is False


def test_selected_capabilities_add_only_relevant_blockers(onboarding_setup):
    _client, Session = onboarding_setup
    with Session() as db:
        config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=RID).one()
        config.operation_capabilities = {
            "order_modes": ["dine_in", "pickup", "delivery"],
            "online_menu": True,
            "service_tax": True,
        }
        config.delivery_ativo = True
        config.taxa_servico_ativa = True
        config.taxa_servico_padrao = 10
        db.commit()
        restaurant = db.query(Restaurante).filter_by(id=RID).one()
        result = evaluate_operational_readiness(db, tenant_id=RID, restaurant=restaurant, config=config)

    by_id = {check["id"]: check for check in result["configuration"]["checks"]}
    assert by_id["dine_in"]["ok"] is False
    assert by_id["delivery"]["ok"] is True
    assert by_id["online_menu"]["ok"] is False
    assert by_id["service_tax"]["ok"] is True
    assert result["configuration"]["complete"] is False


def test_explicit_start_is_the_only_operation_start_trigger(onboarding_setup, monkeypatch):
    client, Session = onboarding_setup
    calls = []

    def fake_start(db, *, restaurante_id, actor):
        calls.append((restaurante_id, actor))
        subscription = db.query(SaaSSubscription).filter_by(restaurante_id=restaurante_id).one()
        subscription.status = "trialing"
        subscription.trial_started_at = datetime.datetime.now(datetime.timezone.utc)
        subscription.trial_ends_at = subscription.trial_started_at + datetime.timedelta(days=7)
        return {"status": "trialing"}

    monkeypatch.setattr(onboarding, "ensure_trial_started_after_onboarding", fake_start)

    response = client.post("/api/onboarding/start-operation")

    assert response.status_code == 200, response.text
    assert calls == [(RID, f"usuario:{USER_ID}")]
    assert response.json()["operation"]["started"] is True
    with Session() as db:
        config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=RID).one()
        assert config.operation_started_at is not None
        subscription = db.query(SaaSSubscription).filter_by(restaurante_id=RID).one()
        assert subscription.trial_started_at is not None


def test_ready_requires_paid_closed_test_order_in_selected_mode(onboarding_setup):
    _client, Session = onboarding_setup
    with Session() as db:
        config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=RID).one()
        config.operation_started_at = datetime.datetime.now(datetime.timezone.utc)
        shift = CaixaTurno(
            restaurante_id=RID,
            aberto_por_id=USER_ID,
            saldo_inicial=0,
            status="fechado",
        )
        db.add(shift)
        db.flush()
        order = Comanda(
            id="cmd-onboarding-proof",
            restaurante_id=RID,
            garcom_id=USER_ID,
            tipo="Retirada",
            numero_pedido=1,
            fechada=True,
            fechado_em=datetime.datetime.now(datetime.timezone.utc),
        )
        db.add(order)
        db.flush()
        db.add(Pagamento(
            id="pay-onboarding-proof",
            restaurante_id=RID,
            comanda_id=order.id,
            turno_id=shift.id,
            valor=10,
            metodo="dinheiro",
            status="aprovado",
            idempotency_key="onboarding-proof-payment",
        ))
        db.commit()

        restaurant = db.query(Restaurante).filter_by(id=RID).one()
        config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=RID).one()
        result = evaluate_operational_readiness(db, tenant_id=RID, restaurant=restaurant, config=config)

    assert result["readiness"]["testOrderComplete"] is True
    assert result["readiness"]["ready"] is True


def test_capability_update_syncs_existing_runtime_switches(onboarding_setup):
    client, Session = onboarding_setup

    response = client.put(
        "/api/onboarding/capabilities",
        json={
            "order_modes": ["dine_in", "delivery"],
            "online_menu": False,
            "service_tax": True,
        },
    )

    assert response.status_code == 200, response.text
    with Session() as db:
        config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=RID).one()
        assert config.mapa_mesas_ativo is True
        assert config.delivery_ativo is True
        assert config.taxa_servico_ativa is True
        assert config.modo_exclusivo_salao is False
        assert config.operation_capabilities["order_modes"] == ["dine_in", "delivery"]

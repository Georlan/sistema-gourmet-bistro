from __future__ import annotations

import datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, current_restaurante_id
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
from app.routes import onboarding as onboarding_route
from app.routes.onboarding import (
    _operation_readiness,
    _profile_is_configured,
    _required_progress,
    _trial_status_payload,
)
from app.routes.super_admin_onboarding import restaurant_trials
from app.saas_billing_models import SaaSSubscription


def test_onboarding_routes_are_registered_once():
    openapi_paths = app.openapi().get("paths", {})
    assert "/api/onboarding/status" in openapi_paths
    assert "get" in openapi_paths["/api/onboarding/status"]
    assert "/api/onboarding/start-trial" in openapi_paths
    assert "post" in openapi_paths["/api/onboarding/start-trial"]

    with TestClient(app) as client:
        response = client.get("/api/onboarding/status")
        assert response.status_code == 401
        response = client.post("/api/onboarding/start-trial")
        assert response.status_code == 401


def test_trial_projection_reports_real_remaining_days_without_mutation():
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = _trial_status_payload(
        {
            "trial_started_at": now - datetime.timedelta(hours=1),
            "trial_ends_at": now + datetime.timedelta(days=1, hours=2),
            "trial_status": "active",
        }
    )

    assert payload["status"] == "active"
    assert payload["daysRemaining"] == 2
    assert payload["startsAt"]
    assert payload["endsAt"]


def test_expired_active_trial_is_projected_as_expired():
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = _trial_status_payload(
        {
            "trial_started_at": now - datetime.timedelta(days=8),
            "trial_ends_at": now - datetime.timedelta(seconds=1),
            "trial_status": "active",
        }
    )

    assert payload["status"] == "expired"
    assert payload["daysRemaining"] == 0


def test_profile_progress_requires_real_profile_content():
    empty = SimpleNamespace(
        endereco=None,
        subtitulo="",
        sobre_nos=None,
        logo_url=None,
        banner_url=None,
    )
    configured = SimpleNamespace(
        endereco="Rua de teste, 100",
        subtitulo="",
        sobre_nos=None,
        logo_url=None,
        banner_url=None,
    )

    assert _profile_is_configured(empty) is False
    assert _profile_is_configured(configured) is True


def test_required_progress_has_four_configuration_items_only():
    steps = {
        "profile": True,
        "hours": True,
        "catalog": True,
        "operations": True,
        "mercadoPago": False,
        "firstOrder": False,
    }

    assert _required_progress(steps) == {
        "completed": 4,
        "total": 4,
        "percent": 100,
    }


def test_required_progress_does_not_let_validation_or_optional_payment_mask_setup():
    steps = {
        "profile": False,
        "hours": True,
        "catalog": False,
        "operations": True,
        "mercadoPago": True,
        "firstOrder": True,
    }

    assert _required_progress(steps) == {
        "completed": 2,
        "total": 4,
        "percent": 50,
    }


def _operation_config(**overrides):
    values = {
        "tipos_pedido_ativos": ["retirada"],
        "mapa_mesas_ativo": False,
        "delivery_ativo": False,
        "tipo_taxa_entrega": "fixa",
        "taxa_entrega_fixa": 7.0,
        "tabela_taxas_bairros": [],
        "tabela_taxas_km": [],
        "taxa_servico_ativa": False,
        "taxa_servico_padrao": 10.0,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _restaurant(**overrides):
    values = {
        "pagamento_online_ativo": False,
        "latitude": None,
        "longitude": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_dine_in_with_table_map_requires_at_least_one_table():
    config = _operation_config(
        tipos_pedido_ativos=["consumo_local", "retirada"],
        mapa_mesas_ativo=True,
    )

    blocked = _operation_readiness(
        config=config,
        restaurant=_restaurant(),
        table_count=0,
        mercado_pago_connected=False,
    )
    assert blocked["ready"] is False
    assert "dine_in_tables" in blocked["blockers"]

    ready = _operation_readiness(
        config=config,
        restaurant=_restaurant(),
        table_count=1,
        mercado_pago_connected=False,
    )
    assert ready["ready"] is True


def test_delivery_and_service_charge_use_existing_configuration_as_capabilities():
    payload = _operation_readiness(
        config=_operation_config(
            tipos_pedido_ativos=["delivery"],
            delivery_ativo=True,
            tipo_taxa_entrega="fixa",
            taxa_entrega_fixa=6.0,
            taxa_servico_ativa=True,
            taxa_servico_padrao=10.0,
        ),
        restaurant=_restaurant(),
        table_count=0,
        mercado_pago_connected=False,
    )

    assert payload["ready"] is True
    assert payload["capabilities"]["delivery"] == {"enabled": True, "ready": True}
    assert payload["capabilities"]["serviceCharge"] == {"enabled": True, "ready": True}


def test_mercado_pago_is_optional_and_connection_enables_online_payment_capability():
    config = _operation_config(tipos_pedido_ativos=["retirada"])

    offline = _operation_readiness(
        config=config,
        restaurant=_restaurant(),
        table_count=0,
        mercado_pago_connected=False,
    )
    assert offline["ready"] is True
    assert offline["capabilities"]["onlinePayment"] == {"enabled": False, "ready": True}

    connected = _operation_readiness(
        config=config,
        restaurant=_restaurant(),
        table_count=0,
        mercado_pago_connected=True,
    )
    assert connected["ready"] is True
    assert connected["capabilities"]["onlinePayment"] == {"enabled": True, "ready": True}



@pytest.fixture()
def onboarding_db():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    tenant_id = 91001
    token = current_restaurante_id.set(tenant_id)
    db = Session()
    try:
        restaurant = Restaurante(
            id=tenant_id,
            nome="Readiness Bistro",
            slug="readiness-bistro",
            plano="pro",
            endereco="Rua do Teste, 100",
            horarios_funcionamento=[{"days": "seg-sex", "hours": "11:00-22:00"}],
        )
        user = Usuario(
            id="admin-readiness",
            restaurante_id=tenant_id,
            nome="Admin Readiness",
            email="admin-readiness@example.test",
            cargo="admin",
            status="ativo",
            senha_hash="test-only",
        )
        config = ConfiguracaoRestaurante(
            restaurante_id=tenant_id,
            tipos_pedido_ativos=["retirada"],
            mapa_mesas_ativo=False,
            delivery_ativo=False,
            taxa_servico_ativa=False,
            taxa_servico_padrao=10,
        )
        category = Categoria(
            id="cat-readiness",
            restaurante_id=tenant_id,
            nome="Teste",
            destino_impressao="COZINHA",
        )
        product = Produto(
            id="prod-readiness",
            restaurante_id=tenant_id,
            nome="Produto publicado",
            categoria_id="cat-readiness",
            preco=10,
            ativo=True,
        )
        subscription = SaaSSubscription(
            restaurante_id=tenant_id,
            provider="mercado_pago",
            provider_subscription_id="sub-readiness",
            payment_method_type="credit_card",
            billing_cycle="monthly",
            status="onboarding",
        )
        db.add_all([restaurant, user, config, category, product, subscription])
        db.commit()
        yield db, user, tenant_id
    finally:
        db.close()
        current_restaurante_id.reset(token)
        engine.dispose()


def test_status_get_is_side_effect_free_after_configuration(onboarding_db, monkeypatch):
    db, user, tenant_id = onboarding_db

    def forbidden_start(*_args, **_kwargs):
        raise AssertionError("GET de status não pode iniciar trial")

    monkeypatch.setattr(
        onboarding_route,
        "ensure_trial_started_after_onboarding",
        forbidden_start,
    )

    payload = onboarding_route.get_onboarding_status(db=db, current_user=user)

    assert payload["readiness"]["configurationComplete"] is True
    assert payload["readiness"]["readyToOperate"] is False
    assert payload["trial"]["status"] == "setup"
    assert payload["trialCanStart"] is True
    subscription = (
        db.query(SaaSSubscription)
        .filter(SaaSSubscription.restaurante_id == tenant_id)
        .one()
    )
    assert subscription.trial_started_at is None
    assert subscription.status == "onboarding"


def test_explicit_trial_start_rejects_incomplete_configuration(onboarding_db, monkeypatch):
    db, user, tenant_id = onboarding_db
    db.query(Produto).filter(
        Produto.restaurante_id == tenant_id,
        Produto.id == "prod-readiness",
    ).update({"ativo": False})
    db.commit()
    called = False

    def unexpected_start(*_args, **_kwargs):
        nonlocal called
        called = True
        raise AssertionError("trial não deve iniciar com configuração incompleta")

    monkeypatch.setattr(
        onboarding_route,
        "ensure_trial_started_after_onboarding",
        unexpected_start,
    )

    with pytest.raises(HTTPException) as exc:
        onboarding_route.start_trial_after_readiness(db=db, current_user=user)

    assert exc.value.status_code == 409
    assert called is False


def test_explicit_trial_start_uses_single_mutation_after_configuration(onboarding_db, monkeypatch):
    db, user, tenant_id = onboarding_db
    calls = []
    now = datetime.datetime.now(datetime.timezone.utc)

    def fake_start(session, *, restaurante_id, actor):
        calls.append((restaurante_id, actor))
        subscription = (
            session.query(SaaSSubscription)
            .filter(SaaSSubscription.restaurante_id == restaurante_id)
            .one()
        )
        subscription.status = "trialing"
        subscription.trial_started_at = now
        subscription.trial_ends_at = now + datetime.timedelta(days=7)
        subscription.current_period_start = now
        subscription.current_period_end = subscription.trial_ends_at
        session.execute(
            restaurant_trials.insert().values(
                restaurante_id=restaurante_id,
                trial_started_at=now,
                trial_ends_at=subscription.trial_ends_at,
                trial_status="active",
                created_at=now,
                updated_at=now,
            )
        )
        session.commit()
        return {
            "status": "trialing",
            "trial_started_at": now,
            "trial_ends_at": subscription.trial_ends_at,
        }

    monkeypatch.setattr(
        onboarding_route,
        "ensure_trial_started_after_onboarding",
        fake_start,
    )

    payload = onboarding_route.start_trial_after_readiness(db=db, current_user=user)

    assert calls == [(tenant_id, f"usuario:{user.id}")]
    assert payload["trial"]["status"] == "active"
    assert payload["trialCanStart"] is False


def test_ready_to_operate_requires_closed_order_with_approved_payment(onboarding_db):
    db, user, tenant_id = onboarding_db

    before = onboarding_route.get_onboarding_status(db=db, current_user=user)
    assert before["readiness"]["configurationComplete"] is True
    assert before["steps"]["firstOrder"] is False
    assert before["readiness"]["readyToOperate"] is False

    shift = CaixaTurno(
        restaurante_id=tenant_id,
        aberto_por_id=user.id,
        saldo_inicial=0,
        status="aberto",
    )
    db.add(shift)
    db.flush()
    order = Comanda(
        id="order-readiness",
        restaurante_id=tenant_id,
        garcom_id=user.id,
        tipo="Retirada",
        numero_pedido=1,
        fechada=False,
    )
    db.add(order)
    db.flush()
    db.add(
        Pagamento(
            id="payment-readiness",
            restaurante_id=tenant_id,
            comanda_id=order.id,
            turno_id=shift.id,
            valor=10,
            metodo="dinheiro",
            status="aprovado",
            idempotency_key="payment-readiness",
        )
    )
    db.commit()

    paid_but_open = onboarding_route.get_onboarding_status(db=db, current_user=user)
    assert paid_but_open["steps"]["firstOrder"] is False

    order = db.query(Comanda).filter(Comanda.id == "order-readiness").one()
    order.fechada = True
    order.fechado_em = datetime.datetime.now(datetime.timezone.utc)
    db.commit()

    completed = onboarding_route.get_onboarding_status(db=db, current_user=user)
    assert completed["steps"]["firstOrder"] is True
    assert completed["readiness"]["readyToOperate"] is True

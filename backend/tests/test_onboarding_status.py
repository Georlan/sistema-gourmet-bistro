from __future__ import annotations

import datetime

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, current_restaurante_id
from app.main import app
from app.models import (
    ActivityLog,
    CaixaTurno,
    Categoria,
    Comanda,
    ConfiguracaoRestaurante,
    Mesa,
    Pagamento,
    Produto,
    Restaurante,
    Usuario,
)
from app.routes import onboarding as onboarding_route
from app.routes.onboarding import OnboardingOrderTypesRequest, _trial_status_payload
from app.routes.super_admin_onboarding import restaurant_trials
from app.saas_billing_models import SaaSSubscription


def test_onboarding_routes_are_registered_once():
    openapi_paths = app.openapi().get("paths", {})
    assert "/api/onboarding/status" in openapi_paths
    assert "get" in openapi_paths["/api/onboarding/status"]
    assert "/api/onboarding/order-types" in openapi_paths
    assert "put" in openapi_paths["/api/onboarding/order-types"]
    assert "/api/onboarding/start-trial" in openapi_paths
    assert "post" in openapi_paths["/api/onboarding/start-trial"]

    with TestClient(app) as client:
        assert client.get("/api/onboarding/status").status_code == 401
        assert client.put(
            "/api/onboarding/order-types",
            json={"order_types": ["retirada"]},
        ).status_code == 401
        assert client.post("/api/onboarding/start-trial").status_code == 401


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
            horarios_funcionamento=[{"days": "segunda a sexta", "hours": "11:00-22:00"}],
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


def _start_trial_locally(db, tenant_id):
    now = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=1)
    subscription = (
        db.query(SaaSSubscription)
        .filter(SaaSSubscription.restaurante_id == tenant_id)
        .one()
    )
    subscription.status = "trialing"
    subscription.trial_started_at = now
    subscription.trial_ends_at = now + datetime.timedelta(days=7)
    subscription.current_period_start = now
    subscription.current_period_end = subscription.trial_ends_at
    db.execute(
        restaurant_trials.insert().values(
            restaurante_id=tenant_id,
            trial_started_at=now,
            trial_ends_at=subscription.trial_ends_at,
            trial_status="active",
            created_at=now,
            updated_at=now,
        )
    )
    db.commit()
    return now


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
    assert payload["setupPending"] is True
    assert payload["trialCanStart"] is True
    subscription = (
        db.query(SaaSSubscription)
        .filter(SaaSSubscription.restaurante_id == tenant_id)
        .one()
    )
    assert subscription.trial_started_at is None
    assert subscription.status == "onboarding"


def test_inactive_product_does_not_complete_catalog(onboarding_db):
    db, user, tenant_id = onboarding_db
    db.query(Produto).filter(
        Produto.restaurante_id == tenant_id,
        Produto.id == "prod-readiness",
    ).update({"ativo": False})
    db.commit()

    payload = onboarding_route.get_onboarding_status(db=db, current_user=user)

    assert payload["counts"]["products"] == 1
    assert payload["counts"]["activeProducts"] == 0
    assert payload["steps"]["catalog"] is False
    assert payload["readiness"]["configurationComplete"] is False


def test_new_setup_requires_explicit_order_modes_while_legacy_null_is_preserved(onboarding_db):
    db, user, tenant_id = onboarding_db
    config = db.query(ConfiguracaoRestaurante).filter(
        ConfiguracaoRestaurante.restaurante_id == tenant_id
    ).one()
    config.tipos_pedido_ativos = None
    db.commit()

    setup = onboarding_route.get_onboarding_status(db=db, current_user=user)
    assert setup["operations"]["configured"] is False
    assert setup["operations"]["orderTypes"] == []
    assert "order_types" in setup["operations"]["blockers"]

    subscription = db.query(SaaSSubscription).filter(
        SaaSSubscription.restaurante_id == tenant_id
    ).one()
    subscription.status = "active"
    db.commit()

    legacy = onboarding_route.get_onboarding_status(db=db, current_user=user)
    assert legacy["setupPending"] is False
    assert legacy["operations"]["legacyPolicy"] is True
    assert legacy["operations"]["orderTypes"] == []


def test_dine_in_only_requires_table_when_map_is_enabled(onboarding_db):
    db, user, tenant_id = onboarding_db
    config = db.query(ConfiguracaoRestaurante).filter(
        ConfiguracaoRestaurante.restaurante_id == tenant_id
    ).one()
    config.tipos_pedido_ativos = ["consumo_local"]
    config.mapa_mesas_ativo = False
    db.commit()

    no_map = onboarding_route.get_onboarding_status(db=db, current_user=user)
    assert no_map["operations"]["ready"] is True

    config.mapa_mesas_ativo = True
    db.commit()
    blocked = onboarding_route.get_onboarding_status(db=db, current_user=user)
    assert "dine_in_tables" in blocked["operations"]["blockers"]

    db.add(Mesa(restaurante_id=tenant_id, id=1, capacidade=4))
    db.commit()
    ready = onboarding_route.get_onboarding_status(db=db, current_user=user)
    assert ready["operations"]["ready"] is True


def test_delivery_readiness_does_not_require_mercado_pago(onboarding_db):
    db, user, tenant_id = onboarding_db
    restaurant = db.query(Restaurante).filter(Restaurante.id == tenant_id).one()
    config = db.query(ConfiguracaoRestaurante).filter(
        ConfiguracaoRestaurante.restaurante_id == tenant_id
    ).one()
    restaurant.endereco = "Rua do Teste, 100"
    config.tipos_pedido_ativos = ["delivery"]
    config.delivery_ativo = True
    config.tipo_taxa_entrega = "fixa"
    config.taxa_entrega_fixa = 0
    db.commit()

    payload = onboarding_route.get_onboarding_status(db=db, current_user=user)

    assert payload["operations"]["ready"] is True
    assert payload["payments"]["mercadoPagoConnected"] is False
    assert payload["payments"]["pixOnlineAvailable"] is False
    assert payload["operations"]["capabilities"]["onlinePayment"]["enabled"] is False


def test_order_type_update_is_audited_and_does_not_overwrite_lateral_settings(onboarding_db):
    db, user, tenant_id = onboarding_db
    config = db.query(ConfiguracaoRestaurante).filter(
        ConfiguracaoRestaurante.restaurante_id == tenant_id
    ).one()
    config.mapa_mesas_ativo = True
    config.taxa_servico_ativa = True
    config.taxa_servico_padrao = 12.5
    config.tipo_taxa_entrega = "bairro"
    config.tabela_taxas_bairros = [{"bairro": "Centro", "taxa": 4}]
    db.commit()

    payload = onboarding_route.update_onboarding_order_types(
        payload=OnboardingOrderTypesRequest(
            order_types=["consumo_local", "delivery"],
        ),
        db=db,
        current_user=user,
    )

    db.refresh(config)
    assert config.tipos_pedido_ativos == ["consumo_local", "delivery"]
    assert config.delivery_ativo is True
    assert config.mapa_mesas_ativo is True
    assert config.taxa_servico_ativa is True
    assert float(config.taxa_servico_padrao) == 12.5
    assert config.tipo_taxa_entrega == "bairro"
    assert config.tabela_taxas_bairros == [{"bairro": "Centro", "taxa": 4}]
    assert payload["operations"]["orderTypes"] == ["consumo_local", "delivery"]

    audit = db.query(ActivityLog).filter(
        ActivityLog.restaurante_id == tenant_id,
        ActivityLog.action == "ONBOARDING_ORDER_TYPES_UPDATE",
    ).one()
    assert '"before": ["retirada"]' in audit.details
    assert '"after": ["consumo_local", "delivery"]' in audit.details


def test_support_mode_cannot_mutate_customer_onboarding(onboarding_db):
    db, user, _tenant_id = onboarding_db
    user.is_support_mode = True

    with pytest.raises(HTTPException) as exc:
        onboarding_route.update_onboarding_order_types(
            payload=OnboardingOrderTypesRequest(order_types=["retirada"]),
            db=db,
            current_user=user,
        )

    assert exc.value.status_code == 403


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


def test_explicit_trial_start_is_the_single_release_mutation(onboarding_db, monkeypatch):
    db, user, tenant_id = onboarding_db
    calls = []
    now = datetime.datetime.now(datetime.timezone.utc)

    def fake_start(session, *, restaurante_id, actor):
        calls.append((restaurante_id, actor))
        subscription = session.query(SaaSSubscription).filter(
            SaaSSubscription.restaurante_id == restaurante_id
        ).one()
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
    assert payload["setupPending"] is False
    assert payload["trial"]["status"] == "active"
    assert payload["trialCanStart"] is False
    assert payload["readiness"]["trialStarted"] is True
    assert payload["readiness"]["readyToOperate"] is False


def test_only_explicit_paid_closed_test_after_trial_counts(onboarding_db):
    db, user, tenant_id = onboarding_db
    trial_started_at = _start_trial_locally(db, tenant_id)

    shift = CaixaTurno(
        restaurante_id=tenant_id,
        aberto_por_id=user.id,
        saldo_inicial=0,
        status="aberto",
    )
    db.add(shift)
    db.flush()

    historical = Comanda(
        id="historical-readiness",
        restaurante_id=tenant_id,
        garcom_id=user.id,
        tipo="Retirada",
        numero_pedido=1,
        fechada=True,
        onboarding_test=True,
        criado_em=trial_started_at - datetime.timedelta(minutes=1),
    )
    regular = Comanda(
        id="regular-readiness",
        restaurante_id=tenant_id,
        garcom_id=user.id,
        tipo="Retirada",
        numero_pedido=2,
        fechada=True,
        onboarding_test=False,
        criado_em=trial_started_at + datetime.timedelta(seconds=1),
    )
    test_order = Comanda(
        id="test-readiness",
        restaurante_id=tenant_id,
        garcom_id=user.id,
        tipo="Retirada",
        numero_pedido=3,
        fechada=False,
        onboarding_test=True,
        criado_em=trial_started_at + datetime.timedelta(seconds=2),
    )
    db.add_all([historical, regular, test_order])
    db.flush()

    for index, order in enumerate((historical, regular, test_order), start=1):
        db.add(
            Pagamento(
                id=f"payment-readiness-{index}",
                restaurante_id=tenant_id,
                comanda_id=order.id,
                turno_id=shift.id,
                valor=10,
                metodo="dinheiro",
                status="aprovado",
                idempotency_key=f"payment-readiness-{index}",
            )
        )
    db.commit()

    before = onboarding_route.get_onboarding_status(db=db, current_user=user)
    assert before["steps"]["firstOrder"] is False
    assert before["readiness"]["readyToOperate"] is False

    test_order = db.query(Comanda).filter(Comanda.id == "test-readiness").one()
    test_order.fechada = True
    test_order.fechado_em = datetime.datetime.now(datetime.timezone.utc)
    db.commit()

    completed = onboarding_route.get_onboarding_status(db=db, current_user=user)
    assert completed["steps"]["firstOrder"] is True
    assert completed["readiness"]["testOrderComplete"] is True
    assert completed["readiness"]["readyToOperate"] is True


def test_test_order_must_use_an_active_mode(onboarding_db):
    db, user, tenant_id = onboarding_db
    trial_started_at = _start_trial_locally(db, tenant_id)
    shift = CaixaTurno(
        restaurante_id=tenant_id,
        aberto_por_id=user.id,
        saldo_inicial=0,
        status="aberto",
    )
    db.add(shift)
    db.flush()
    order = Comanda(
        id="delivery-test-readiness",
        restaurante_id=tenant_id,
        garcom_id=user.id,
        tipo="Entrega",
        numero_pedido=4,
        fechada=True,
        onboarding_test=True,
        criado_em=trial_started_at + datetime.timedelta(seconds=1),
    )
    db.add(order)
    db.flush()
    db.add(
        Pagamento(
            id="payment-delivery-readiness",
            restaurante_id=tenant_id,
            comanda_id=order.id,
            turno_id=shift.id,
            valor=10,
            metodo="dinheiro",
            status="aprovado",
            idempotency_key="payment-delivery-readiness",
        )
    )
    db.commit()

    payload = onboarding_route.get_onboarding_status(db=db, current_user=user)
    assert payload["operations"]["orderTypes"] == ["retirada"]
    assert payload["steps"]["firstOrder"] is False


def test_test_order_readiness_is_strictly_tenant_scoped(onboarding_db):
    db, user, tenant_id = onboarding_db
    _start_trial_locally(db, tenant_id)
    other_tenant_id = tenant_id + 1
    other_restaurant = Restaurante(
        id=other_tenant_id,
        nome="Outro Bistro",
        slug="outro-bistro-readiness",
        plano="pro",
        endereco="Rua Outro Tenant, 1",
        horarios_funcionamento=[{"days": "segunda a sexta", "hours": "11:00-22:00"}],
    )
    other_user = Usuario(
        id="admin-other-readiness",
        restaurante_id=other_tenant_id,
        nome="Admin Outro",
        email="admin-other-readiness@example.test",
        cargo="admin",
        status="ativo",
        senha_hash="test-only",
    )
    db.add_all([other_restaurant, other_user])
    db.flush()
    other_shift = CaixaTurno(
        restaurante_id=other_tenant_id,
        aberto_por_id=other_user.id,
        saldo_inicial=0,
        status="aberto",
    )
    db.add(other_shift)
    db.flush()
    other_order = Comanda(
        id="other-tenant-test-readiness",
        restaurante_id=other_tenant_id,
        garcom_id=other_user.id,
        tipo="Retirada",
        numero_pedido=1,
        fechada=True,
        onboarding_test=True,
        criado_em=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add(other_order)
    db.flush()
    db.add(
        Pagamento(
            id="other-tenant-payment-readiness",
            restaurante_id=other_tenant_id,
            comanda_id=other_order.id,
            turno_id=other_shift.id,
            valor=10,
            metodo="dinheiro",
            status="aprovado",
            idempotency_key="other-tenant-payment-readiness",
        )
    )
    db.commit()

    payload = onboarding_route.get_onboarding_status(db=db, current_user=user)

    assert payload["restaurant"]["id"] == str(tenant_id)
    assert payload["steps"]["firstOrder"] is False
    assert payload["readiness"]["readyToOperate"] is False

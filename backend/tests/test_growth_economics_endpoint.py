from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, current_restaurante_id, get_db
from app.main import app
from app.models import Restaurante, Usuario
from app.security import get_password_hash

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_growth_economics_endpoint.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def setup_database():
    token = current_restaurante_id.set(1)
    app.dependency_overrides[get_db] = override_get_db
    try:
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        db = TestingSessionLocal()
        # Base.metadata.after_create semeia o restaurante 1 nos bancos SQLite de
        # teste. Reaproveitamos esse registro para não criar uma segunda PK.
        restaurante = db.query(Restaurante).filter(Restaurante.id == 1).one()
        restaurante.nome = "Economia Pro"
        restaurante.plano = "pro"
        restaurante.billing_mode = "legacy"
        db.add(
            Usuario(
                id="growth-admin",
                restaurante_id=1,
                nome="Gestor Growth",
                usuario="growth",
                senha_hash=get_password_hash("123"),
                role="gerente",
                status="ativo",
            )
        )
        db.commit()
        db.close()
        yield
    finally:
        app.dependency_overrides.pop(get_db, None)
        current_restaurante_id.reset(token)


def _headers(client: TestClient) -> dict[str, str]:
    response = client.post("/auth/login", json={"username": "growth", "password": "123"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_recommendation_endpoint_uses_authenticated_tenant_plan_rate():
    client = TestClient(app)
    response = client.post(
        "/caixa/cupons/economia/recomendacao",
        headers=_headers(client),
        json={
            "average_ticket": 100,
            "variable_cost_percent": 60,
            "minimum_margin_percent": 20,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["economics"]["koma_fee_percent"] == 0.0
    assert payload["economics"]["koma_revenue_per_average_order"] == 0.0
    assert payload["economics"]["contribution_margin_before_incentive_percent"] == 40.0
    assert payload["economics"]["safe_incentive_ceiling_percent"] == 20.0


def test_recommendation_endpoint_uses_resolved_contract_rate_not_catalog_slug(monkeypatch):
    monkeypatch.setattr(
        "app.routes.cupons.tenant_marketplace_rate",
        lambda _db, _restaurant: Decimal("0.0020"),
    )
    client = TestClient(app)
    response = client.post(
        "/caixa/cupons/economia/recomendacao",
        headers=_headers(client),
        json={
            "average_ticket": 100,
            "variable_cost_percent": 60,
            "minimum_margin_percent": 20,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["economics"]["koma_fee_percent"] == 0.2
    assert payload["economics"]["koma_revenue_per_average_order"] == 0.2
    assert payload["economics"]["contribution_margin_before_incentive_percent"] == 39.8
    assert payload["economics"]["safe_incentive_ceiling_percent"] == 19.8
    assert payload["options"][-1]["estimated_margin_after_incentive_percent"] == 20.0


def test_recommendation_endpoint_requires_authentication():
    client = TestClient(app)
    response = client.post(
        "/caixa/cupons/economia/recomendacao",
        json={
            "average_ticket": 100,
            "variable_cost_percent": 60,
            "minimum_margin_percent": 20,
        },
    )
    assert response.status_code == 401


def test_recommendation_endpoint_rejects_invalid_cost_assumptions():
    client = TestClient(app)
    response = client.post(
        "/caixa/cupons/economia/recomendacao",
        headers=_headers(client),
        json={
            "average_ticket": 100,
            "variable_cost_percent": 100,
            "minimum_margin_percent": 20,
        },
    )
    assert response.status_code == 422


def test_automatic_loyalty_recommendation_does_not_require_coupon_entitlement(monkeypatch):
    from app.services.plan_entitlements import ENTITLEMENT_LOYALTY
    monkeypatch.setattr(
        "app.routes.cupons.has_plan_entitlement",
        lambda _db, _tenant, feature: feature == ENTITLEMENT_LOYALTY,
    )
    client = TestClient(app)
    result = client.post(
        "/caixa/cupons/economia/recomendacao",
        headers=_headers(client),
        json={"mode": "automatico"},
    )
    assert result.status_code == 200
    assert result.json()["source"] == "conservative_default"
    assert result.json()["suggestion"]["effective_reward_percent"] == 2.0


def test_automatic_loyalty_recommendation_requires_at_least_one_entitlement(monkeypatch):
    monkeypatch.setattr(
        "app.routes.cupons.has_plan_entitlement",
        lambda _db, _tenant, _feature: False,
    )
    client = TestClient(app)
    result = client.post(
        "/caixa/cupons/economia/recomendacao",
        headers=_headers(client),
        json={"mode": "automatico"},
    )
    assert result.status_code == 403

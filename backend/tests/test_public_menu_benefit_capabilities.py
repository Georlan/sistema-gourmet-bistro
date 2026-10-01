import itertools

import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.main import app
from app.models import ConfigFidelizacao, Restaurante
from app.smartpos_models import RestauranteCapability


client = TestClient(app)
tenant_ids = itertools.count(96571)


@pytest.fixture
def benefit_tenant():
    Base.metadata.create_all(bind=engine)
    rid = next(tenant_ids)
    token = current_restaurante_id.set(rid)
    with SessionLocal(restaurante_id=rid) as db:
        restaurant = Restaurante(id=rid, nome="Benefícios do menu", plano="pocket", slug=f"benefits-{rid}")
        db.add(restaurant)
        db.commit()
        program = ConfigFidelizacao(restaurante_id=rid, ativo=True, tipo_recompensa="CASHBACK")
        db.add(program)
        db.commit()
        yield db, restaurant, program
        db.rollback()
        db.query(RestauranteCapability).filter_by(restaurante_id=rid).delete()
        db.query(ConfigFidelizacao).filter_by(restaurante_id=rid).delete()
        db.query(Restaurante).filter_by(id=rid).delete()
        db.commit()
    current_restaurante_id.reset(token)


def public_capabilities(rid, path="public"):
    response = client.get(f"/api/cardapio-digital/{path}?restaurante_id={rid}")
    assert response.status_code == 200, response.text
    body = response.json()
    return (body["restaurante"] if path == "public" else body)["beneficios"]


def test_disabled_plan_hides_legacy_program_and_exposes_no_private_data(benefit_tenant):
    _, restaurant, _ = benefit_tenant
    for path in ("public", "config"):
        assert public_capabilities(restaurant.id, path) == {"coupons": False, "loyalty": False, "cashback": False}


def test_coupon_addon_and_explicit_loyalty_revocation_override_the_plan(benefit_tenant):
    db, restaurant, _ = benefit_tenant
    db.add(RestauranteCapability(restaurante_id=restaurant.id, capability="coupons", enabled=True, source="addon"))
    db.commit()
    assert public_capabilities(restaurant.id) == {"coupons": True, "loyalty": False, "cashback": False}
    restaurant.plano = "premium"
    db.add(RestauranteCapability(restaurante_id=restaurant.id, capability="loyalty", enabled=False, source="manual"))
    db.commit()
    assert public_capabilities(restaurant.id) == {"coupons": True, "loyalty": False, "cashback": False}


def test_loyalty_capability_preserves_balances_when_program_changes_or_pauses(benefit_tenant):
    db, restaurant, program = benefit_tenant
    restaurant.plano = "premium"
    db.commit()
    assert public_capabilities(restaurant.id) == {"coupons": True, "loyalty": True, "cashback": True}
    program.tipo_recompensa = "PONTOS"
    db.commit()
    assert public_capabilities(restaurant.id) == {"coupons": True, "loyalty": True, "cashback": True}
    program.ativo = False
    db.commit()
    assert public_capabilities(restaurant.id) == {"coupons": True, "loyalty": True, "cashback": True}


def test_anonymous_menu_does_not_reuse_another_tenants_capabilities(benefit_tenant):
    db, restaurant, _ = benefit_tenant
    restaurant.plano = "premium"
    db.commit()
    other_id = next(tenant_ids)
    other_token = current_restaurante_id.set(other_id)
    with SessionLocal(restaurante_id=other_id) as other:
        other.add(Restaurante(id=other_id, nome="Outro restaurante", plano="pocket"))
        other.commit()
        try:
            assert public_capabilities(restaurant.id)["cashback"] is True
            assert public_capabilities(other_id) == {"coupons": False, "loyalty": False, "cashback": False}
        finally:
            other.query(Restaurante).filter_by(id=other_id).delete()
            other.commit()
    current_restaurante_id.reset(other_token)

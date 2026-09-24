import pytest

from app.database import SessionLocal, current_restaurante_id
from types import SimpleNamespace

from app.models import ConfiguracaoRestaurante, Restaurante
from app.services.plan_entitlements import (
    ENTITLEMENT_COUPONS,
    ENTITLEMENT_COURIER_APP,
    ENTITLEMENT_KDS,
    ENTITLEMENT_LOYALTY,
    ENTITLEMENT_PRINTING,
    ENTITLEMENT_WAITER_APP,
    has_plan_entitlement,
    resolve_plan_entitlements,
)
from app.smartpos_models import RestauranteCapability
from app.waiter_permissions import waiter_permission_enabled


TENANT_ID = 989


@pytest.fixture()
def tenant_db():
    token = current_restaurante_id.set(TENANT_ID)
    db = SessionLocal()
    try:
        db.query(RestauranteCapability).filter(
            RestauranteCapability.restaurante_id == TENANT_ID
        ).delete(synchronize_session=False)
        rest = db.query(Restaurante).filter(Restaurante.id == TENANT_ID).first()
        if rest is None:
            rest = Restaurante(
                id=TENANT_ID,
                nome="Entitlements Test",
                slug="entitlements-test",
                plano="pocket",
            )
            db.add(rest)
        else:
            rest.plano = "pocket"
        db.commit()
        yield db, rest
    finally:
        db.rollback()
        db.query(RestauranteCapability).filter(
            RestauranteCapability.restaurante_id == TENANT_ID
        ).delete(synchronize_session=False)
        db.commit()
        db.close()
        current_restaurante_id.reset(token)


def test_plan_matrix_pocket_pro_premium(tenant_db):
    db, rest = tenant_db

    rest.plano = "pocket"
    db.commit()
    assert resolve_plan_entitlements(db, TENANT_ID, stored_plan=rest.plano) == {
        "coupons": False,
        "courier_app": False,
        "kds": False,
        "loyalty": False,
        "printing": False,
        "waiter_app": True,
    }

    rest.plano = "pro"
    db.commit()
    assert has_plan_entitlement(db, TENANT_ID, ENTITLEMENT_PRINTING, stored_plan=rest.plano)
    assert has_plan_entitlement(db, TENANT_ID, ENTITLEMENT_KDS, stored_plan=rest.plano)
    assert has_plan_entitlement(db, TENANT_ID, ENTITLEMENT_WAITER_APP, stored_plan=rest.plano)
    assert not has_plan_entitlement(db, TENANT_ID, ENTITLEMENT_LOYALTY, stored_plan=rest.plano)
    assert not has_plan_entitlement(db, TENANT_ID, ENTITLEMENT_COUPONS, stored_plan=rest.plano)
    assert not has_plan_entitlement(db, TENANT_ID, ENTITLEMENT_COURIER_APP, stored_plan=rest.plano)

    rest.plano = "premium"
    db.commit()
    assert all(resolve_plan_entitlements(db, TENANT_ID, stored_plan=rest.plano).values())


def test_explicit_capability_overrides_plan_baseline(tenant_db):
    db, rest = tenant_db

    rest.plano = "pro"
    db.add(
        RestauranteCapability(
            restaurante_id=TENANT_ID,
            capability=ENTITLEMENT_COUPONS,
            enabled=True,
            source="addon",
        )
    )
    db.commit()
    assert has_plan_entitlement(db, TENANT_ID, ENTITLEMENT_COUPONS, stored_plan=rest.plano)

    rest.plano = "premium"
    db.add(
        RestauranteCapability(
            restaurante_id=TENANT_ID,
            capability=ENTITLEMENT_LOYALTY,
            enabled=False,
            source="manual",
        )
    )
    db.commit()
    assert not has_plan_entitlement(db, TENANT_ID, ENTITLEMENT_LOYALTY, stored_plan=rest.plano)
    assert has_plan_entitlement(db, TENANT_ID, ENTITLEMENT_COUPONS, stored_plan=rest.plano)



def test_pocket_waiter_keeps_app_but_print_permission_is_effectively_disabled(tenant_db):
    db, rest = tenant_db
    config = (
        db.query(ConfiguracaoRestaurante)
        .filter(ConfiguracaoRestaurante.restaurante_id == TENANT_ID)
        .first()
    )
    if config is None:
        config = ConfiguracaoRestaurante(
            restaurante_id=TENANT_ID,
            perm_garcom_print=True,
        )
        db.add(config)
    else:
        config.perm_garcom_print = True

    waiter = SimpleNamespace(
        role="garcom",
        cargo="garcom",
        restaurante_id=TENANT_ID,
    )

    rest.plano = "pocket"
    db.commit()
    assert has_plan_entitlement(
        db,
        TENANT_ID,
        ENTITLEMENT_WAITER_APP,
        stored_plan=rest.plano,
    )
    assert not has_plan_entitlement(
        db,
        TENANT_ID,
        ENTITLEMENT_PRINTING,
        stored_plan=rest.plano,
    )
    assert not waiter_permission_enabled(db, waiter, "perm_garcom_print")

    rest.plano = "pro"
    db.commit()
    assert waiter_permission_enabled(db, waiter, "perm_garcom_print")

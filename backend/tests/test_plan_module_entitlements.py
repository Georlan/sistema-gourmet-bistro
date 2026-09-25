import uuid

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal, current_restaurante_id
from app.main import app
from app.models import ConfiguracaoRestaurante, Restaurante, Usuario
from app.security import create_access_token
from app.smartpos_models import RestauranteCapability


client = TestClient(app)

POCKET_ID = 7811
PRO_ID = 7812
PREMIUM_ID = 7813


def _headers(restaurante_id: int, role: str = "admin") -> dict[str, str]:
    user_id = f"block2-{restaurante_id}-{role}"
    token = create_access_token(
        subject=user_id,
        restaurante_id=restaurante_id,
        role=role,
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def plan_tenants():
    for restaurante_id, plano in [
        (POCKET_ID, "pocket"),
        (PRO_ID, "pro"),
        (PREMIUM_ID, "premium"),
    ]:
        tenant_token = current_restaurante_id.set(restaurante_id)
        try:
            with SessionLocal() as db:
                db.query(RestauranteCapability).filter(
                    RestauranteCapability.restaurante_id == restaurante_id,
                ).delete(synchronize_session=False)

                restaurante = db.query(Restaurante).filter(
                    Restaurante.id == restaurante_id,
                ).first()
                if restaurante is None:
                    restaurante = Restaurante(
                        id=restaurante_id,
                        nome=f"Block2 {plano}",
                        slug=f"block2-{plano}-{uuid.uuid4().hex[:6]}",
                        plano=plano,
                    )
                    db.add(restaurante)
                else:
                    restaurante.plano = plano

                config = db.query(ConfiguracaoRestaurante).filter(
                    ConfiguracaoRestaurante.restaurante_id == restaurante_id,
                ).first()
                if config is None:
                    db.add(ConfiguracaoRestaurante(restaurante_id=restaurante_id))

                for role in ("admin", "garcom"):
                    user_id = f"block2-{restaurante_id}-{role}"
                    user = db.query(Usuario).filter(
                        Usuario.id == user_id,
                        Usuario.restaurante_id == restaurante_id,
                    ).first()
                    if user is None:
                        user = Usuario(
                            id=user_id,
                            restaurante_id=restaurante_id,
                            nome=f"{role} {plano}",
                            role=role,
                            cargo=role,
                            status="ativo",
                        )
                        db.add(user)
                    else:
                        user.role = role
                        user.cargo = role
                        user.status = "ativo"
                db.commit()
        finally:
            current_restaurante_id.reset(tenant_token)

    yield

    for restaurante_id in (POCKET_ID, PRO_ID, PREMIUM_ID):
        tenant_token = current_restaurante_id.set(restaurante_id)
        try:
            with SessionLocal() as db:
                db.query(RestauranteCapability).filter(
                    RestauranteCapability.restaurante_id == restaurante_id,
                ).delete(synchronize_session=False)
                db.commit()
        finally:
            current_restaurante_id.reset(tenant_token)


@pytest.mark.parametrize(
    ("restaurante_id", "inventory_enabled", "reports_enabled"),
    [
        (POCKET_ID, False, False),
        (PRO_ID, True, True),
        (PREMIUM_ID, True, True),
    ],
)
def test_cashier_config_publishes_effective_module_entitlements(
    restaurante_id: int,
    inventory_enabled: bool,
    reports_enabled: bool,
):
    response = client.get("/caixa/configuracoes", headers=_headers(restaurante_id))
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["restaurante_id"] == restaurante_id
    assert payload["entitlements"]["inventory"] is inventory_enabled
    assert payload["entitlements"]["advanced_reports"] is reports_enabled


@pytest.mark.parametrize(
    ("restaurante_id", "inventory_status", "reports_status"),
    [
        (POCKET_ID, 403, 403),
        (PRO_ID, 200, 200),
        (PREMIUM_ID, 200, 200),
    ],
)
def test_plan_baseline_enforces_inventory_and_advanced_reports(
    restaurante_id: int,
    inventory_status: int,
    reports_status: int,
):
    headers = _headers(restaurante_id)

    inventory = client.get("/estoque/insumos", headers=headers)
    reports = client.get("/relatorios/visao-geral", headers=headers)

    assert inventory.status_code == inventory_status, inventory.text
    assert reports.status_code == reports_status, reports.text


def test_explicit_capabilities_override_module_access():
    tenant_token = current_restaurante_id.set(POCKET_ID)
    try:
        with SessionLocal() as db:
            db.add_all([
                RestauranteCapability(
                    restaurante_id=POCKET_ID,
                    capability="inventory",
                    enabled=True,
                    source="addon",
                ),
                RestauranteCapability(
                    restaurante_id=POCKET_ID,
                    capability="advanced_reports",
                    enabled=True,
                    source="addon",
                ),
            ])
            db.commit()
    finally:
        current_restaurante_id.reset(tenant_token)

    headers = _headers(POCKET_ID)
    assert client.get("/estoque/insumos", headers=headers).status_code == 200
    assert client.get("/relatorios/visao-geral", headers=headers).status_code == 200

    tenant_token = current_restaurante_id.set(PREMIUM_ID)
    try:
        with SessionLocal() as db:
            db.add_all([
                RestauranteCapability(
                    restaurante_id=PREMIUM_ID,
                    capability="inventory",
                    enabled=False,
                    source="manual",
                ),
                RestauranteCapability(
                    restaurante_id=PREMIUM_ID,
                    capability="advanced_reports",
                    enabled=False,
                    source="manual",
                ),
            ])
            db.commit()
    finally:
        current_restaurante_id.reset(tenant_token)

    premium_headers = _headers(PREMIUM_ID)
    assert client.get("/estoque/insumos", headers=premium_headers).status_code == 403
    assert client.get("/relatorios/visao-geral", headers=premium_headers).status_code == 403


def test_entitlement_never_replaces_operator_rbac():
    waiter_headers = _headers(PRO_ID, "garcom")
    assert client.get("/estoque/insumos", headers=waiter_headers).status_code == 403
    assert client.get("/relatorios/visao-geral", headers=waiter_headers).status_code == 403

import pytest
from decimal import Decimal
from fastapi.testclient import TestClient

from app.database import SessionLocal, current_restaurante_id
from app.main import app
from app.models import ConfiguracaoRestaurante, Motoboy, Restaurante, Usuario
from app.security import create_access_token
from app.services.product_contract import (
    ProductContractViolation,
    load_product_contract,
    run_full_contract_validation,
    validate_backend_entitlements,
    validate_frontend_against_contract,
    validate_navigation_rules,
)
from app.smartpos_models import RestauranteCapability

client = TestClient(app)

POCKET_TENANT_ID = 8801
PRO_TENANT_ID = 8802
PREMIUM_TENANT_ID = 8803


def _auth_headers(restaurante_id: int, role: str = "admin") -> dict[str, str]:
    user_id = f"gate-{restaurante_id}-{role}"
    token = create_access_token(
        subject=user_id,
        restaurante_id=restaurante_id,
        role=role,
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def setup_gate_tenants():
    """Configura restaurantes de teste para cada plano comercial canônico."""
    tenants = [
        (POCKET_TENANT_ID, "pocket"),
        (PRO_TENANT_ID, "pro"),
        (PREMIUM_TENANT_ID, "premium"),
    ]
    for r_id, plano in tenants:
        token = current_restaurante_id.set(r_id)
        try:
            with SessionLocal() as db:
                db.query(RestauranteCapability).filter(
                    RestauranteCapability.restaurante_id == r_id
                ).delete(synchronize_session=False)

                rest = db.query(Restaurante).filter(Restaurante.id == r_id).first()
                if not rest:
                    rest = Restaurante(
                        id=r_id,
                        nome=f"Contract Gate {plano}",
                        slug=f"contract-gate-{plano}",
                        plano=plano,
                    )
                    db.add(rest)
                else:
                    rest.plano = plano

                cfg = db.query(ConfiguracaoRestaurante).filter(
                    ConfiguracaoRestaurante.restaurante_id == r_id
                ).first()
                if not cfg:
                    db.add(ConfiguracaoRestaurante(restaurante_id=r_id))

                for role in ("admin", "garcom"):
                    u_id = f"gate-{r_id}-{role}"
                    user = db.query(Usuario).filter(Usuario.id == u_id).first()
                    if not user:
                        db.add(
                            Usuario(
                                id=u_id,
                                restaurante_id=r_id,
                                nome=f"{role.capitalize()} {plano}",
                                role=role,
                                cargo=role,
                                status="ativo",
                            )
                        )
                    else:
                        user.status = "ativo"

                mb = db.query(Motoboy).filter(Motoboy.restaurante_id == r_id).first()
                if not mb:
                    db.add(
                        Motoboy(
                            restaurante_id=r_id,
                            nome=f"Motoboy {plano}",
                            telefone="11999999999",
                            ativo=True,
                        )
                    )
                else:
                    mb.ativo = True
                db.commit()
        finally:
            current_restaurante_id.reset(token)

    yield

    for r_id, _ in tenants:
        token = current_restaurante_id.set(r_id)
        try:
            with SessionLocal() as db:
                db.query(RestauranteCapability).filter(
                    RestauranteCapability.restaurante_id == r_id
                ).delete(synchronize_session=False)
                db.commit()
        finally:
            current_restaurante_id.reset(token)


def test_full_product_contract_validation_succeeds():
    """Valida que todas as superfícies (backend, frontend, navegação, landing) coincidem com o contrato canônico."""
    run_full_contract_validation()


def test_backend_entitlements_strictly_match_contract():
    """Valida que _PLAN_ENTITLEMENTS e KNOWN_ENTITLEMENTS refletem o contrato canônico sem desvios."""
    validate_backend_entitlements()


def test_frontend_catalog_and_matrix_strictly_match_contract():
    """Valida que PLAN_FEATURES, SUBSCRIPTION_PLANS e PLAN_COMPARISON_MATRIX refletem o contrato canônico."""
    validate_frontend_against_contract()


def test_navigation_rules_reference_known_capabilities():
    """Valida que todas as regras de proteção de abas/subabas apontam para capabilities canônicas existentes."""
    validate_navigation_rules()


def test_contract_violation_produces_clear_human_readable_error():
    """Valida que desvios hipotéticos de contrato resultam em mensagens claras e acionáveis."""
    contract = load_product_contract()

    # Simula divergência no plano pocket
    tampered = dict(contract)
    tampered["plans"] = dict(contract["plans"])
    tampered["plans"]["pocket"] = dict(contract["plans"]["pocket"])
    tampered["plans"]["pocket"]["capabilities"] = ["waiter_app", "inventory"]  # Pocket NÃO tem inventory

    with pytest.raises(ProductContractViolation) as exc_info:
        validate_backend_entitlements(tampered)

    msg = str(exc_info.value)
    assert "pocket" in msg.lower()
    assert "inventory" in msg.lower()
    assert "divergiu" in msg.lower() or "faltando" in msg.lower() or "capabilities" in msg.lower()


def test_endpoints_enforce_plan_capabilities_fail_closed():
    """Valida que os endpoints protegidos por capabilities do contrato rejeitam 403 no Pocket e aceitam no Pro/Premium."""
    pocket_headers = _auth_headers(POCKET_TENANT_ID)
    pro_headers = _auth_headers(PRO_TENANT_ID)
    premium_headers = _auth_headers(PREMIUM_TENANT_ID)

    # 1. Estoque (requer 'inventory' - ausente no Pocket, presente no Pro/Premium)
    assert client.get("/estoque/insumos", headers=pocket_headers).status_code == 403
    assert client.get("/estoque/insumos", headers=pro_headers).status_code == 200
    assert client.get("/estoque/insumos", headers=premium_headers).status_code == 200

    # 2. Relatórios avançados (requer 'advanced_reports' - ausente no Pocket, presente no Pro/Premium)
    assert client.get("/relatorios/visao-geral", headers=pocket_headers).status_code == 403
    assert client.get("/relatorios/visao-geral", headers=pro_headers).status_code == 200
    assert client.get("/relatorios/visao-geral", headers=premium_headers).status_code == 200

    # 3. Courier App / Link PWA (requer 'courier_app' - exclusivo do Premium)
    # Pocket e Pro operam entregas internamente mas NÃO têm courier_app (403)
    # Premium possui courier_app (200)
    with SessionLocal() as db:
        mb_pocket = db.query(Motoboy).filter(Motoboy.restaurante_id == POCKET_TENANT_ID).first()
        mb_pro = db.query(Motoboy).filter(Motoboy.restaurante_id == PRO_TENANT_ID).first()
        mb_premium = db.query(Motoboy).filter(Motoboy.restaurante_id == PREMIUM_TENANT_ID).first()

    pocket_link = client.post(f"/comandas/motoboys/{mb_pocket.id}/gerar-link", headers=pocket_headers)
    assert pocket_link.status_code == 403

    pro_link = client.post(f"/comandas/motoboys/{mb_pro.id}/gerar-link", headers=pro_headers)
    assert pro_link.status_code == 403

    prem_link = client.post(f"/comandas/motoboys/{mb_premium.id}/gerar-link", headers=premium_headers)
    assert prem_link.status_code == 200
    assert "token" in prem_link.json()


def test_rbac_and_plan_capability_remain_distinct_and_orthogonal():
    """Valida que ter capability no plano NÃO concede acesso se o usuário não tiver permissão de cargo (RBAC)."""
    # Pro tem capability 'inventory', mas garçom não tem permissão RBAC para gerir estoque
    pro_waiter_headers = _auth_headers(PRO_TENANT_ID, role="garcom")
    assert client.get("/estoque/insumos", headers=pro_waiter_headers).status_code == 403

    # Pro tem capability 'advanced_reports', mas garçom não pode ver relatórios
    assert client.get("/relatorios/visao-geral", headers=pro_waiter_headers).status_code == 403


def test_tenant_specific_capability_overrides_do_not_break_contract():
    """Valida que overrides explícitos por tenant (RestauranteCapability) funcionam sem alterar o baseline do plano."""
    # Pocket recebe add-on de estoque
    token = current_restaurante_id.set(POCKET_TENANT_ID)
    try:
        with SessionLocal() as db:
            db.add(
                RestauranteCapability(
                    restaurante_id=POCKET_TENANT_ID,
                    capability="inventory",
                    enabled=True,
                    source="addon",
                )
            )
            db.commit()
    finally:
        current_restaurante_id.reset(token)

    pocket_headers = _auth_headers(POCKET_TENANT_ID)
    # Agora Pocket com override pode acessar estoque
    assert client.get("/estoque/insumos", headers=pocket_headers).status_code == 200

    # Mas relatórios continuam bloqueados
    assert client.get("/relatorios/visao-geral", headers=pocket_headers).status_code == 403

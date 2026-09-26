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
    validate_endpoint_rules,
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


def test_endpoint_rules_reference_known_capabilities():
    """Valida que o catálogo executável de endpoint_rules está íntegro."""
    validate_endpoint_rules()


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
    """Valida que todos os endpoints do catálogo endpoint_rules rejeitam 403 fail-closed para planos sem capability e aceitam para planos com capability."""
    contract = load_product_contract()
    rules = contract.get("endpoint_rules", [])
    assert len(rules) > 0, "endpoint_rules deve conter regras executáveis"

    with SessionLocal() as db:
        mb_ids = {
            POCKET_TENANT_ID: db.query(Motoboy).filter(Motoboy.restaurante_id == POCKET_TENANT_ID).first().id,
            PRO_TENANT_ID: db.query(Motoboy).filter(Motoboy.restaurante_id == PRO_TENANT_ID).first().id,
            PREMIUM_TENANT_ID: db.query(Motoboy).filter(Motoboy.restaurante_id == PREMIUM_TENANT_ID).first().id,
        }

    tenant_map = {
        "pocket": (POCKET_TENANT_ID, _auth_headers(POCKET_TENANT_ID, role="admin")),
        "pro": (PRO_TENANT_ID, _auth_headers(PRO_TENANT_ID, role="admin")),
        "premium": (PREMIUM_TENANT_ID, _auth_headers(PREMIUM_TENANT_ID, role="admin")),
    }

    def _exec(method: str, path: str, headers: dict[str, str], payload: dict | None = None):
        if method == "GET":
            return client.get(path, headers=headers)
        elif method == "POST":
            return client.post(path, headers=headers, json=payload or {})
        elif method == "PUT":
            return client.put(path, headers=headers, json=payload or {})
        elif method == "DELETE":
            return client.delete(path, headers=headers)
        raise ValueError(f"Método não suportado: {method}")

    for rule in rules:
        cap = rule["capability"]
        method = rule["method"]
        endpoint_template = rule["endpoint"]
        payload = rule.get("payload")

        for plan_id, (tenant_id, headers) in tenant_map.items():
            path = endpoint_template.replace("{motoboy_id}", str(mb_ids[tenant_id]))
            resp = _exec(method, path, headers, payload)

            plan_caps = contract["plans"][plan_id]["capabilities"]
            if cap in plan_caps:
                assert resp.status_code in (200, 201), (
                    f"Plano '{plan_id}' deveria ter acesso à capability '{cap}' no endpoint {method} {path}, "
                    f"mas retornou {resp.status_code}: {resp.text}"
                )
            else:
                assert resp.status_code == 403, (
                    f"Plano '{plan_id}' NÃO possui capability '{cap}' e deveria falhar 403 fail-closed em {method} {path}, "
                    f"mas retornou {resp.status_code}: {resp.text}"
                )


def test_rbac_and_plan_capability_remain_distinct_and_orthogonal():
    """Valida que ter capability no plano NÃO concede acesso se o usuário não tiver permissão de cargo (RBAC)."""
    contract = load_product_contract()
    rules = contract.get("endpoint_rules", [])

    with SessionLocal() as db:
        mb_premium = db.query(Motoboy).filter(Motoboy.restaurante_id == PREMIUM_TENANT_ID).first().id

    waiter_headers_premium = _auth_headers(PREMIUM_TENANT_ID, role="garcom")

    # Garçom no Premium possui todas as capabilities de plano do restaurante,
    # mas NÃO possui privilégios administrativos de cargo. Cada endpoint restrito
    # deve rejeitar 403 por falta de permissão RBAC.
    for rule in rules:
        cap = rule["capability"]
        method = rule["method"]
        path = rule["endpoint"].replace("{motoboy_id}", str(mb_premium))
        payload = rule.get("payload")

        if method == "GET":
            resp = client.get(path, headers=waiter_headers_premium)
        elif method == "POST":
            resp = client.post(path, headers=waiter_headers_premium, json=payload or {})
        else:
            continue

        assert resp.status_code == 403, (
            f"Usuário 'garcom' em tenant Premium deveria ter 403 (RBAC) em {method} {path} "
            f"(capability '{cap}'), mas retornou {resp.status_code}: {resp.text}"
        )


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

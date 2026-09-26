"""Serviço e validador canônico do Contrato de Produto (Bloco 6).

Garante que o backend, frontend, navegação, endpoints e landing nunca
convirjam para estados contraditórios de capacidades, preços ou visibilidade.
"""

from __future__ import annotations

import json
import re
from decimal import Decimal
from pathlib import Path
from typing import Any, NamedTuple


REPO_ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = REPO_ROOT / "product-contract.json"
FRONTEND_CATALOG_PATH = REPO_ROOT / "src" / "config" / "subscriptionPlans.ts"
NAVIGATION_PATH = REPO_ROOT / "src" / "components" / "caixa" / "navigation" / "cashierNavigation.ts"


class ProductContractViolation(AssertionError):
    """Exceção levantada com mensagem humana clara quando uma superfície diverge do contrato."""
    pass


class ContractPlan(NamedTuple):
    id: str
    name: str
    price: Decimal
    split_fee_rate: Decimal
    capabilities: frozenset[str]
    features: list[str]
    limitations: list[str]


def load_product_contract(path: Path | None = None) -> dict[str, Any]:
    target = path or CONTRACT_PATH
    if not target.exists():
        raise FileNotFoundError(f"Arquivo de contrato de produto não encontrado em {target}")
    with open(target, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data


def get_contract_plans(data: dict[str, Any] | None = None) -> dict[str, ContractPlan]:
    data = data or load_product_contract()
    plans_raw = data.get("plans", {})
    parsed: dict[str, ContractPlan] = {}
    for plan_id, raw in plans_raw.items():
        parsed[plan_id] = ContractPlan(
            id=plan_id,
            name=raw["name"],
            price=Decimal(str(raw["price"])).quantize(Decimal("0.01")),
            split_fee_rate=Decimal(str(raw["split_fee_rate"])),
            capabilities=frozenset(raw.get("capabilities", [])),
            features=list(raw.get("features", [])),
            limitations=list(raw.get("limitations", [])),
        )
    return parsed


def validate_backend_entitlements(contract_data: dict[str, Any] | None = None) -> None:
    """Valida _PLAN_ENTITLEMENTS e KNOWN_ENTITLEMENTS do backend contra o contrato canônico."""
    from .plan_entitlements import KNOWN_ENTITLEMENTS, _PLAN_ENTITLEMENTS
    from ..subscription import (
        SUBSCRIPTION_MARKETPLACE_RATES,
        SUBSCRIPTION_MONTHLY_PRICES,
        VALID_SUBSCRIPTION_PLANS,
    )

    contract = contract_data or load_product_contract()
    contract_plans = get_contract_plans(contract)
    contract_capabilities = frozenset(contract.get("capabilities", {}).keys())

    # 1. KNOWN_ENTITLEMENTS
    missing_caps = contract_capabilities - KNOWN_ENTITLEMENTS
    if missing_caps:
        raise ProductContractViolation(
            f"Backend plan_entitlements.py está faltando capabilities do contrato: {sorted(missing_caps)}"
        )
    extra_caps = KNOWN_ENTITLEMENTS - contract_capabilities
    if extra_caps:
        raise ProductContractViolation(
            f"Backend plan_entitlements.py possui capabilities extras não registradas no contrato: {sorted(extra_caps)}"
        )

    # 2. VALID_SUBSCRIPTION_PLANS
    expected_plan_ids = set(contract_plans.keys())
    if set(VALID_SUBSCRIPTION_PLANS) != expected_plan_ids:
        raise ProductContractViolation(
            f"Backend subscription.VALID_SUBSCRIPTION_PLANS ({VALID_SUBSCRIPTION_PLANS}) "
            f"divergiu dos planos do contrato ({expected_plan_ids})"
        )

    # 3. _PLAN_ENTITLEMENTS por plano
    for plan_id, plan in contract_plans.items():
        if plan_id not in _PLAN_ENTITLEMENTS:
            raise ProductContractViolation(f"Plano '{plan_id}' do contrato não está em _PLAN_ENTITLEMENTS do backend")

        backend_caps = _PLAN_ENTITLEMENTS[plan_id]
        expected_caps = plan.capabilities

        missing_in_backend = expected_caps - backend_caps
        if missing_in_backend:
            raise ProductContractViolation(
                f"Plano '{plan_id}' divergiu: backend está sem as capabilities {sorted(missing_in_backend)}"
            )

        unexpected_in_backend = backend_caps - expected_caps
        if unexpected_in_backend:
            raise ProductContractViolation(
                f"Plano '{plan_id}' divergiu: backend possui capabilities não autorizadas no contrato: {sorted(unexpected_in_backend)}"
            )

        # 4. Preço e taxa no backend
        backend_price = SUBSCRIPTION_MONTHLY_PRICES.get(plan_id)
        if backend_price is None or backend_price != plan.price:
            raise ProductContractViolation(
                f"Plano '{plan_id}' divergiu no preço mensal: backend={backend_price}, contrato={plan.price}"
            )

        backend_rate = SUBSCRIPTION_MARKETPLACE_RATES.get(plan_id)
        if backend_rate is None or backend_rate != plan.split_fee_rate:
            raise ProductContractViolation(
                f"Plano '{plan_id}' divergiu na taxa de split: backend={backend_rate}, contrato={plan.split_fee_rate}"
            )


def parse_frontend_plan_features(source: str) -> dict[str, frozenset[str]]:
    """Extrai PLAN_FEATURES de src/config/subscriptionPlans.ts."""
    pattern = r"const\s+PLAN_FEATURES\s*:[^=]+=\s*\{([\s\S]*?)\n\};"
    match = re.search(pattern, source)
    if not match:
        raise ProductContractViolation("Não foi possível localizar 'const PLAN_FEATURES' em subscriptionPlans.ts")

    block = match.group(1)
    plan_features: dict[str, frozenset[str]] = {}

    for line in block.strip().split("\n"):
        line = line.strip().rstrip(",")
        if not line or ":" not in line:
            continue
        p_name, p_set = line.split(":", 1)
        p_name = p_name.strip()
        items = re.findall(r"'([^']+)'", p_set)
        plan_features[p_name] = frozenset(items)

    return plan_features


def parse_frontend_subscription_plans(source: str) -> dict[str, dict[str, Any]]:
    """Extrai SUBSCRIPTION_PLANS de src/config/subscriptionPlans.ts."""
    pattern = r"export\s+const\s+SUBSCRIPTION_PLANS:\s*SubscriptionPlan\[\]\s*=\s*\[(.*?)\n\];"
    match = re.search(pattern, source, re.DOTALL)
    if not match:
        raise ProductContractViolation("Não foi possível localizar 'SUBSCRIPTION_PLANS' em subscriptionPlans.ts")

    plans_block = match.group(1)
    plan_chunks = re.findall(r"\{\s*id:\s*'([^']+)'(.*?)\}", plans_block, re.DOTALL)
    result = {}
    for plan_id, chunk in plan_chunks:
        price_match = re.search(r"price:\s*([0-9.]+)", chunk)
        rate_match = re.search(r"splitFeeRate:\s*([0-9.]+)", chunk)
        if not price_match or not rate_match:
            continue
        result[plan_id] = {
            "price": Decimal(price_match.group(1)),
            "splitFeeRate": Decimal(rate_match.group(1)),
        }
    return result


def parse_frontend_comparison_matrix(source: str) -> list[dict[str, Any]]:
    """Extrai PLAN_COMPARISON_MATRIX de src/config/subscriptionPlans.ts."""
    pattern = r"export\s+const\s+PLAN_COMPARISON_MATRIX:\s*FeatureComparisonRow\[\]\s*=\s*\[(.*?)\n\];"
    match = re.search(pattern, source, re.DOTALL)
    if not match:
        raise ProductContractViolation("Não foi possível localizar 'PLAN_COMPARISON_MATRIX' em subscriptionPlans.ts")

    block = match.group(1)
    rows = []
    row_pattern = r"\{\s*category:\s*'([^']+)',\s*feature:\s*'([^']+)',\s*pocket:\s*([^,]+),\s*pro:\s*([^,]+),\s*premium:\s*([^ }]+)"
    for m in re.finditer(row_pattern, block):
        category, feature, pocket, pro, premium = m.groups()
        def parse_val(v: str) -> Any:
            v = v.strip().strip("'\"")
            if v == "true":
                return True
            if v == "false":
                return False
            return v

        rows.append({
            "category": category,
            "feature": feature,
            "pocket": parse_val(pocket),
            "pro": parse_val(pro),
            "premium": parse_val(premium),
        })
    return rows


def validate_frontend_against_contract(contract_data: dict[str, Any] | None = None) -> None:
    """Valida o catálogo estático frontend (subscriptionPlans.ts) contra o contrato canônico."""
    if not FRONTEND_CATALOG_PATH.exists():
        raise FileNotFoundError(f"Arquivo frontend não encontrado: {FRONTEND_CATALOG_PATH}")

    source = FRONTEND_CATALOG_PATH.read_text(encoding="utf-8")
    contract = contract_data or load_product_contract()
    contract_plans = get_contract_plans(contract)

    # 1. PLAN_FEATURES
    frontend_features = parse_frontend_plan_features(source)
    for plan_id, plan in contract_plans.items():
        if plan_id not in frontend_features:
            raise ProductContractViolation(
                f"Frontend PLAN_FEATURES não contém o plano '{plan_id}' definido no contrato"
            )
        f_caps = frontend_features[plan_id]
        expected_caps = plan.capabilities

        missing = expected_caps - f_caps
        if missing:
            raise ProductContractViolation(
                f"Frontend PLAN_FEATURES['{plan_id}'] está faltando capabilities: {sorted(missing)}"
            )

        unexpected = f_caps - expected_caps
        if unexpected:
            raise ProductContractViolation(
                f"Frontend PLAN_FEATURES['{plan_id}'] possui capabilities inesperadas: {sorted(unexpected)}"
            )

    # 2. SUBSCRIPTION_PLANS preços e splitFeeRate
    frontend_plans = parse_frontend_subscription_plans(source)
    for plan_id, plan in contract_plans.items():
        if plan_id not in frontend_plans:
            raise ProductContractViolation(
                f"Frontend SUBSCRIPTION_PLANS não contém o plano '{plan_id}'"
            )
        f_plan = frontend_plans[plan_id]
        if f_plan["price"] != plan.price:
            raise ProductContractViolation(
                f"Frontend SUBSCRIPTION_PLANS['{plan_id}'] divergiu no preço: "
                f"frontend={f_plan['price']}, contrato={plan.price}"
            )
        if f_plan["splitFeeRate"] != plan.split_fee_rate:
            raise ProductContractViolation(
                f"Frontend SUBSCRIPTION_PLANS['{plan_id}'] divergiu no splitFeeRate: "
                f"frontend={f_plan['splitFeeRate']}, contrato={plan.split_fee_rate}"
            )

    # 3. PLAN_COMPARISON_MATRIX vs commercial_comparison_rules
    matrix = parse_frontend_comparison_matrix(source)
    comparison_rules = contract.get("commercial_comparison_rules", [])

    for rule in comparison_rules:
        feature_name = rule["feature"]
        matching_rows = [r for r in matrix if r["feature"] == feature_name]
        if not matching_rows:
            raise ProductContractViolation(
                f"Feature comercial '{feature_name}' exigida pelo contrato não foi encontrada em PLAN_COMPARISON_MATRIX"
            )
        row = matching_rows[0]
        expected = rule["expected_by_plan"]
        for p in ("pocket", "pro", "premium"):
            if row[p] != expected[p]:
                raise ProductContractViolation(
                    f"PLAN_COMPARISON_MATRIX divergiu para feature '{feature_name}' no plano '{p}': "
                    f"declarado={row[p]}, contrato={expected[p]}"
                )


def validate_navigation_rules(contract_data: dict[str, Any] | None = None) -> None:
    """Valida que todas as regras de navegação utilizam capabilities conhecidas."""
    contract = contract_data or load_product_contract()
    known_caps = frozenset(contract.get("capabilities", {}).keys())
    nav_rules = contract.get("navigation_rules", {})

    for tab, cap in nav_rules.get("protected_tabs", {}).items():
        if cap not in known_caps:
            raise ProductContractViolation(
                f"Regra de navegação da tab '{tab}' referencia capability desconhecida: '{cap}'"
            )

    for subtab, cap in nav_rules.get("protected_subtabs", {}).items():
        if cap not in known_caps:
            raise ProductContractViolation(
                f"Regra de navegação da subtab '{subtab}' referencia capability desconhecida: '{cap}'"
            )

    if NAVIGATION_PATH.exists():
        nav_source = NAVIGATION_PATH.read_text(encoding="utf-8")
        required_features = set(re.findall(r"requiredFeature:\s*'([^']+)'", nav_source))
        invalid_features = required_features - known_caps
        if invalid_features:
            raise ProductContractViolation(
                f"cashierNavigation.ts possui requiredFeature não registrada no contrato: {sorted(invalid_features)}"
            )


def run_full_contract_validation() -> None:
    """Executa a validação completa de todas as superfícies contra o contrato canônico."""
    contract = load_product_contract()
    validate_backend_entitlements(contract)
    validate_frontend_against_contract(contract)
    validate_navigation_rules(contract)

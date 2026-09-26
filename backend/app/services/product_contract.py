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


def validate_frontend_against_contract(contract_data: dict[str, Any] | None = None) -> None:
    """Valida o catálogo frontend e a matriz canônica contra o contrato de produto."""
    if not FRONTEND_CATALOG_PATH.exists():
        raise FileNotFoundError(f"Arquivo frontend não encontrado: {FRONTEND_CATALOG_PATH}")

    source = FRONTEND_CATALOG_PATH.read_text(encoding="utf-8")
    if "product-contract.json" not in source:
        raise ProductContractViolation(
            "src/config/subscriptionPlans.ts deve importar product-contract.json como fonte única de verdade."
        )

    contract = contract_data or load_product_contract()
    matrix = contract.get("comparison_matrix", [])
    if not isinstance(matrix, list) or len(matrix) == 0:
        raise ProductContractViolation(
            "product-contract.json deve conter 'comparison_matrix' estruturada e não vazia."
        )

    # Valida integridade da comparison_matrix contra as regras canônicas de capability
    comparison_rules = contract.get("commercial_comparison_rules", [])
    for rule in comparison_rules:
        feature_name = rule["feature"]
        matching_rows = [r for r in matrix if r.get("feature") == feature_name]
        if not matching_rows:
            raise ProductContractViolation(
                f"Feature comercial '{feature_name}' exigida pelo contrato não foi encontrada em comparison_matrix"
            )
        row = matching_rows[0]
        expected = rule["expected_by_plan"]
        for p in ("pocket", "pro", "premium"):
            if row.get(p) != expected[p]:
                raise ProductContractViolation(
                    f"comparison_matrix divergiu para feature '{feature_name}' no plano '{p}': "
                    f"declarado={row.get(p)}, contrato={expected[p]}"
                )


def validate_navigation_rules(contract_data: dict[str, Any] | None = None) -> None:
    """Valida bidirecionalmente as regras de navegação contra capabilities conhecidas."""
    contract = contract_data or load_product_contract()
    known_caps = frozenset(contract.get("capabilities", {}).keys())
    nav_rules = contract.get("navigation_rules", {})

    protected_tabs = nav_rules.get("protected_tabs", {})
    for tab, cap in protected_tabs.items():
        if cap not in known_caps:
            raise ProductContractViolation(
                f"Regra de navegação da tab '{tab}' referencia capability desconhecida: '{cap}'"
            )

    protected_subtabs = nav_rules.get("protected_subtabs", {})
    for subtab, cap in protected_subtabs.items():
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

        # Validação bidirecional: cada tab protegida no contrato deve estar referenciada em cashierNavigation.ts
        for tab in protected_tabs:
            if f"tab: '{tab}'" not in nav_source and f"id: '{tab}'" not in nav_source:
                raise ProductContractViolation(
                    f"Tab protegida no contrato '{tab}' não foi encontrada em cashierNavigation.ts"
                )


def validate_endpoint_rules(contract_data: dict[str, Any] | None = None) -> None:
    """Valida que o catálogo executável de endpoint_rules está íntegro e aponta para capabilities canônicas."""
    contract = contract_data or load_product_contract()
    known_caps = frozenset(contract.get("capabilities", {}).keys())
    rules = contract.get("endpoint_rules", [])

    if not isinstance(rules, list) or len(rules) == 0:
        raise ProductContractViolation("endpoint_rules deve ser uma lista não vazia de regras executáveis.")

    for i, rule in enumerate(rules):
        cap = rule.get("capability")
        endpoint = rule.get("endpoint")
        method = rule.get("method")

        if not cap or cap not in known_caps:
            raise ProductContractViolation(
                f"Regra de endpoint #{i} referencia capability inválida ou ausente: '{cap}'"
            )
        if not endpoint or not endpoint.startswith("/"):
            raise ProductContractViolation(
                f"Regra de endpoint #{i} possui caminho inválido: '{endpoint}'"
            )
        if method not in ("GET", "POST", "PUT", "DELETE", "PATCH"):
            raise ProductContractViolation(
                f"Regra de endpoint #{i} possui método HTTP inválido: '{method}'"
            )


def run_full_contract_validation() -> None:
    """Executa a validação completa de todas as superfícies contra o contrato canônico."""
    contract = load_product_contract()
    validate_backend_entitlements(contract)
    validate_frontend_against_contract(contract)
    validate_navigation_rules(contract)
    validate_endpoint_rules(contract)


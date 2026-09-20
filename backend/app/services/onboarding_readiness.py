from __future__ import annotations

from typing import Any

from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from ..models import (
    Comanda,
    ConfiguracaoRestaurante,
    Mesa,
    Pagamento,
    Produto,
    RestaurantPaymentAccount,
    Restaurante,
)

ORDER_MODES = ("dine_in", "pickup", "delivery")
_MODE_TYPES = {
    "dine_in": ("Consumo no Local",),
    "pickup": ("Retirada",),
    "delivery": ("Entrega", "Delivery"),
}


def normalize_operation_capabilities(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    raw_modes = value.get("order_modes")
    if not isinstance(raw_modes, (list, tuple, set)):
        raw_modes = []
    modes = [mode for mode in ORDER_MODES if mode in {str(item).strip().lower() for item in raw_modes}]
    return {
        "order_modes": modes,
        "online_menu": bool(value.get("online_menu", False)),
        "service_tax": bool(value.get("service_tax", False)),
    }


def _legacy_capabilities(config: ConfiguracaoRestaurante, *, mercado_pago_connected: bool) -> dict[str, Any]:
    modes = ["pickup"]
    if config.mapa_mesas_ativo is not False:
        modes.insert(0, "dine_in")
    if config.delivery_ativo is not False:
        modes.append("delivery")
    return {
        "order_modes": modes,
        "online_menu": mercado_pago_connected,
        "service_tax": bool(config.taxa_servico_ativa),
    }


def _has_contact_or_address(restaurant: Restaurante) -> bool:
    if str(restaurant.endereco or "").strip():
        return True
    socials = restaurant.socials if isinstance(restaurant.socials, dict) else {}
    return bool(str(socials.get("whatsapp") or socials.get("telefone") or "").strip())


def _delivery_ready(config: ConfiguracaoRestaurante, restaurant: Restaurante) -> tuple[bool, str]:
    if config.delivery_ativo is False:
        return False, "Ative a entrega nas configurações."
    if not str(restaurant.endereco or "").strip():
        return False, "Informe o endereço do restaurante para operar delivery."

    fee_type = str(config.tipo_taxa_entrega or "fixa").strip().lower()
    if fee_type == "fixa":
        value = config.taxa_entrega_fixa
        return (value is not None and float(value) >= 0), "Configure uma taxa fixa de entrega válida."
    if fee_type == "bairro":
        ready = isinstance(config.tabela_taxas_bairros, list) and len(config.tabela_taxas_bairros) > 0
        return ready, "Cadastre ao menos um bairro atendido e sua taxa."
    if fee_type == "distancia":
        has_origin = restaurant.latitude is not None and restaurant.longitude is not None
        has_table = isinstance(config.tabela_taxas_km, list) and len(config.tabela_taxas_km) > 0
        return has_origin and has_table, "Configure a origem e as faixas de taxa por distância."
    return False, "Escolha uma política de taxa de entrega suportada."


def _completed_paid_test_order(db: Session, tenant_id: int, modes: list[str]) -> bool:
    allowed_types = tuple(
        value
        for mode in modes
        for value in _MODE_TYPES.get(mode, ())
    )
    if not allowed_types:
        return False
    row = (
        db.query(Comanda.id)
        .join(
            Pagamento,
            and_(
                Pagamento.restaurante_id == Comanda.restaurante_id,
                Pagamento.comanda_id == Comanda.id,
            ),
        )
        .filter(
            Comanda.restaurante_id == tenant_id,
            Comanda.fechada.is_(True),
            Comanda.tipo.in_(allowed_types),
            Pagamento.status == "aprovado",
        )
        .first()
    )
    return row is not None


def evaluate_operational_readiness(
    db: Session,
    *,
    tenant_id: int,
    restaurant: Restaurante,
    config: ConfiguracaoRestaurante,
) -> dict[str, Any]:
    active_products = int(
        db.query(func.count(Produto.id))
        .filter(
            Produto.restaurante_id == tenant_id,
            Produto.ativo.is_(True),
        )
        .scalar()
        or 0
    )
    table_count = int(
        db.query(func.count(Mesa.id))
        .filter(Mesa.restaurante_id == tenant_id)
        .scalar()
        or 0
    )
    payment_account = (
        db.query(RestaurantPaymentAccount)
        .filter(
            RestaurantPaymentAccount.restaurante_id == tenant_id,
            RestaurantPaymentAccount.provider == "mercado_pago",
            RestaurantPaymentAccount.status == "active",
        )
        .first()
    )
    mercado_pago_connected = bool(
        payment_account
        and payment_account.access_token
        and payment_account.webhook_secret
    )

    capabilities = normalize_operation_capabilities(config.operation_capabilities)
    if capabilities is None and config.operation_started_at is not None:
        capabilities = _legacy_capabilities(config, mercado_pago_connected=mercado_pago_connected)

    modes = list((capabilities or {}).get("order_modes") or [])
    profile_ready = _has_contact_or_address(restaurant)
    hours_ready = bool(restaurant.horarios_funcionamento) if isinstance(
        restaurant.horarios_funcionamento, (list, tuple, set, dict)
    ) else bool(str(restaurant.horarios_funcionamento or "").strip())

    checks: list[dict[str, Any]] = [
        {
            "id": "profile",
            "label": "Contato ou endereço do restaurante",
            "ok": profile_ready,
            "required": True,
            "message": None if profile_ready else "Informe um endereço ou WhatsApp de contato.",
        },
        {
            "id": "hours",
            "label": "Horários de funcionamento",
            "ok": hours_ready,
            "required": True,
            "message": None if hours_ready else "Defina os horários de funcionamento.",
        },
        {
            "id": "catalog",
            "label": "Produto publicado",
            "ok": active_products > 0,
            "required": True,
            "message": None if active_products > 0 else "Publique ao menos um produto ativo.",
        },
        {
            "id": "order_modes",
            "label": "Tipos de pedido",
            "ok": bool(modes),
            "required": True,
            "message": None if modes else "Escolha ao menos um tipo de pedido.",
        },
    ]

    if "dine_in" in modes:
        checks.append({
            "id": "dine_in",
            "label": "Salão",
            "ok": table_count > 0,
            "required": True,
            "message": None if table_count > 0 else "Cadastre ao menos uma mesa para operar salão.",
        })
    if "delivery" in modes:
        delivery_ok, delivery_message = _delivery_ready(config, restaurant)
        checks.append({
            "id": "delivery",
            "label": "Delivery",
            "ok": delivery_ok,
            "required": True,
            "message": None if delivery_ok else delivery_message,
        })
    if capabilities and capabilities["online_menu"]:
        checks.append({
            "id": "online_menu",
            "label": "Cardápio online",
            "ok": mercado_pago_connected,
            "required": True,
            "message": None if mercado_pago_connected else "Conecte o Mercado Pago para ativar o cardápio online.",
        })
    if capabilities and capabilities["service_tax"]:
        service_tax = config.taxa_servico_padrao
        service_tax_ok = service_tax is not None and 0 < float(service_tax) <= 100
        checks.append({
            "id": "service_tax",
            "label": "Taxa de serviço",
            "ok": service_tax_ok,
            "required": True,
            "message": None if service_tax_ok else "Defina uma taxa de serviço entre 0 e 100%.",
        })

    configuration_complete = all(check["ok"] for check in checks if check["required"])
    operation_started = config.operation_started_at is not None
    test_order_complete = _completed_paid_test_order(db, tenant_id, modes) if operation_started else False

    return {
        "capabilities": capabilities,
        "configuration": {
            "complete": configuration_complete,
            "checks": checks,
        },
        "operation": {
            "started": operation_started,
            "startedAt": config.operation_started_at.isoformat() if config.operation_started_at else None,
        },
        "readiness": {
            "ready": bool(operation_started and configuration_complete and test_order_complete),
            "testOrderComplete": test_order_complete,
            "checks": [
                {
                    "id": "configuration",
                    "label": "Configuração concluída",
                    "ok": configuration_complete,
                },
                {
                    "id": "test_order",
                    "label": "Pedido de teste pago e concluído",
                    "ok": test_order_complete,
                },
            ],
        },
        "payments": {"mercadoPagoConnected": mercado_pago_connected},
        "counts": {
            "activeProducts": active_products,
            "tables": table_count,
        },
    }

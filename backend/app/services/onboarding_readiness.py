from __future__ import annotations

import datetime
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
from .operational_modes import explicit_order_types


_MODE_TYPES = {
    "consumo_local": ("Consumo no Local",),
    "retirada": ("Retirada",),
    "delivery": ("Entrega", "Delivery"),
}


def _structured_has_items(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) > 0
    return bool(str(value).strip())


def _profile_is_configured(restaurant: Restaurante) -> bool:
    if str(restaurant.endereco or "").strip():
        return True
    socials = restaurant.socials if isinstance(restaurant.socials, dict) else {}
    return bool(str(socials.get("whatsapp") or socials.get("telefone") or "").strip())


def _delivery_is_configured(
    config: ConfiguracaoRestaurante | None,
    restaurant: Restaurante,
) -> bool:
    if config is None or not str(restaurant.endereco or "").strip():
        return False
    mode = str(config.tipo_taxa_entrega or "fixa").strip().lower()
    if mode == "fixa":
        try:
            return config.taxa_entrega_fixa is not None and float(config.taxa_entrega_fixa) >= 0
        except (TypeError, ValueError):
            return False
    if mode == "bairro":
        return _structured_has_items(config.tabela_taxas_bairros)
    if mode == "distancia":
        return (
            _structured_has_items(config.tabela_taxas_km)
            and restaurant.latitude is not None
            and restaurant.longitude is not None
        )
    return False


def _completed_explicit_test_order(
    db: Session,
    *,
    tenant_id: int,
    order_types: list[str],
    trial_started_at: datetime.datetime,
) -> bool:
    allowed_types = tuple(
        legacy_type
        for order_type in order_types
        for legacy_type in _MODE_TYPES.get(order_type, ())
    )
    if not allowed_types:
        return False

    return (
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
            Comanda.onboarding_test.is_(True),
            Comanda.criado_em >= trial_started_at,
            Comanda.fechada.is_(True),
            Comanda.tipo.in_(allowed_types),
            Pagamento.restaurante_id == tenant_id,
            Pagamento.status == "aprovado",
            Pagamento.valor > 0,
        )
        .first()
        is not None
    )


def evaluate_onboarding_readiness(
    db: Session,
    *,
    tenant_id: int,
    restaurant: Restaurante,
    config: ConfiguracaoRestaurante | None,
    setup_pending: bool,
    trial_started_at: datetime.datetime | None,
) -> dict[str, Any]:
    configured_order_types = explicit_order_types(config)
    legacy_policy = configured_order_types is None and not setup_pending
    order_types = list(configured_order_types or [])

    product_count = int(
        db.query(func.count(Produto.id))
        .filter(Produto.restaurante_id == tenant_id)
        .scalar()
        or 0
    )
    active_product_count = int(
        db.query(func.count(Produto.id))
        .filter(
            Produto.restaurante_id == tenant_id,
            Produto.ativo.is_(True),
        )
        .scalar()
        or 0
    )
    order_count = int(
        db.query(func.count(Comanda.id))
        .filter(Comanda.restaurante_id == tenant_id)
        .scalar()
        or 0
    )
    table_count = int(
        db.query(func.count(Mesa.pk))
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

    dine_in_enabled = "consumo_local" in order_types
    pickup_enabled = "retirada" in order_types
    delivery_enabled = "delivery" in order_types
    table_map_enabled = bool(config and config.mapa_mesas_ativo)

    operation_blockers: list[str] = []
    if configured_order_types is None and not legacy_policy:
        operation_blockers.append("order_types")
    if configured_order_types == []:
        operation_blockers.append("order_types")
    if dine_in_enabled and table_map_enabled and table_count <= 0:
        operation_blockers.append("dine_in_tables")
    if delivery_enabled and not _delivery_is_configured(config, restaurant):
        operation_blockers.append("delivery_configuration")

    service_charge_enabled = bool(config and config.taxa_servico_ativa)
    try:
        service_charge_percent = float(config.taxa_servico_padrao or 0) if config else 0.0
    except (TypeError, ValueError):
        service_charge_percent = 0.0
    service_charge_ready = (
        not service_charge_enabled
        or 0 < service_charge_percent <= 100
    )
    if not service_charge_ready:
        operation_blockers.append("service_charge")

    operations_configured = legacy_policy or bool(configured_order_types)
    operations_ready = operations_configured and not operation_blockers

    steps = {
        "profile": _profile_is_configured(restaurant),
        "hours": _structured_has_items(restaurant.horarios_funcionamento),
        "catalog": active_product_count > 0,
        "operations": operations_ready,
        "mercadoPago": mercado_pago_connected,
        "firstOrder": False,
    }
    required_ids = ("profile", "hours", "catalog", "operations")
    completed = sum(1 for step_id in required_ids if steps[step_id])
    progress = {
        "completed": completed,
        "total": len(required_ids),
        "percent": round((completed / len(required_ids)) * 100),
    }
    configuration_complete = completed == len(required_ids)
    trial_started = trial_started_at is not None

    if legacy_policy:
        test_order_complete = trial_started
    elif trial_started and configured_order_types:
        test_order_complete = _completed_explicit_test_order(
            db,
            tenant_id=tenant_id,
            order_types=order_types,
            trial_started_at=trial_started_at,
        )
    else:
        test_order_complete = False

    steps["firstOrder"] = test_order_complete
    ready_to_operate = bool(
        configuration_complete
        and trial_started
        and test_order_complete
    )

    blockers = [
        step_id
        for step_id in required_ids
        if not steps[step_id]
    ]
    if configuration_complete and not trial_started:
        blockers.append("trial_not_started")
    if configuration_complete and trial_started and not test_order_complete:
        blockers.append("test_order")

    if ready_to_operate:
        state = "ready"
    elif not configuration_complete:
        state = "configuration"
    elif not trial_started:
        state = "awaiting_trial"
    else:
        state = "validation"

    return {
        "payments": {
            "mercadoPagoConnected": mercado_pago_connected,
            "pixOnlineAvailable": mercado_pago_connected,
        },
        "counts": {
            "products": product_count,
            "activeProducts": active_product_count,
            "orders": order_count,
            "tables": table_count,
        },
        "operations": {
            "configured": operations_configured,
            "legacyPolicy": legacy_policy,
            "ready": operations_ready,
            "orderTypes": order_types,
            "tableMapEnabled": table_map_enabled,
            "serviceChargeEnabled": service_charge_enabled,
            "serviceChargePercent": service_charge_percent,
            "capabilities": {
                "dineIn": {
                    "enabled": dine_in_enabled,
                    "ready": not dine_in_enabled or not table_map_enabled or table_count > 0,
                },
                "pickup": {
                    "enabled": pickup_enabled,
                    "ready": True,
                },
                "delivery": {
                    "enabled": delivery_enabled,
                    "ready": not delivery_enabled or _delivery_is_configured(config, restaurant),
                },
                "onlinePayment": {
                    "enabled": mercado_pago_connected,
                    "ready": True,
                    "provider": "mercado_pago",
                },
            },
            "blockers": operation_blockers,
        },
        "steps": steps,
        "progress": progress,
        "readiness": {
            "configurationComplete": configuration_complete,
            "trialStarted": trial_started,
            "testOrderComplete": test_order_complete,
            "readyToOperate": ready_to_operate,
            "state": state,
            "blockers": blockers,
        },
    }

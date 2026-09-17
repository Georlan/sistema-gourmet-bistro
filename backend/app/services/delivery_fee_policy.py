"""Validação canônica das políticas simples de taxa de entrega."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Sequence


MAX_DELIVERY_FEE = Decimal("10000.00")


def normalize_neighborhood(value: object) -> str:
    return " ".join(str(value or "").strip().split()).casefold()


def validate_delivery_fee(value: object) -> Decimal:
    try:
        fee = Decimal(str(value)).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError("A taxa de entrega configurada é inválida.") from None
    if not fee.is_finite() or fee < 0 or fee > MAX_DELIVERY_FEE:
        raise ValueError("A taxa de entrega configurada é inválida.")
    return fee


def normalize_neighborhood_fee_table(raw: Sequence[object] | object) -> tuple[dict, ...]:
    if not isinstance(raw, (list, tuple)):
        raise ValueError("A tabela de taxas por bairro é inválida.")

    normalized: list[dict] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("A tabela de taxas por bairro é inválida.")
        display_name = " ".join(str(item.get("bairro") or "").strip().split())
        key = normalize_neighborhood(display_name)
        if not key or len(display_name) > 120:
            raise ValueError("A tabela de taxas por bairro é inválida.")
        if key in seen:
            raise ValueError(f"O bairro '{display_name}' está duplicado na tabela de entrega.")
        seen.add(key)
        normalized.append({"bairro": display_name, "taxa": float(validate_delivery_fee(item.get("taxa")))})
    if not normalized:
        raise ValueError("Cadastre pelo menos um bairro para usar a cobrança por bairro.")
    return tuple(normalized)

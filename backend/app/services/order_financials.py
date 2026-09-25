from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

from ..models import Comanda


_CENT = Decimal("0.01")
_DIGITAL_FULFILLMENT_TYPES = {
    "delivery",
    "entrega",
    "retirada",
    "viagem",
    "balcao",
    "balcão",
}


def money(value: object) -> Decimal:
    return Decimal(str(value or 0)).quantize(_CENT, rounding=ROUND_HALF_UP)


def active_items_subtotal(comanda: Comanda) -> Decimal:
    return money(sum(
        Decimal(str(item.preco_unit or 0))
        for item in (comanda.itens or [])
        if item.status != "cancelado"
    ))


def discount_total(comanda: Comanda) -> Decimal:
    return money(
        money(getattr(comanda, "valor_desconto_cupom", 0))
        + money(getattr(comanda, "valor_desconto_cashback", 0))
    )


def payable_total(comanda: Comanda) -> Decimal:
    """Total monetário canônico do pedido, independente do estado de fulfillment."""
    total = (
        active_items_subtotal(comanda)
        + money(getattr(comanda, "delivery_taxa", 0))
        - discount_total(comanda)
    )
    return max(Decimal("0.00"), money(total))


def open_balance(comanda: Comanda) -> Decimal:
    return max(
        Decimal("0.00"),
        money(payable_total(comanda) - money(getattr(comanda, "valor_pago", 0))),
    )


def has_operational_fulfillment(comanda: Comanda) -> bool:
    """Pedido digital/operacional cuja quitação não deve encerrar o fulfillment sozinha."""
    if getattr(comanda, "delivery_status", None) is not None:
        return True
    return str(getattr(comanda, "tipo", "") or "").strip().casefold() in _DIGITAL_FULFILLMENT_TYPES

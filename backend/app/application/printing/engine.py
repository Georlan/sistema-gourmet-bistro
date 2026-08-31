from __future__ import annotations

from enum import Enum


class PrintEngineType(str, Enum):
    """Motor semântico selecionado antes da geração do documento.

    A origem HTTP/canal não escolhe formatter. O Core resolve a natureza da
    impressão e só então executa o motor correspondente.
    """

    DINE_IN_ORDER = "pedido_local"
    PICKUP_ORDER = "pedido_retirada"
    DELIVERY_ORDER = "pedido_delivery"
    TABLE_RECEIPT = "extrato_mesa"
    CASH_CLOSING = "fechamento_caixa"


def resolve_order_engine(order_type: object) -> PrintEngineType:
    normalized = str(order_type or "").strip().casefold()
    if normalized in {"retirada", "viagem", "balcao", "balcão"}:
        return PrintEngineType.PICKUP_ORDER
    if normalized in {"delivery", "entrega"}:
        return PrintEngineType.DELIVERY_ORDER
    return PrintEngineType.DINE_IN_ORDER

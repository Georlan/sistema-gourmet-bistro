from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional


class PrintSourceType(str, Enum):
    ORDER = "pedido"
    ITEM = "item"
    TABLE = "mesa"
    CASH_SHIFT = "caixa_turno"


class PrintAction(str, Enum):
    PRINT = "imprimir"
    REPRINT = "reimprimir"
    RECEIPT = "extrato"
    CLOSING = "fechamento"
    DISPATCH = "despacho"
    ITEM_CHANGE = "alteracao_item"


class PrintTrigger(str, Enum):
    """Distingue política automática da solicitação explícita do operador."""

    MANUAL = "manual"
    AUTOMATIC = "automatico"


@dataclass(frozen=True)
class PrintIntent:
    """Comando canônico de impressão independente da borda que o originou.

    A borda informa apenas origem, ação e gatilho. Motor, política, snapshot,
    formatter, destino físico e PrintJob pertencem ao Core de Impressão.
    """

    restaurant_id: int
    source_type: PrintSourceType
    source_id: str
    action: PrintAction = PrintAction.PRINT
    trigger: PrintTrigger = PrintTrigger.MANUAL
    table_id: Optional[int] = None
    values_only: bool = False
    requested_by: Optional[str] = None
    courier_name: Optional[str] = None
    quantity_added: int = 0
    idempotency_key: Optional[str] = None

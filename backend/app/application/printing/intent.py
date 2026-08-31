from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional


class PrintSourceType(str, Enum):
    ORDER = "pedido"
    TABLE = "mesa"
    CASH_SHIFT = "caixa_turno"


class PrintAction(str, Enum):
    PRINT = "imprimir"
    REPRINT = "reimprimir"
    RECEIPT = "extrato"
    CLOSING = "fechamento"


@dataclass(frozen=True)
class PrintIntent:
    """Pedido canônico de impressão independente da rota que o originou.

    A borda informa somente a origem e a intenção. Política, snapshot,
    formatter, destino físico e PrintJob pertencem ao Core de Impressão.
    """

    restaurant_id: int
    source_type: PrintSourceType
    source_id: str
    action: PrintAction = PrintAction.PRINT
    table_id: Optional[int] = None
    values_only: bool = False
    requested_by: Optional[str] = None
    idempotency_key: Optional[str] = None

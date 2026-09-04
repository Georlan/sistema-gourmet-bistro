"""Core de Aplicação de Impressão do Kôma."""

from .engine import PrintEngineType, resolve_order_engine
from .intent import PrintAction, PrintIntent, PrintSourceType, PrintTrigger
from .service import (
    PrintingApplicationService as _OrderPrintingApplicationService,
    UniversalPrintingError,
)
from .item_change import ItemChangePrintingService


class PrintingApplicationService(_OrderPrintingApplicationService):
    """Entrada única do Core, incluindo documentos delta de item."""

    @classmethod
    def request_print(cls, db, intent: PrintIntent):
        if intent.source_type == PrintSourceType.ITEM:
            return ItemChangePrintingService.request_print(db, intent)
        return super().request_print(db, intent)


__all__ = [
    "PrintAction",
    "PrintEngineType",
    "PrintIntent",
    "PrintSourceType",
    "PrintTrigger",
    "PrintingApplicationService",
    "UniversalPrintingError",
    "resolve_order_engine",
]

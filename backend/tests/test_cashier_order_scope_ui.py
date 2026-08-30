from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[2]


def _caixa_source() -> str:
    return (ROOT / "src/components/CaixaPanel.tsx").read_text(encoding="utf-8")


def test_cashier_card_cancellation_keeps_item_scope():
    panel = _caixa_source()
    source = (ROOT / "src/components/caixa/orders/useCashierOrders.ts").read_text(encoding="utf-8")
    details = (ROOT / "src/components/caixa/orders/KanbanOrderDetails.tsx").read_text(encoding="utf-8")

    assert "const openCancelOrderConfirmation" in source
    assert "item_ids: cancelConsumptionTarget.itemIds" in source
    assert "'cancelar-itens' : 'cancelar-consumo'" in source
    assert "useCashierOrders(" in panel
    assert "<KanbanOrderDetails" in panel
    assert "./caixa/orders/KanbanOrderDetails" in panel
    assert "Cancelar somente este pedido" in details
    assert "Os demais pedidos da mesa foram preservados" in source


def test_whole_table_cancellation_and_transfer_are_salon_context_actions():
    source = _caixa_source()
    owner = (ROOT / "src/components/caixa/orders/useCashierOrders.ts").read_text(encoding="utf-8")
    details = (ROOT / "src/components/caixa/orders/KanbanOrderDetails.tsx").read_text(encoding="utf-8")

    assert "contextoSalao: true" in owner
    assert "projectionScope: 'table'" in owner
    assert "useCashierOrders(" in source
    assert re.search(r"selectedKanbanOrder\.contextoSalao\s+\?\s+openCancelTableConfirmation", owner)
    assert ": openCancelOrderConfirmation(selectedKanbanOrder)" in owner
    assert "cancelConsumption: handleCancelSelectedKanbanConsumption" in source
    assert "Cancelar toda a mesa e liberar" in details
    assert "handleTransferTableFromSalon" in owner
    assert "handleTransferSelectedKanbanTable" in source
    assert "Transferir para…" in details
    assert "<CaixaSalonTab" in source
    assert "./caixa/salao/CaixaSalonTab" in source

from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[2]


def _caixa_source() -> str:
    return (ROOT / "src/components/CaixaPanel.tsx").read_text(encoding="utf-8")


def test_cashier_card_cancellation_keeps_item_scope():
    source = _caixa_source()
    details = (ROOT / "src/components/caixa/orders/KanbanOrderDetails.tsx").read_text(encoding="utf-8")

    assert "const openCancelOrderConfirmation" in source
    assert "item_ids: cancelConsumptionTarget.itemIds" in source
    assert "'cancelar-itens' : 'cancelar-consumo'" in source
    assert "<KanbanOrderDetails" in source
    assert "./caixa/orders/KanbanOrderDetails" in source
    assert "Cancelar somente este pedido" in details
    assert "Os demais pedidos da mesa foram preservados" in source


def test_whole_table_cancellation_and_transfer_are_salon_context_actions():
    source = _caixa_source()
    details = (ROOT / "src/components/caixa/orders/KanbanOrderDetails.tsx").read_text(encoding="utf-8")

    assert "contextoSalao: true" in source
    assert "projectionScope: 'table'" in source
    assert re.search(r"selectedKanbanOrder\.contextoSalao\s+\?\s+openCancelTableConfirmation", source)
    assert ": openCancelOrderConfirmation(selectedKanbanOrder)" in source
    assert "Cancelar toda a mesa e liberar" in details
    assert "handleTransferTableFromSalon" in source
    assert "Transferir para…" in details
    assert "<CaixaSalonTab" in source
    assert "./caixa/salao/CaixaSalonTab" in source

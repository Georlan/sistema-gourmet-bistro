from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _caixa_source() -> str:
    return (ROOT / "src/components/CaixaPanel.tsx").read_text(encoding="utf-8")


def test_cashier_card_cancellation_keeps_item_scope():
    source = _caixa_source()

    assert "const openCancelOrderConfirmation" in source
    assert "item_ids: cancelConsumptionTarget.itemIds" in source
    assert "'cancelar-itens' : 'cancelar-consumo'" in source
    assert "Cancelar somente este pedido" in source
    assert "Os demais pedidos da mesa foram preservados" in source


def test_whole_table_cancellation_and_transfer_are_salon_context_actions():
    source = _caixa_source()

    assert "contextoSalao: true" in source
    assert "selectedKanbanOrder.contextoSalao\n                        ? openCancelTableConfirmation" in source
    assert "Cancelar toda a mesa e liberar" in source
    assert "handleTransferTableFromSalon" in source
    assert "Transferir para…" in source

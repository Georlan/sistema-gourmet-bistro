from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_blocked_customer_is_intercepted_before_review_submission_ui():
    checkout = (ROOT / "src/cardapio/components/CardapioDigital.tsx").read_text(encoding="utf-8")
    block = (ROOT / "src/cardapio/orderingBlock.ts").read_text(encoding="utf-8")

    assert "resolveOrderingBlockForCurrentSession(activeBrand.id, API_BASE_URL)" in checkout
    assert "Novos pedidos bloqueados" in checkout
    assert "Motivo informado pelo restaurante" in checkout
    assert "Sem liberação automática" in checkout
    assert "if (checkingOrderingBlock || orderingBlock)" in checkout
    assert "BLOCKED_ORDER_GENERIC_DETAIL" in checkout
    assert "/api/cardapio/pedidos/acompanhar/" in block
    assert "loadStoredOrders(rid)" in block


def test_rejected_order_details_open_the_readable_history_directly():
    drawer = (ROOT / "src/cardapio/components/CardapioOrdersDrawer.tsx").read_text(encoding="utf-8")
    chat = (ROOT / "src/cardapio/components/CardapioOrderChatPanel.tsx").read_text(encoding="utf-8")

    assert "Ver motivo da recusa" in drawer
    assert "rejected && hasTracking" in drawer
    assert "onClick={() => openChat(order.id)}" in drawer
    assert "CardapioOrderChatPanel" in drawer
    assert "messages.map((message)" in chat
    assert "whitespace-pre-wrap break-words" in chat

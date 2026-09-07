from pathlib import Path


def test_tracking_payload_exposes_item_price_and_close_timestamp():
    source = Path("backend/app/routes/order_tracking.py").read_text(encoding="utf-8")

    assert '"preco_unitario": float(it.preco_unit or 0.0)' in source
    assert 'if it.status != "cancelado"' in source
    assert '"closed_at": closed_at_iso' in source


def test_tracking_payload_keeps_closed_at_compatible_in_conversation_block():
    source = Path("backend/app/routes/order_tracking.py").read_text(encoding="utf-8")

    assert '"conversa": {' in source
    assert source.count('"closed_at": closed_at_iso') >= 2

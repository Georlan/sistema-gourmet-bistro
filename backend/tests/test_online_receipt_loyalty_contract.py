from pathlib import Path


def _source(relative: str) -> str:
    return (Path(__file__).resolve().parents[1] / relative).read_text(encoding="utf-8")


def test_cashback_loyalty_is_conditional_and_brand_footer_is_emphasized():
    renderer = _source("app/application/printing/comanda_renderer.py")
    service = _source("app/application/printing/service.py")

    assert "loyalty_previous_orders: Optional[int] = None" in renderer
    assert "float(variant.cashback_discount or 0.0) > 0" in renderer
    assert "variant.loyalty_previous_orders is not None" in renderer
    assert "FIDELIDADE:" in renderer
    assert "DESCONTO CASHBACK:" in renderer
    assert 'ESC_BOLD_ON + f"FORMA: {payment_label}" + ESC_BOLD_OFF' in renderer
    assert 'ESC_BOLD_ON + "Kôma" + ESC_BOLD_OFF' in renderer

    assert "load_customer_relationship_metrics(" in service
    assert "comanda.cliente_id" in service
    assert "float(comanda.valor_desconto_cashback or 0.0) > 0" in service
    assert "loyalty_previous_orders = relationship.pedidos_concluidos" in service

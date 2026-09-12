from pathlib import Path


def _source(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def test_extreme_waiter_print_uses_canonical_receipt_without_real_order():
    source = _source("backend/app/routes/printing.py")

    assert '"/teste-extremo-garcom"' in source
    assert 'order_type="Consumo no Local"' in source
    assert 'operator_label="GARÇOM"' in source
    assert "table_id=99" in source
    assert "preserve_item_customers=True" in source
    assert 'source_type="teste_extremo_garcom"' in source
    assert 'print_footer="TESTE DE IMPRESSÃO GARÇOM — NÃO É PEDIDO REAL"' in source
    assert 'status="pending"' in source


def test_extreme_waiter_print_is_exposed_as_a_separate_homologation_action():
    source = _source("src/components/caixa/settings/CashierPrintingSettings.tsx")

    assert "/impressao/teste-extremo-garcom" in source
    assert "Teste extremo — Garçom" in source
    assert "sem criar pedido real, estoque ou movimento de caixa" in source

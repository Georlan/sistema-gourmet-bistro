from app.domain.printing import (
    PrintItem,
    group_items_by_print_destination,
    is_production_destination,
)


def test_destino_nenhum_nunca_gera_via_setorial():
    assert is_production_destination("NENHUM") is False
    assert is_production_destination("nenhum") is False
    assert is_production_destination("") is False
    assert is_production_destination(None) is False
    assert is_production_destination("COZINHA") is True
    assert is_production_destination("BAR") is True


def test_grouping_preserves_only_active_sector_destinations():
    cozinha = PrintItem(codigo="01", nome="Burger", destino_impressao="cozinha")
    bar = PrintItem(codigo="02", nome="Drink", destino_impressao="BAR")
    silent = PrintItem(codigo="03", nome="Água", destino_impressao="NENHUM")

    grouped = group_items_by_print_destination([cozinha, bar, silent])

    assert list(grouped) == ["COZINHA", "BAR"]
    assert grouped["COZINHA"] == [cozinha]
    assert grouped["BAR"] == [bar]

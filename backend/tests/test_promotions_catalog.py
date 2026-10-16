from dataclasses import replace
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.promotions import active_promotions, apply_promotion_to_validated
from app.domain.orders.validation import ValidatedOrderInput, ValidatedOrderItem, ValidatedModifier
from app.domain.orders.types import FulfillmentType
from app.domain.orders.errors import OrderValidationError


def _item(product_id, price, extra="0"):
    return ValidatedOrderItem(
        product_id=product_id, name=product_id, base_price=Decimal(price), quantity=Decimal("1"),
        modifiers=(ValidatedModifier(id="extra", name="Adicional", price=Decimal(extra)),) if extra != "0" else (),
    )


def _validated(*items):
    return ValidatedOrderInput(
        restaurant_id=6, fulfillment=FulfillmentType.PICKUP, items=tuple(items),
    )


def _campaign():
    return {
        "id": "promo-gm", "nome": "G + M", "preco": 22.0,
        "componentes": [["g"], ["m"]], "ativo": True,
    }


def test_promocao_distribui_desconto_sem_alterar_produtos_ou_adicionais():
    original = _validated(_item("g", "14", "3"), _item("m", "10", "2"))
    result = apply_promotion_to_validated(original, _campaign())
    assert result.items[0].base_price == Decimal("12.00")
    assert result.items[1].base_price == Decimal("10")
    assert [item.product_id for item in result.items] == ["g", "m"]
    assert sum(m.price for item in result.items for m in item.modifiers) == Decimal("5")
    assert sum(item.base_price + sum(m.price for m in item.modifiers) for item in result.items) == Decimal("27")
    assert original.items[0].base_price == Decimal("14")


def test_faltando_componente_e_duplicacao_falham_fechado():
    for case in (
        _validated(_item("g", "14")),
        _validated(_item("g", "14"), _item("g", "14"), _item("m", "10")),
    ):
        with pytest.raises(OrderValidationError):
            apply_promotion_to_validated(case, _campaign())


def test_pausa_falha_e_preco_independente_e_aceito():
    v = _validated(_item("g", "14"), _item("m", "10"))
    with pytest.raises(OrderValidationError):
        apply_promotion_to_validated(v, {**_campaign(), "ativo": False})
    result = apply_promotion_to_validated(v, {**_campaign(), "preco": 30})
    assert sum(item.base_price for item in result.items) == Decimal("30.00")


def test_bebida_alternativa_usa_produto_real():
    promo = {**_campaign(), "id": "promo-gbebida", "preco": 16, "componentes": [["g"], ["pitulinha", "sukita"]]}
    output = apply_promotion_to_validated(_validated(_item("g", "14"), _item("sukita", "3")), promo)
    assert [item.product_id for item in output.items] == ["g", "sukita"]
    assert sum(it.base_price for it in output.items) == Decimal("16.00")


def test_publicacao_somente_com_componentes_ativos():
    g = SimpleNamespace(id="g", ativo=True)
    m = SimpleNamespace(id="m", ativo=True)
    cfg = SimpleNamespace(promocoes=[_campaign()])
    assert len(active_promotions(cfg, [g, m])) == 1
    assert active_promotions(cfg, [g, SimpleNamespace(id="m", ativo=False)]) == []
    assert active_promotions(SimpleNamespace(promocoes=[{**_campaign(), "ativo": False}]), [g, m]) == []



def test_pitulinha_preco_simbolico_um_real_combo_dezesseis_revalida_no_servidor():
    promo = {
        "id": "promo-g-pitulinha", "nome": "G + Pitulinha", "preco": 16.0,
        "componentes": [["g"], ["pitulinha"]], "ativo": True,
    }
    original = _validated(_item("g", "14", "2"), _item("pitulinha", "1"))
    result = apply_promotion_to_validated(
        original, promo, exclusive_ids={"pitulinha"},
    )
    assert result.items[0].base_price == Decimal("14")
    assert result.items[1].base_price == Decimal("2.00")
    assert sum(
        (item.base_price + sum(mod.price for mod in item.modifiers))
        for item in result.items
    ) == Decimal("18.00")
    assert original.items[1].base_price == Decimal("1")


def test_preco_independente_nao_exige_componente_exclusivo():
    promo = {**_campaign(), "preco": 25}
    for exclusive in (set(), {"pitulinha"}):
        original = _validated(_item("g", "14", "3"), _item("m", "10"))
        result = apply_promotion_to_validated(original, promo, exclusive_ids=exclusive)
        assert sum(item.base_price for item in result.items) == Decimal("25.00")
        assert result.items[0].modifiers[0].price == Decimal("3")
        assert original.items[0].base_price == Decimal("14")


def test_pitulinha_pausada_ou_faltando_nunca_recebe_preco_de_combo():
    promo = {
        "id": "promo-g-pitulinha", "nome": "G + Pitulinha", "preco": 16.0,
        "componentes": [["g"], ["pitulinha"]], "ativo": True,
    }
    with pytest.raises(OrderValidationError):
        apply_promotion_to_validated(
            _validated(_item("g", "14")), promo,
            exclusive_ids={"pitulinha"},
        )
    with pytest.raises(OrderValidationError):
        apply_promotion_to_validated(
            _validated(_item("g", "14"), _item("pitulinha", "1")),
            {**promo, "ativo": False}, exclusive_ids={"pitulinha"},
        )

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


def test_pausa_na_regra_e_preco_maior_falham():
    v = _validated(_item("g", "14"), _item("m", "10"))
    with pytest.raises(OrderValidationError):
        apply_promotion_to_validated(v, {**_campaign(), "ativo": False})
    with pytest.raises(OrderValidationError):
        apply_promotion_to_validated(v, {**_campaign(), "preco": 30})


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

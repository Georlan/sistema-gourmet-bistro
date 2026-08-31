"""Shared helpers retain behavior; no live database or device is used."""
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from app.schemas import RestauranteConfigUpdate
from app.services.restaurant_profile import (
    RESTAURANT_PROFILE_FIELDS, apply_restaurant_profile_update,
)
from app.services.inventory_count import apply_inventory_count


@pytest.mark.parametrize("previous,counted", [(10, 6), (4, 8), (-5, 2), (0, 0), (3, 3)])
def test_inventory_count_preserves_balance_audit_and_noop(previous, counted):
    db = Mock()
    ingredient = SimpleNamespace(id="ingredient", estoque_atual=previous, preco_medio_custo=12)
    session = SimpleNamespace(id="count-session-123")
    changed = apply_inventory_count(
        db, insumo=ingredient, counted=counted, session=session,
        restaurant_id=17, observation="conferência", user_id="operator",
    )
    assert changed == (previous != counted)
    assert ingredient.estoque_atual == counted
    db.commit.assert_not_called()
    if not changed:
        db.add.assert_not_called()
        return
    movement = db.add.call_args.args[0]
    assert movement.restaurante_id == 17
    assert movement.insumo_id == "ingredient"
    assert movement.saldo_anterior == previous
    assert movement.saldo_posterior == counted
    assert movement.quantidade == abs(counted - previous)
    assert movement.custo_unitario == 12
    assert movement.tipo == movement.origem == "contagem"
    assert movement.referencia_id == session.id
    assert movement.usuario_id == "operator"
    assert movement.observacao == "conferência"


def test_profile_partial_and_null_ignore_existing_fields_but_empty_values_apply():
    restaurant = SimpleNamespace(
        **{field: "original" for field in RESTAURANT_PROFILE_FIELDS},
        plano="premium", restaurante_id=17,
    )
    update = RestauranteConfigUpdate(
        nome="Novo nome", subtitulo="", latitude=0,
        logo_url=None, socials={}, formas_pagamento_aceitas=[],
    )
    apply_restaurant_profile_update(restaurant, update)
    assert restaurant.nome == "Novo nome"
    assert restaurant.subtitulo == ""
    assert restaurant.latitude == 0
    assert restaurant.logo_url == "original"
    assert restaurant.banner_url == "original"
    assert restaurant.socials == {}
    assert restaurant.formas_pagamento_aceitas == []
    assert restaurant.plano == "premium"
    assert restaurant.restaurante_id == 17


def test_profile_allowlist_does_not_grow_implicitly_with_the_input():
    update = SimpleNamespace(**{field: None for field in RESTAURANT_PROFILE_FIELDS}, plano="free", restaurante_id=99)
    restaurant = SimpleNamespace(plano="premium", restaurante_id=17)
    apply_restaurant_profile_update(restaurant, update)
    assert vars(restaurant) == {"plano": "premium", "restaurante_id": 17}

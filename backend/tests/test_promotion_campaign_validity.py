from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.promotions import promotion_status, active_promotions, apply_promotion_to_validated
from app.routes.cardapio_digital import PromotionConfigInput, _validate_promotion_input
from app.domain.orders.errors import OrderValidationError
from test_promotions_catalog import _campaign, _item, _validated
from test_promotions_symbolic_price_lock import _fake_db


def test_schedule_boundaries_in_fortaleza_and_utc_are_same_instant():
    promo = {**_campaign(), 'inicio_em': '2026-10-16T12:00:00-03:00',
             'fim_em': '2026-10-16T14:00:00-03:00'}
    for instant, expected in [('2026-10-16T14:59:59+00:00', 'agendada'),
                               ('2026-10-16T15:00:00+00:00', 'ativa'),
                               ('2026-10-16T17:00:00+00:00', 'encerrada')]:
        assert promotion_status(promo, now=datetime.fromisoformat(instant)) == expected
    assert promotion_status({**promo, 'ativo': False}, now=datetime.fromisoformat('2026-10-16T15:00:00+00:00')) == 'pausada'


@pytest.mark.parametrize('dates', [
    {'fim_em': '2000-01-01T00:00:00Z'},
    {'inicio_em': '2099-01-01T00:00:00Z'},
    {'fim_em': 'sem data'}, {'inicio_em': '2026-10-16T12:00:00'},
])
def test_ineligible_offers_disappear_and_checkout_rejects_stale_menu(dates):
    promo = {**_campaign(), **dates}
    assert active_promotions(SimpleNamespace(promocoes=[promo]),
                             [SimpleNamespace(id='g', ativo=True), SimpleNamespace(id='m', ativo=True)]) == []
    with pytest.raises(OrderValidationError):
        apply_promotion_to_validated(_validated(_item('g', '14'), _item('m', '10')), promo)


def test_no_end_preserves_existing_campaigns():
    assert promotion_status(_campaign()) == 'ativa'
    assert promotion_status({**_campaign(), 'ativo': False}) == 'pausada'


@pytest.mark.parametrize('fields', [
    {'inicio_em': '2026-10-16T12:00:00'},
    {'inicio_em': '2026-10-16T12:00:00Z', 'fim_em': '2026-10-16T11:00:00Z'},
    {'fuso_horario': 'invalid/zone'},
])
def test_server_rejects_naive_dates_reversed_period_and_unknown_zone(fields):
    offer = PromotionConfigInput(nome='Oferta teste', preco=22, componentes=[['g'], ['m']], **fields)
    with pytest.raises(HTTPException) as exc:
        _validate_promotion_input(_fake_db(), 6, offer)
    assert exc.value.status_code == 422


def test_api_normalizes_offset_and_retains_campaign_zone():
    db = _fake_db(SimpleNamespace(id='g', preco=14, ativo=True, somente_promocao=False),
                  SimpleNamespace(id='m', preco=10, ativo=True, somente_promocao=False))
    offer = PromotionConfigInput(nome='Oferta teste', preco=22, componentes=[['g'], ['m']],
                                 inicio_em='2026-10-16T12:00:00-03:00')
    saved = _validate_promotion_input(db, 6, offer)
    assert saved['inicio_em'] == '2026-10-16T15:00:00+00:00'
    assert saved['fim_em'] is None
    assert saved['fuso_horario'] == 'America/Fortaleza'

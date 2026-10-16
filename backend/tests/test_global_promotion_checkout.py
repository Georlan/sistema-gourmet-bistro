"""Checkout real em fixtures locais: oferta global, total e replay canônicos."""
from decimal import Decimal
import uuid

import pytest

from app.database import SessionLocal, current_restaurante_id
from app.models import ConfiguracaoRestaurante, Produto, Item, Restaurante
from app.promotions import apply_promotion_to_validated
from app.application.orders.idempotency import compute_order_intent_fingerprint
from app.domain.orders.errors import OrderValidationError
from test_promotions_catalog import _campaign, _item, _validated
from test_online_order_server_authority import (
    setup_restaurant_authority, client, RESTAURANTE_ID, PRODUTO_ID, CATEGORIA_ID, _payload,
)


@pytest.fixture(autouse=True)
def restore_campaign_configuration(setup_restaurant_authority):
    db = SessionLocal()
    token = current_restaurante_id.set(RESTAURANTE_ID)
    config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=RESTAURANTE_ID).one()
    previous = (config.promocoes, config.pedido_minimo)
    db.close()
    current_restaurante_id.reset(token)
    try:
        yield
    finally:
        db = SessionLocal()
        token = current_restaurante_id.set(RESTAURANTE_ID)
        try:
            config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=RESTAURANTE_ID).one()
            config.promocoes, config.pedido_minimo = previous
            db.commit()
        finally:
            current_restaurante_id.reset(token)
            db.close()


def test_changed_price_requires_review_and_never_trusts_customer_amount():
    validated = _validated(_item('g', '14', '2.50'), _item('m', '10'))
    with pytest.raises(OrderValidationError, match='preço desta oferta mudou'):
        apply_promotion_to_validated(validated, {**_campaign(), 'preco': 30}, expected_price=Decimal('22'))
    result = apply_promotion_to_validated(validated, {**_campaign(), 'preco': 30}, expected_price=Decimal('30'))
    assert sum(item.base_price for item in result.items) == Decimal('30.00')
    assert result.items[0].modifiers[0].price == Decimal('2.50')


def test_global_offer_real_checkout_replay_expiry_and_tenant_isolation(setup_restaurant_authority):
    second_id = 'global-offer-drink'
    offer_id = 'global-offer-campaign'
    db = SessionLocal()
    token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        second = db.query(Produto).filter_by(restaurante_id=RESTAURANTE_ID, id=second_id).first()
        if second is None:
            second = Produto(id=second_id, restaurante_id=RESTAURANTE_ID, nome='Bebida',
                             categoria_id=CATEGORIA_ID, preco=1, ativo=True, somente_promocao=True)
            db.add(second)
        db.query(Produto).filter_by(restaurante_id=RESTAURANTE_ID, id=PRODUTO_ID).one().imagem = 'https://images.example.com/canonical.png'
        config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=RESTAURANTE_ID).one()
        config.pedido_minimo = 30
        config.promocoes = [{'id': offer_id, 'nome': 'Prato e bebida', 'preco': 30,
                             'componentes': [[PRODUTO_ID], [second_id]], 'ativo': True}]
        db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()
    snapshot = client.get(f'/api/cardapio-digital/public?restaurante_id={RESTAURANTE_ID}')
    assert snapshot.status_code == 200, snapshot.text
    assert snapshot.json()['promocoes'][0]['id'] == offer_id
    assert snapshot.json()['promocao_composicao_explicita'] is True
    assert next(product for product in snapshot.json()['produtos'] if product['id'] == PRODUTO_ID)['imagem_url'] == 'https://images.example.com/canonical.png'
    assert second_id not in [product['id'] for product in snapshot.json()['produtos']]
    payload = _payload('global-offer-' + uuid.uuid4().hex)
    payload.update(promocao_id=offer_id, promocao_preco_esperado=30)
    payload['itens'].append({'produto_id': second_id, 'quantidade': 1})
    stale = client.post('/cardapio/pedidos', json={**payload, 'promocao_preco_esperado': 22})
    assert stale.status_code in (400, 409, 422), stale.text
    assert 'preço desta oferta mudou' in stale.text
    first = client.post('/cardapio/pedidos', json=payload)
    assert first.status_code == 201, first.text
    assert first.json()['total'] == 37  # conjunto 30 + frete autoritativo 7
    replay = client.post('/cardapio/pedidos', json=payload)
    assert replay.status_code in (200, 201), replay.text
    assert replay.json()['comanda_id'] == first.json()['comanda_id']
    db = SessionLocal()
    token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        assert db.query(Item).filter_by(restaurante_id=RESTAURANTE_ID, comanda_id=first.json()['comanda_id']).count() == 2
        assert db.query(Produto).filter_by(restaurante_id=RESTAURANTE_ID, id=PRODUTO_ID).one().preco == 25
        assert db.query(Produto).filter_by(restaurante_id=RESTAURANTE_ID, id=second_id).one().preco == 1
        config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=RESTAURANTE_ID).one()
        config.promocoes = [{**config.promocoes[0], 'fim_em': '2000-01-01T00:00:00Z'}]
        db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()
    # Reavaliar o mínimo também para preço promocional abaixo do limite.
    db = SessionLocal()
    token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=RESTAURANTE_ID).one()
        expired_offer = config.promocoes[0]
        config.promocoes = [{**expired_offer, 'fim_em': None, 'preco': 22}]
        db.commit()
        too_low = client.post('/cardapio/pedidos', json={**payload, 'idempotency_key': uuid.uuid4().hex,
                                                       'promocao_preco_esperado': 22})
        assert too_low.status_code in (400, 409, 422), too_low.text
        assert 'mínimo' in too_low.text
        config.promocoes = [expired_offer]
        db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()
    payload['idempotency_key'] = 'expired-' + uuid.uuid4().hex
    expired = client.post('/cardapio/pedidos', json=payload)
    assert expired.status_code in (400, 409, 422), expired.text
    assert client.get(f'/api/cardapio-digital/public?restaurante_id={RESTAURANTE_ID}').json()['promocoes'] == []


def test_price_review_is_part_of_idempotent_intent_without_changing_legacy_hashes():
    args = dict(restaurante_id=8, tipo_pedido='retirada', itens=[{'produto_id': 'a', 'quantidade': 1}])
    legacy = compute_order_intent_fingerprint(**args)
    assert 'promocao_preco_esperado' not in legacy.canonical_payload
    first = compute_order_intent_fingerprint(**args, promocao_id='offer', promocao_preco_esperado=22)
    equivalent = compute_order_intent_fingerprint(**args, promocao_id='offer', promocao_preco_esperado=Decimal('22.00'))
    reviewed = compute_order_intent_fingerprint(**args, promocao_id='offer', promocao_preco_esperado=30)
    other_tenant = compute_order_intent_fingerprint(**{**args, 'restaurante_id': 9}, promocao_id='offer', promocao_preco_esperado=22)
    assert first.fingerprint == equivalent.fingerprint
    assert first.fingerprint != reviewed.fingerprint
    assert first.fingerprint != other_tenant.fingerprint


def test_campaign_cannot_reference_products_of_another_restaurant(setup_restaurant_authority):
    from fastapi import HTTPException
    from app.routes.cardapio_digital import PromotionConfigInput, _validate_promotion_input
    db = SessionLocal()
    token = current_restaurante_id.set(RESTAURANTE_ID + 1)
    try:
        offer = PromotionConfigInput(nome='Outro restaurante', preco=30,
                                     componentes=[[PRODUTO_ID], ['global-offer-drink']])
        with pytest.raises(HTTPException) as exc:
            _validate_promotion_input(db, RESTAURANTE_ID + 1, offer)
        assert exc.value.status_code == 422
        assert 'neste restaurante' in exc.value.detail
    finally:
        current_restaurante_id.reset(token)
        db.close()


def test_mixed_cart_real_checkout_preserves_loose_price_and_replay(setup_restaurant_authority):
    drink_id = 'mixed-cart-drink'
    db = SessionLocal()
    token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        db.add(Produto(id=drink_id, restaurante_id=RESTAURANTE_ID, nome='Bebida combo',
                       categoria_id=CATEGORIA_ID, preco=3, ativo=True, somente_promocao=True))
        config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=RESTAURANTE_ID).one()
        config.promocoes = [{'id': 'mixed', 'nome': 'Combo', 'preco': 22,
                             'componentes': [[PRODUTO_ID], [drink_id]], 'ativo': True}]
        db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()
    payload = _payload('mixed-' + uuid.uuid4().hex)
    payload.update(promocao_id='mixed', promocao_preco_esperado=22, promocao_item_indices=[1, 2])
    payload['itens'] = [
        {'produto_id': PRODUTO_ID, 'quantidade': 2, 'observacao': 'avulsas'},
        {'produto_id': PRODUTO_ID, 'quantidade': 1, 'observacao': 'combo'},
        {'produto_id': drink_id, 'quantidade': 1},
    ]
    first = client.post('/cardapio/pedidos', json=payload)
    assert first.status_code == 201, first.text
    assert first.json()['total'] == 79  # combo 22 + 2 avulsas de 25 + frete 7
    replay = client.post('/cardapio/pedidos', json=payload)
    assert replay.json()['comanda_id'] == first.json()['comanda_id']
    # A mesma chave não aceita trocar quais linhas recebem o preço promocional.
    changed = client.post('/cardapio/pedidos', json={**payload, 'promocao_item_indices': [0, 2]})
    assert changed.status_code == 409, changed.text
    # Quantidade agregada de avulsas não pode ser apresentada como parte unitária.
    invalid = client.post('/cardapio/pedidos', json={**payload, 'idempotency_key': uuid.uuid4().hex,
                                                  'promocao_item_indices': [0, 2]})
    assert invalid.status_code == 400, invalid.text

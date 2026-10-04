"""Regressões da operação explícita de modalidade; somente banco de teste."""
import json
from decimal import Decimal
import uuid
import pytest
from app.application.orders.commands import CreateOrderCommand, CustomerInput, OrderItemInput
from app.application.orders.service import OrderApplicationService
from app.database import SessionLocal
from app.domain.orders.types import FulfillmentType, OrderChannel
from app.models import Comanda, ConfiguracaoRestaurante, ActivityLog
from app.delivery_address_snapshot import load_delivery_address_snapshot, load_original_delivery_address_snapshot
from tests.characterization.orders.fixtures import char_client, char_setup

ADDRESS = {'logradouro': 'Rua das Flores', 'numero': '10', 'bairro': 'Centro', 'cidade': 'Fortaleza', 'uf': 'CE', 'cep': ''}

@pytest.fixture
def order(char_setup):
    rid = char_setup['restaurant_id']
    with SessionLocal(restaurante_id=rid) as db:
        config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=rid).one()
        config.delivery_ativo = True
        config.tipos_pedido_ativos = None
        config.tipo_taxa_entrega = 'fixa'
        config.taxa_entrega_fixa = 7
        config.frete_gratis_valor = 0
        config.pedido_minimo = 0
        config.pedido_minimo_retirada = False
        db.commit()
        dto = OrderApplicationService.create_order(db, CreateOrderCommand(
            restaurant_id=rid, channel=OrderChannel.POS, fulfillment=FulfillmentType.PICKUP,
            operator_user_id='usr-char-admin', customer=CustomerInput(name='Cliente Teste', phone='85999990000'),
            items=(OrderItemInput(product_id='prod-char-simples', quantity=Decimal('1')),)))
        db.commit()
        return {**char_setup, 'id': str(dto.comanda_id)}


def call(client, order, suffix, payload=None):
    url = f"/comandas/{order['id']}/modalidade{suffix}"
    return client.get(url, headers=order['headers']) if payload is None else client.post(url, json=payload, headers=order['headers'])


def quote(client, order, **overrides):
    payload = {'fulfillment': 'delivery', 'address_snapshot': ADDRESS, **overrides}
    result = call(client, order, '/previa', payload)
    assert result.status_code == 200, result.text
    return payload, result.json()


def test_pickup_delivery_pickup_preserves_state_history_and_totals(char_client, order):
    response = call(char_client, order, '/opcoes')
    assert response.status_code == 200, response.text
    before = response.json()
    assert before['options'] == ['delivery']
    payload, preview = quote(char_client, order)
    assert preview['delivery_fee'] == 7
    assert preview['total'] == preview['previous_total'] + 7
    converted = call(char_client, order, '', {**payload, 'token': preview['token'], 'motivo': 'Cliente pediu entrega'})
    assert converted.status_code == 200, converted.text
    assert converted.json()['tipo'] == 'Delivery'
    assert converted.json()['delivery_status'] == 'producao'
    with SessionLocal(restaurante_id=order['restaurant_id']) as db:
        snapshot = load_delivery_address_snapshot(db, restaurante_id=order['restaurant_id'], comanda_id=order['id'])
        assert snapshot['logradouro'] == ADDRESS['logradouro']
        persisted = db.get(Comanda, order['id'])
        assert 'Rua das Flores' in persisted.delivery_endereco
        logs = db.query(ActivityLog).filter_by(restaurante_id=order['restaurant_id'], action='CONVERT_FULFILLMENT').all()
        log = next(json.loads(log.details) for log in logs if json.loads(log.details)['comanda_id'] == order['id'])
        assert log['delivery_taxa_atual'] == 7
    payload, preview = quote(char_client, order, fulfillment='pickup')
    assert preview['delivery_fee'] == 0
    assert preview['total'] == preview['previous_total'] - 7
    result = call(char_client, order, '', {**payload, 'token': preview['token'], 'motivo': 'Cliente vem retirar'})
    assert result.status_code == 200, result.text
    assert result.json()['tipo'] == 'Retirada'
    assert result.json()['delivery_status'] == 'producao'
    with SessionLocal(restaurante_id=order['restaurant_id']) as db:
        assert load_delivery_address_snapshot(db, restaurante_id=order['restaurant_id'], comanda_id=order['id']) == snapshot

    corrected_address = {**ADDRESS, 'numero': '99'}
    corrected_payload = {'fulfillment': 'delivery', 'address_snapshot': corrected_address}
    changed = call(char_client, order, '/previa', corrected_payload)
    assert changed.status_code == 200, changed.text
    corrected = call(char_client, order, '', {
        **corrected_payload,
        'token': changed.json()['token'],
        'motivo': 'Cliente corrigiu o número',
    })
    assert corrected.status_code == 200, corrected.text
    with SessionLocal(restaurante_id=order['restaurant_id']) as db:
        assert load_original_delivery_address_snapshot(
            db, restaurante_id=order['restaurant_id'], comanda_id=order['id']
        ) == snapshot
        current = load_delivery_address_snapshot(
            db, restaurante_id=order['restaurant_id'], comanda_id=order['id']
        )
        assert current['numero'] == '99'
        persisted = db.get(Comanda, order['id'])
        assert ', 99' in persisted.delivery_endereco
        logs = db.query(ActivityLog).filter_by(
            restaurante_id=order['restaurant_id'],
            action='CONVERT_FULFILLMENT',
        ).all()
        correction_entry = next(
            log for log in reversed(logs)
            if json.loads(log.details)['comanda_id'] == order['id']
            and json.loads(log.details).get('endereco_corrigido')
        )
        correction_log = json.loads(correction_entry.details)
        assert correction_log['address_revision_id']
        assert 'Rua das Flores' not in correction_entry.details


@pytest.mark.parametrize('address', [None, {}, {**ADDRESS, 'numero': ''}])
def test_delivery_requires_structured_address(char_client, order, address):
    result = call(char_client, order, '/previa', {'fulfillment': 'delivery', 'address_snapshot': address})
    assert result.status_code == 422


def test_configuration_lock_does_not_lock_nullable_joined_restaurant(char_client, order):
    # SQLite ignores row locks; compile the actual endpoint statements for PG
    # so its nullable-join restriction remains covered in the default CI suite.
    from sqlalchemy import event
    from sqlalchemy.dialects import postgresql
    from app.database import engine
    statements = []

    def observe(_conn, clause, _multiparams, _params, _options):
        sql = str(clause.compile(dialect=postgresql.dialect()))
        if 'FOR UPDATE' in sql and 'configuracoes_restaurante' in sql:
            statements.append(sql)

    event.listen(engine, 'before_execute', observe)
    try:
        response = call(char_client, order, '/opcoes')
        assert response.status_code == 200, response.text
        quote(char_client, order)
    finally:
        event.remove(engine, 'before_execute', observe)
    assert len(statements) >= 3
    assert all('FOR UPDATE OF configuracoes_restaurante' in sql for sql in statements)


def test_neighborhood_unlisted_uses_canonical_fallback(char_client, order):
    with SessionLocal(restaurante_id=order['restaurant_id']) as db:
        config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=order['restaurant_id']).one()
        config.tipo_taxa_entrega = 'bairro'
        config.tabela_taxas_bairros = [{'bairro': 'Centro', 'taxa': 9}]
        db.commit()
    _, matched = quote(char_client, order)
    assert matched['delivery_fee'] == 9
    _, fallback = quote(char_client, order, address_snapshot={**ADDRESS, 'bairro': 'Outro'})
    assert fallback['delivery_fee'] == 7


@pytest.mark.parametrize('field,value', [('fechada', True), ('delivery_status', 'transito'), ('delivery_status', 'finalizado'),
    ('delivery_status', 'recusado'), ('valor_pago', 1), ('online_payment_status', 'approved'), ('online_payment_status', 'pending'),
    ('status_comanda', 'aguardando_pagamento'), ('tipo', 'Consumo no Local'), ('valor_desconto_cashback', 1)])
def test_irreversible_or_financial_orders_are_blocked(char_client, order, field, value):
    with SessionLocal(restaurante_id=order['restaurant_id']) as db:
        persisted = db.get(Comanda, order['id'])
        setattr(persisted, field, value)
        db.commit()
    assert call(char_client, order, '/opcoes').json()['options'] == []
    assert call(char_client, order, '/previa', {'fulfillment': 'delivery', 'address_snapshot': ADDRESS}).status_code == 409


def test_assigned_courier_blocks_both_endpoints(char_client, order):
    with SessionLocal(restaurante_id=order['restaurant_id']) as db:
        persisted = db.get(Comanda, order['id'])
        persisted.tipo = 'Delivery'
        persisted.motoboy_id = order['motoboy_id']
        db.commit()
    assert call(char_client, order, '/previa', {'fulfillment': 'pickup'}).status_code == 409
    legacy = char_client.post(f"/comandas/{order['id']}/delivery/converter-retirada", json={'motivo': 'Cliente vem buscar'}, headers=order['headers'])
    assert legacy.status_code == 409


@pytest.mark.parametrize('change', ['status', 'items', 'fee', 'phone'])
def test_stale_preview_cannot_commit(char_client, order, change):
    payload, preview = quote(char_client, order, telefone='85999990000')
    with SessionLocal(restaurante_id=order['restaurant_id']) as db:
        persisted = db.get(Comanda, order['id'])
        if change == 'status': persisted.delivery_status = 'pronto'
        elif change == 'items': persisted.itens[0].preco_unit += 1
        elif change == 'phone': persisted.delivery_telefone = '85988881111'
        else: db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=order['restaurant_id']).one().taxa_entrega_fixa = 10
        db.commit()
    result = call(char_client, order, '', {**payload, 'token': preview['token'], 'motivo': 'Cliente pediu entrega'})
    assert result.status_code == 409
    with SessionLocal(restaurante_id=order['restaurant_id']) as db:
        assert db.get(Comanda, order['id']).tipo == 'Retirada'
        assert load_delivery_address_snapshot(db, restaurante_id=order['restaurant_id'], comanda_id=order['id']) is None


def test_tenant_and_permission_isolation(char_client, order):
    from app.security import create_access_token
    from app.database import current_restaurante_id
    from app.models import Restaurante, Usuario
    foreign_rid = order['restaurant_id'] + 10000
    foreign_user = 'foreign-operator-' + uuid.uuid4().hex
    context = current_restaurante_id.set(foreign_rid)
    try:
        with SessionLocal(restaurante_id=foreign_rid) as db:
            if db.get(Restaurante, foreign_rid) is None:
                db.add(Restaurante(id=foreign_rid, nome='Restaurante estrangeiro', slug='foreign-conversion-test', plano='premium'))
                db.flush()
            db.add(Usuario(id=foreign_user, restaurante_id=foreign_rid, nome='Caixa de outro tenant', cargo='caixa', status='ativo'))
            db.commit()
    finally:
        current_restaurante_id.reset(context)
    foreign = create_access_token(subject=foreign_user, restaurante_id=foreign_rid, role='caixa')
    foreign_headers = {'Authorization': f'Bearer {foreign}'}
    for suffix in ['/opcoes', '/previa', '']:
        result = char_client.get(f"/comandas/{order['id']}/modalidade{suffix}", headers=foreign_headers) if suffix == '/opcoes' else char_client.post(f"/comandas/{order['id']}/modalidade{suffix}", json={'fulfillment': 'delivery'}, headers=foreign_headers)
        assert result.status_code == 404, result.text
    assert char_client.post(f"/comandas/{order['id']}/modalidade", json={}).status_code == 401


def test_mode_disabled_and_no_config_do_not_allow_manual_fee(char_client, order):
    with SessionLocal(restaurante_id=order['restaurant_id']) as db:
        config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=order['restaurant_id']).one()
        config.tipos_pedido_ativos = ['retirada']
        db.commit()
    assert call(char_client, order, '/opcoes').json()['options'] == []
    assert call(char_client, order, '/previa', {'fulfillment': 'delivery', 'address_snapshot': ADDRESS, 'delivery_fee': 1}).status_code == 409


@pytest.mark.parametrize('stage', ['pendente', 'aceito', 'producao', 'pronto'])
def test_allowed_stages_never_change_on_conversion(char_client, order, stage):
    with SessionLocal(restaurante_id=order['restaurant_id']) as db:
        db.get(Comanda, order['id']).delivery_status = stage
        db.commit()
    payload, preview = quote(char_client, order)
    result = call(char_client, order, '', {**payload, 'token': preview['token'], 'motivo': 'Corrigir modalidade'})
    assert result.status_code == 200, result.text
    assert result.json()['delivery_status'] == stage
    assert result.json()['itens'][0]['status'] == 'preparando'
    # Segundo operador com a mesma prévia não pode aplicar novamente.
    assert call(char_client, order, '', {**payload, 'token': preview['token'], 'motivo': 'Operador concorrente'}).status_code == 409


def test_missing_phone_minimum_and_missing_configuration_fail_closed(char_client, order):
    with SessionLocal(restaurante_id=order['restaurant_id']) as db:
        persisted = db.get(Comanda, order['id'])
        persisted.delivery_telefone = None
        db.commit()
    invalid = call(char_client, order, '/previa', {'fulfillment': 'delivery', 'address_snapshot': ADDRESS})
    assert invalid.status_code == 422
    payload, _ = quote(char_client, order, telefone='85999990000')
    with SessionLocal(restaurante_id=order['restaurant_id']) as db:
        db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=order['restaurant_id']).one().pedido_minimo = 10000
        db.commit()
    assert call(char_client, order, '/previa', payload).status_code == 422
    with SessionLocal(restaurante_id=order['restaurant_id']) as db:
        db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=order['restaurant_id']).delete()
        db.commit()
    assert call(char_client, order, '/opcoes').json()['options'] == []
    assert call(char_client, order, '/previa', {**payload, 'delivery_fee': 1}).status_code == 409


def test_distance_policy_and_out_of_coverage(char_client, order):
    from app.models import Restaurante
    with SessionLocal(restaurante_id=order['restaurant_id']) as db:
        config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=order['restaurant_id']).one()
        config.tipo_taxa_entrega = 'distancia'
        config.tabela_taxas_km = [{'taxa_minima': 5, 'km_inclusos': 1, 'incremento_valor': 2, 'incremento_km': 1, 'distancia_maxima_km': 5}]
        restaurant = db.get(Restaurante, order['restaurant_id'])
        restaurant.latitude, restaurant.longitude = -3.73, -38.52
        db.commit()
    _, fallback = quote(char_client, order)
    assert fallback['delivery_fee'] == 5
    result = call(char_client, order, '/previa', {'fulfillment': 'delivery', 'address_snapshot': {**ADDRESS, 'latitude': -10, 'longitude': -45}})
    assert result.status_code == 422
    assert 'fora do limite' in result.json()['detail']


def test_fiscal_document_blocks_conversion(char_client, order):
    from app.fiscal_models import FiscalDocument
    with SessionLocal(restaurante_id=order['restaurant_id']) as db:
        db.add(FiscalDocument(id=str(uuid.uuid4()), restaurante_id=order['restaurant_id'], comanda_id=order['id'],
            idempotency_key=uuid.uuid4().hex, status='draft', sale_snapshot={'total': 1}))
        db.commit()
    assert call(char_client, order, '/opcoes').json()['options'] == []
    assert call(char_client, order, '/previa', {'fulfillment': 'delivery', 'address_snapshot': ADDRESS}).status_code == 409


def test_pending_payment_record_blocks_conversion_even_with_zero_paid(char_client, order):
    from app.models import Pagamento, CaixaTurno
    with SessionLocal(restaurante_id=order['restaurant_id']) as db:
        shift = db.query(CaixaTurno).filter_by(restaurante_id=order['restaurant_id'], status='aberto').first()
        db.add(Pagamento(id=uuid.uuid4().hex, restaurante_id=order['restaurant_id'], comanda_id=order['id'], turno_id=shift.id,
            valor=1, metodo='pix', status='pendente'))
        db.commit()
    assert call(char_client, order, '/opcoes').json()['options'] == []



def test_provider_reference_uses_canonical_launch_id(char_client, order):
    from app.models import ExternalOrderReference
    with SessionLocal(restaurante_id=order['restaurant_id']) as db:
        persisted = db.get(Comanda, order['id'])
        db.add(ExternalOrderReference(restaurante_id=order['restaurant_id'], provider='ifood',
            external_order_id=uuid.uuid4().hex, internal_order_id=persisted.lancamentos[0].id))
        db.commit()
    assert call(char_client, order, '/opcoes').json()['options'] == []


def test_free_shipping_and_client_fee_are_resolved_by_server(char_client, order):
    with SessionLocal(restaurante_id=order['restaurant_id']) as db:
        config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=order['restaurant_id']).one()
        config.frete_gratis_valor = 1
        db.commit()
    payload, preview = quote(char_client, order, delivery_fee=999)
    assert preview['delivery_fee'] == 0
    assert preview['total'] == preview['previous_total']
    result = call(char_client, order, '', {**payload, 'token': preview['token'], 'motivo': 'Cliente pediu entrega'})
    assert result.status_code == 200
    assert result.json()['delivery_taxa'] == 0



def test_permission_denies_waiter_and_kitchen(char_client, order):
    from app.security import create_access_token
    from app.models import Usuario
    for role in ['garcom', 'cozinha']:
        user_id = 'conversion-' + role + '-' + uuid.uuid4().hex
        with SessionLocal(restaurante_id=order['restaurant_id']) as db:
            db.add(Usuario(id=user_id, restaurante_id=order['restaurant_id'], nome='Operador teste', cargo=role, role=role, status='ativo'))
            db.commit()
        token = create_access_token(subject=user_id, restaurante_id=order['restaurant_id'], role=role)
        forbidden = {**order, 'headers': {'Authorization': f'Bearer {token}'}}
        assert call(char_client, forbidden, '/opcoes').status_code == 403
        assert call(char_client, forbidden, '/previa', {'fulfillment': 'delivery', 'address_snapshot': ADDRESS}).status_code == 403
        assert call(char_client, forbidden, '', {'fulfillment': 'delivery', 'address_snapshot': ADDRESS}).status_code == 403


def test_failure_rolls_back_address_fee_and_audit(char_client, order):
    from unittest.mock import patch
    payload, preview = quote(char_client, order)
    with patch('app.services.order_chat_service.queue_order_tracking_refresh', side_effect=RuntimeError('simulated transaction failure')):
        result = call(char_client, order, '', {**payload, 'token': preview['token'], 'motivo': 'Cliente pediu entrega'})
        assert result.status_code == 500
    with SessionLocal(restaurante_id=order['restaurant_id']) as db:
        persisted = db.get(Comanda, order['id'])
        assert persisted.tipo == 'Retirada'
        assert persisted.delivery_taxa == 0
        assert load_delivery_address_snapshot(db, restaurante_id=order['restaurant_id'], comanda_id=order['id']) is None
        logs = db.query(ActivityLog).filter_by(restaurante_id=order['restaurant_id'], action='CONVERT_FULFILLMENT').all()
        assert not any(json.loads(log.details)['comanda_id'] == order['id'] for log in logs)

import datetime
import uuid
import pytest
from decimal import Decimal
from dataclasses import replace
from types import SimpleNamespace

from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal
from app.models import Restaurante, Usuario, Motoboy, Comanda, Categoria, Produto, CaixaTurno, ConfiguracaoRestaurante
from app.security import create_access_token
from app.services.delivery_receipts import issue_delivery_receipt, customer_delivery_receipt
from app.services.order_chat_service import create_conversation_for_order
from app.application.orders.service import OrderApplicationService
from app.application.orders.commands import CreateOrderCommand, CustomerInput, DeliveryInput, OrderItemInput
from app.domain.orders.types import OrderChannel, FulfillmentType


@pytest.mark.parametrize('paid', [False, True])
def test_customer_receives_code_courier_validates_and_canonical_state_changes(monkeypatch, paid):
    rid = 99041000 + int(uuid.uuid4().hex[:5], 16)
    uid, pid = f'receipt-u-{uuid.uuid4().hex[:8]}', f'receipt-p-{uuid.uuid4().hex[:8]}'
    courier_id = rid * 10 + 1
    with SessionLocal() as db:
        db.add(Restaurante(id=rid, nome='Receipt local', plano='premium', saas_status='active'))
        db.flush()
        db.add(ConfiguracaoRestaurante(restaurante_id=rid, tipo_taxa_entrega='fixa', taxa_entrega_fixa=0))
        db.add(Usuario(id=uid, restaurante_id=rid, nome='Receipt admin', role='admin', cargo='admin', status='ativo'))
        db.add(Categoria(id=f'cat-{pid}', restaurante_id=rid, nome='Lanches'))
        db.flush()
        db.add(Produto(id=pid, restaurante_id=rid, categoria_id=f'cat-{pid}', nome='Suco', preco=12.9))
        db.add(Motoboy(id=courier_id, restaurante_id=rid, nome='Courier', telefone='85999990001', ativo=True))
        db.add(CaixaTurno(restaurante_id=rid, aberto_por_id=uid, status='aberto', saldo_inicial=0))
        db.commit()
        command = CreateOrderCommand(restaurant_id=rid, channel=OrderChannel.WEB_CARDAPIO, fulfillment=FulfillmentType.DELIVERY,
            items=(OrderItemInput(product_id=pid, quantity=Decimal('1')),), customer=CustomerInput(name='Cliente', phone='85999990002'),
            delivery=DeliveryInput(address='Rua local, 10'), operator_user_id=uid, idempotency_key=f'receipt-{pid}')
        created = OrderApplicationService.create_order(db, command)
        order = db.query(Comanda).filter_by(id=created.comanda_id, restaurante_id=rid).one()
        code = customer_delivery_receipt(order)
        assert code and len(code) == 3 and code.isdigit()
        assert code not in order.delivery_receipt_secret
        original = order.delivery_receipt_secret
        issue_delivery_receipt(order)
        assert order.delivery_receipt_secret == original
        pickup = OrderApplicationService.create_order(db, replace(command, fulfillment=FulfillmentType.PICKUP, delivery=None, idempotency_key=f'pickup-{pid}'))
        assert db.get(Comanda, pickup.comanda_id).delivery_receipt_secret is None
        replay = OrderApplicationService.create_order(db, command)
        assert replay.comanda_id == created.comanda_id
        assert customer_delivery_receipt(order) == code
        if paid:
            order.online_payment_status = 'approved'
            order.valor_pago = 12.9
        order.motoboy_id = courier_id
        order.delivery_status = 'transito'
        _, tracking_token = create_conversation_for_order(db, rid, order.id)
        db.commit()
        order_id = order.id
    client = TestClient(app, client=(f'receipt-{rid}', 50000))
    admin_token = create_access_token(subject=uid, restaurante_id=rid, role='admin')
    link = client.post(f'/comandas/motoboys/{courier_id}/gerar-link', headers={'Authorization': f'Bearer {admin_token}'})
    assert link.status_code == 200, link.text
    headers = {'X-Koma-Delivery-Token': link.json()['token']}
    panel = client.get('/comandas/motoboys/painel-entregador', headers=headers)
    assert panel.status_code == 200, panel.text
    assert panel.json()['entregas'][0]['requires_delivery_code'] is True
    assert 'delivery_receipt_secret' not in panel.text and 'delivery_receipt_code' not in panel.text
    assert panel.json()['entregas'][0]['confirmation']['code_length'] == 3
    for suffix in ['', '/summary']:
        tracked = client.get(f'/api/cardapio/pedidos/acompanhar/{tracking_token}{suffix}')
        assert tracked.status_code == 200, tracked.text
        assert tracked.json()['delivery_receipt_code'] == code
    endpoint = f'/comandas/motoboys/pedidos/{order_id}/confirmar-entrega'
    missing = client.post(endpoint, headers=headers)
    assert missing.status_code == 422
    wrong = '999' if code != '999' else '888'
    for attempt in range(5):
        response = client.post(endpoint, headers=headers, json={'code': wrong})
        assert response.status_code == (429 if attempt == 4 else 422), response.text
    locked = client.post(endpoint, headers=headers, json={'code': code})
    assert locked.status_code == 429
    with SessionLocal() as db:
        order = db.query(Comanda).filter_by(id=order_id).one()
        assert order.delivery_status == 'transito' and not order.fechada
        order.delivery_receipt_retry_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) - datetime.timedelta(seconds=1)
        db.commit()
    assert client.post(endpoint, headers=headers, json={'code': wrong}).status_code == 422
    with SessionLocal() as db:
        retry = db.get(Comanda, order_id)
        assert retry.delivery_receipt_failed_attempts == 1 and retry.delivery_receipt_retry_at is None
    broadcasts = []
    async def record_broadcast(payload, restaurant_id):
        broadcasts.append((payload, restaurant_id))
    monkeypatch.setattr('app.routes.orders.manager.broadcast', record_broadcast)
    confirmed = client.post(endpoint, headers=headers, json={'code': code})
    assert confirmed.status_code == 200, confirmed.text
    assert any(payload.get('event') == 'tables_updated' and tenant == rid for payload, tenant in broadcasts)
    assert client.post(endpoint, headers=headers, json={'code': code}).status_code == 200
    with SessionLocal() as db:
        order = db.query(Comanda).filter_by(id=order_id).one()
        assert order.delivery_status == 'finalizado'
        assert bool(order.fechada) is paid
        assert float(order.valor_pago or 0) == (12.9 if paid else 0)
        assert customer_delivery_receipt(order) is None
    assert client.get(f'/api/cardapio/pedidos/acompanhar/{tracking_token}/summary').json()['delivery_receipt_code'] is None
    cashier = client.get('/comandas/delivery/ativos', headers={'Authorization':f'Bearer {admin_token}'})
    assert cashier.status_code == 200, cashier.text
    visible = next((row for row in cashier.json() if row['id'] == order_id), None)
    assert (visible is None) is paid
    if visible:
        assert visible['delivery_status'] == 'finalizado' and not visible['fechada']


def test_receipt_is_not_exposed_for_terminal_pickup_or_unreadable_ciphertext():
    from app.crypt import encrypt_field
    row = SimpleNamespace(fechada=False, delivery_status='transito', tipo='Entrega', delivery_receipt_secret=encrypt_field('0012'))
    assert customer_delivery_receipt(row) == '0012'
    row.tipo = 'Retirada'
    assert customer_delivery_receipt(row) is None
    row.tipo = 'Entrega'
    row.delivery_status = 'cancelado'
    assert customer_delivery_receipt(row) is None
    row.delivery_status = 'transito'
    row.delivery_receipt_secret = 'gAAAAAcannot-be-decrypted'
    assert customer_delivery_receipt(row) is None


def test_three_digit_generation_preserves_leading_zero_and_legacy_codes(monkeypatch):
    from app.crypt import encrypt_field
    monkeypatch.setattr('app.services.delivery_receipts.secrets.randbelow', lambda limit: 7)
    row = SimpleNamespace(fechada=False, delivery_status='transito', tipo='Delivery', delivery_receipt_secret=None)
    issue_delivery_receipt(row)
    assert customer_delivery_receipt(row) == '007'
    row.delivery_receipt_secret = encrypt_field('0012')
    issue_delivery_receipt(row)
    assert customer_delivery_receipt(row) == '0012'


def test_already_issued_four_digit_receipt_still_validates():
    from unittest.mock import Mock
    from app.crypt import encrypt_field
    from app.services.delivery_receipts import verify_delivery_receipt
    row = SimpleNamespace(fechada=False,delivery_status='transito',tipo='Delivery',delivery_receipt_secret=encrypt_field('0012'),delivery_receipt_retry_at=None,delivery_receipt_failed_attempts=0)
    with pytest.raises(Exception) as error:
        verify_delivery_receipt(Mock(),row,'012')
    assert error.value.status_code == 422
    verify_delivery_receipt(Mock(),row,'0012')
    assert row.delivery_receipt_failed_attempts == 0

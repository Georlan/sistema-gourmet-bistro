"""Real local HTTP + WebSocket journey; no provider, WhatsApp or live tenant.

Online approval is a persisted fixture, not a provider acknowledgement.
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import SessionLocal
from app.models import (
    Restaurante, Usuario, Motoboy, Categoria, Produto, CaixaTurno,
    ConfiguracaoRestaurante, Comanda, Pagamento,
)
from app.security import create_access_token


@pytest.mark.parametrize('paid_online', [False, True])
def test_menu_dispatch_receipt_completion_and_cashier_balance(monkeypatch, paid_online):
    suffix = uuid.uuid4().hex[:10]
    rid = 99200000 + int(suffix[:5], 16)
    uid, pid, cat = f'journey-user-{suffix}', f'journey-product-{suffix}', f'journey-cat-{suffix}'
    mid = rid * 10
    # Notifications are outside this local operational proof.
    monkeypatch.setattr('app.routes.orders._agendar_notificacao_whatsapp_status', lambda *a, **kw: None)
    with SessionLocal() as db:
        db.add(Restaurante(id=rid, nome='Jornada local', plano='premium', saas_status='active'))
        db.flush()
        db.add(Usuario(id=uid, restaurante_id=rid, nome='Caixa local', role='admin', cargo='admin', status='ativo'))
        db.add(Categoria(id=cat, restaurante_id=rid, nome='Jornada'))
        db.add(ConfiguracaoRestaurante(restaurante_id=rid, delivery_ativo=True, tipo_taxa_entrega='fixa', taxa_entrega_fixa=0))
        db.flush()
        db.add(Produto(id=pid, restaurante_id=rid, categoria_id=cat, nome='Suco local', preco=12.9))
        db.add(Motoboy(id=mid, restaurante_id=rid, nome='Entregador local', telefone='85999990001', ativo=True))
        db.add(CaixaTurno(restaurante_id=rid, aberto_por_id=uid, status='aberto', saldo_inicial=0))
        db.commit()

    with TestClient(app, client=(f'journey-{suffix}', 50000)) as client:
        auth = {'Authorization': 'Bearer ' + create_access_token(subject=uid, restaurante_id=rid, role='admin')}
        payload = {
            'restaurante_id': rid, 'cliente_nome': 'Cliente local', 'cliente_telefone': '85999990002',
            'endereco_entrega': 'Rua local, 10', 'tipo_pedido': 'delivery', 'forma_pagamento': 'na_entrega',
            'itens': [{'produto_id': pid, 'quantidade': 1, 'modificador_ids': []}],
            'idempotency_key': f'journey-create-{suffix}',
        }
        created = client.post('/cardapio/pedidos', json=payload)
        assert created.status_code == 201, created.text
        oid = created.json().get('comanda_id') or created.json()['id']
        replay = client.post('/cardapio/pedidos', json=payload)
        assert replay.status_code in {200, 201}, replay.text
        assert (replay.json().get('comanda_id') or replay.json()['id']) == oid
        with SessionLocal() as db:
            order = db.get(Comanda, oid)
            identity = (order.numero_pedido, tuple(row.id for row in order.lancamentos))
            if paid_online:
                order.online_payment_status = 'approved'
                order.valor_pago = 12.9
                db.commit()

        link = client.post(f'/comandas/motoboys/{mid}/gerar-link', headers=auth)
        assert link.status_code == 200, link.text
        token = link.json()['token']
        courier_auth = {'X-Koma-Delivery-Token': token}
        endpoint = f'/comandas/motoboys/pedidos/{oid}/confirmar-entrega'
        panel_url = '/comandas/motoboys/painel-entregador'
        assert client.get(panel_url, headers=courier_auth).json()['entregas'] == []
        assigned = client.put(f'/comandas/{oid}/delivery/entregador', headers=auth, json={'motoboy_id': mid})
        assert assigned.status_code == 200, assigned.text
        assert client.get(panel_url, headers=courier_auth).json()['entregas'] == []
        for status in ['producao', 'pronto']:
            changed = client.put(f'/comandas/{oid}/delivery/status', headers=auth, params={'status_novo': status})
            assert changed.status_code == 200, changed.text
        assert client.get(panel_url, headers=courier_auth).json()['entregas'] == []

        with client.websocket_connect('/ws/entregador', subprotocols=['koma-auth', token]) as courier:
            assert courier.receive_json() == {'event': 'courier_ready'}
            dispatched = client.post(f'/comandas/{oid}/delivery/despachar', headers=auth, json={'motoboy_id': mid})
            assert dispatched.status_code == 200, dispatched.text
            assert courier.receive_json() == {'event': 'courier_panel_updated'}
            delivery = client.get(panel_url, headers=courier_auth).json()['entregas'][0]
            assert delivery['id'] == oid and delivery['numero_pedido'] == identity[0]
            assert delivery['requires_delivery_code'] and delivery['confirmation']['code_length'] == 3
            assert delivery['payment']['amount_due'] == (0 if paid_online else 12.9)
            assert 'delivery_receipt_code' not in delivery and 'delivery_telefone' not in delivery
            # The public creation response owns the customer's tracking access.
            tracking_token = created.json()['tracking_token']
            tracked = client.get(f'/api/cardapio/pedidos/acompanhar/{tracking_token}/summary')
            assert tracked.status_code == 200, tracked.text
            code = tracked.json()['delivery_receipt_code']
            assert len(code) == 3
            assert client.post(endpoint, headers=courier_auth).status_code == 422
            with client.websocket_connect(f'/ws/{uid}', subprotocols=['koma-auth', auth['Authorization'][7:]]) as cashier:
                assert cashier.receive_json()['event'] == 'waiter_connected'
                confirmed = client.post(endpoint, headers=courier_auth, json={'code': code})
                assert confirmed.status_code == 200, confirmed.text
                assert cashier.receive_json()['event'] == 'tables_updated'
                assert courier.receive_json() == {'event': 'courier_panel_updated'}
            # A lost success response can be repeated without a second effect.
            assert client.post(endpoint, headers=courier_auth, json={'code': code}).status_code == 200
        assert client.get(panel_url, headers=courier_auth).json()['entregas'] == []
        active = client.get('/comandas/delivery/ativos', headers=auth).json()
        assert any(row['id'] == oid for row in active) is not paid_online
        with SessionLocal() as db:
            order = db.get(Comanda, oid)
            assert order.delivery_status == 'finalizado' and bool(order.fechada) is paid_online
            assert (order.numero_pedido, tuple(row.id for row in order.lancamentos)) == identity
            assert db.query(Pagamento).filter_by(restaurante_id=rid, comanda_id=oid).count() == 0
        if not paid_online:
            partial = client.post(f'/caixa/comandas/{oid}/pagar', headers=auth, json={
                'valor': 5, 'metodo': 'dinheiro', 'idempotency_key': f'journey-partial-{suffix}',
            })
            assert partial.status_code == 201, partial.text
            with SessionLocal() as db:
                order = db.get(Comanda, oid)
                assert not order.fechada and order.delivery_status == 'finalizado'
                assert float(order.valor_pago) == 5
            payment = {'valor': 7.9, 'metodo': 'dinheiro', 'idempotency_key': f'journey-receive-{suffix}'}
            received = client.post(f'/caixa/comandas/{oid}/pagar', headers=auth, json=payment)
            assert received.status_code == 201, received.text
            repeated = client.post(f'/caixa/comandas/{oid}/pagar', headers=auth, json=payment)
            assert repeated.status_code == 201 and repeated.json()['id'] == received.json()['id']
            with SessionLocal() as db:
                order = db.get(Comanda, oid)
                assert order.fechada and order.delivery_status == 'finalizado'
                assert float(order.valor_pago) == 12.9
                assert db.query(Pagamento).filter_by(restaurante_id=rid, comanda_id=oid).count() == 2
            active = client.get('/comandas/delivery/ativos', headers=auth).json()
            assert all(row['id'] != oid for row in active)

import asyncio
import uuid
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from app.main import app
from app.database import SessionLocal
from app.models import Restaurante, Usuario, Motoboy, Comanda, CaixaTurno
from app.security import create_access_token
from app.services.delivery_receipts import issue_delivery_receipt, customer_delivery_receipt
from app.websocket_manager import ConnectionManager


@pytest.fixture
def flow():
    suffix=uuid.uuid4().hex[:8]
    rid=99071000+int(suffix[:4],16);mid=rid*10+1
    uid='ws-courier-'+suffix;oid='ws-order-'+suffix
    with SessionLocal() as db:
        db.add(Restaurante(id=rid,nome='Realtime fixture',plano='premium',saas_status='active'));db.flush()
        db.add(Usuario(id=uid,restaurante_id=rid,nome='Admin',role='admin',cargo='admin',status='ativo'));db.flush()
        db.add(CaixaTurno(restaurante_id=rid,aberto_por_id=uid,status='aberto',saldo_inicial=0))
        db.add(Motoboy(id=mid,restaurante_id=rid,nome='Courier',ativo=True,telefone='85999990000'))
        order=Comanda(id=oid,restaurante_id=rid,garcom_id=uid,tipo='Delivery',numero_pedido=719,delivery_status='pronto',fechada=False)
        issue_delivery_receipt(order);db.add(order);db.commit();code=customer_delivery_receipt(order)
    with TestClient(app, client=(f'courier-realtime-{suffix}', 50000)) as client:
        staff_token=create_access_token(subject=uid,restaurante_id=rid,role='admin')
        auth={'Authorization':'Bearer '+staff_token}
        link=client.post(f'/comandas/motoboys/{mid}/gerar-link',headers=auth);assert link.status_code==200,link.text
        yield client,auth,link.json()['token'],oid,code,uid,mid


def test_dispatch_and_code_completion_reach_courier_and_cashier(flow):
    client,auth,token,oid,code,uid,mid=flow
    with client.websocket_connect('/ws/entregador',subprotocols=['koma-auth',token]) as courier:
        assert courier.receive_json()=={'event':'courier_ready'}
        assert client.get('/comandas/motoboys/painel-entregador',headers={'X-Koma-Delivery-Token':token}).json()['entregas']==[]
        dispatched=client.post(f'/comandas/{oid}/delivery/despachar',headers=auth,json={'motoboy_id':mid})
        assert dispatched.status_code==200,dispatched.text
        assert courier.receive_json()=={'event':'courier_panel_updated'}
        assert client.get('/comandas/motoboys/painel-entregador',headers={'X-Koma-Delivery-Token':token}).json()['entregas'][0]['id']==oid
        with client.websocket_connect(f'/ws/{uid}',subprotocols=['koma-auth',auth['Authorization'][7:]]) as cashier:
            assert cashier.receive_json()['event']=='waiter_connected'
            confirmed=client.post(f'/comandas/motoboys/pedidos/{oid}/confirmar-entrega',headers={'X-Koma-Delivery-Token':token},json={'code':code})
            assert confirmed.status_code==200,confirmed.text
            assert cashier.receive_json()['event']=='tables_updated'
            assert courier.receive_json()=={'event':'courier_panel_updated'}
            with SessionLocal() as db:
                order=db.get(Comanda,oid);assert order.delivery_status=='finalizado' and order.fechada
            assert client.get('/comandas/motoboys/painel-entregador',headers={'X-Koma-Delivery-Token':token}).json()['entregas']==[]


def test_courier_socket_rejects_staff_token_and_revokes_with_link(flow):
    client,auth,token,oid,code,uid,mid=flow
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect('/ws/entregador',subprotocols=['koma-auth',auth['Authorization'][7:]]): pass
    with client.websocket_connect('/ws/entregador',subprotocols=['koma-auth',token]) as courier:
        assert courier.receive_json()['event']=='courier_ready'
        revoked=client.post(f'/comandas/motoboys/{mid}/revogar-link',headers=auth);assert revoked.status_code==200
        with pytest.raises(WebSocketDisconnect):courier.receive_json()
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect('/ws/entregador',subprotocols=['koma-auth',token]):pass


def test_courier_group_never_receives_broad_payloads_or_other_identity():
    async def run():
        manager=ConnectionManager()
        one,two,other,staff,customer=[AsyncMock() for _ in range(5)]
        for socket,rid,kind in [(one,11,'courier:1'),(two,11,'courier:2'),(other,12,'courier:1'),(staff,11,'internal'),(customer,11,'client')]:await manager.connect(socket,rid,client_type=kind)
        await manager.broadcast({'event':'order_updated','phone':'private'},11,target_audience='all')
        one.send_json.assert_not_called();two.send_json.assert_not_called();other.send_json.assert_not_called()
        await manager.broadcast({'event':'courier_panel_updated','courier_id':1,'private':'discard'},11,target_audience='courier')
        one.send_json.assert_called_once_with({'event':'courier_panel_updated'})
        two.send_json.assert_not_called();other.send_json.assert_not_called()
    asyncio.run(run())


def test_reassignment_invalidates_both_couriers_without_giving_old_courier_the_order(flow):
    client,auth,token,oid,code,uid,mid=flow
    second=mid+1
    with SessionLocal() as db:
        rid=db.get(Motoboy,mid).restaurante_id
        db.add(Motoboy(id=second,restaurante_id=rid,nome='Second courier',ativo=True,telefone='85999990001'));db.commit()
    link=client.post(f'/comandas/motoboys/{second}/gerar-link',headers=auth);assert link.status_code==200
    second_token=link.json()['token']
    dispatched=client.post(f'/comandas/{oid}/delivery/despachar',headers=auth,json={'motoboy_id':mid});assert dispatched.status_code==200,dispatched.text
    with client.websocket_connect('/ws/entregador',subprotocols=['koma-auth',token]) as old:
        assert old.receive_json()['event']=='courier_ready'
        with client.websocket_connect('/ws/entregador',subprotocols=['koma-auth',second_token]) as new:
            assert new.receive_json()['event']=='courier_ready'
            changed=client.post(f'/comandas/{oid}/delivery/entregador/reassign',headers=auth,json={'motoboy_id':second,'motivo':'Troca local solicitada'})
            assert changed.status_code==200,changed.text
            assert old.receive_json()=={'event':'courier_panel_updated'}
            assert new.receive_json()=={'event':'courier_panel_updated'}
            assert client.get('/comandas/motoboys/painel-entregador',headers={'X-Koma-Delivery-Token':token}).json()['entregas']==[]
            assert client.get('/comandas/motoboys/painel-entregador',headers={'X-Koma-Delivery-Token':second_token}).json()['entregas'][0]['id']==oid

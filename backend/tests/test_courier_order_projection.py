import uuid
from dataclasses import replace
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from app.main import app
from app.database import SessionLocal, engine
from app.models import Restaurante, Usuario, Motoboy, Comanda, Lancamento, Item, Produto, Categoria, ExternalOrderReference, GrupoModificador, OpcaoModificador, ItemModificador
from app.security import create_access_token
from app.services.courier_order_projection import courier_payment, courier_coordinates
from app.application.orders.commands import DeliveryAddressInput
from app.delivery_address_snapshot import persist_delivery_address_snapshot, revise_delivery_address_snapshot


@pytest.mark.parametrize('overrides,expected', [
    ({}, {'status':'collect','amount_due':40,'method':'cash','change_for':100,'change_amount':60}),
    ({'valor_pago':10}, {'status':'collect','amount_due':30,'change_amount':70}),
    ({'online_payment_status':'approved','delivery_forma_pagamento':'pix'}, {'status':'paid','amount_due':0,'change_amount':None}),
    ({'valor_pago':40}, {'status':'paid','amount_due':0}),
    ({'delivery_forma_pagamento':'cartao_debito'}, {'method':'card','change_amount':None,'change_for':None}),
    ({'delivery_forma_pagamento':'pix','online_payment_status':'pending'}, {'status':'check','change_amount':None}),
    ({'delivery_troco_para':20}, {'change_amount':None,'change_needs_check':True}),
    ({'delivery_forma_pagamento':None}, {'method':'unknown','change_amount':None}),
    ({'valor_desconto_cupom':50,'delivery_taxa':0}, {'status':'not_due','amount_due':0}),
])
def test_money_is_canonical_and_change_is_not_a_second_charge(overrides, expected):
    order = SimpleNamespace(itens=[SimpleNamespace(preco_unit=20,status='pronto'),SimpleNamespace(preco_unit=20,status='pronto'),SimpleNamespace(preco_unit=100,status='cancelado')], delivery_taxa=7,valor_desconto_cupom=5,valor_desconto_cashback=2,valor_pago=0,online_payment_status=None,delivery_forma_pagamento='dinheiro',delivery_troco_para=100)
    for key,value in overrides.items(): setattr(order,key,value)
    actual = courier_payment(order)
    for key,value in expected.items(): assert actual[key] == value


@pytest.fixture
def handoff():
    suffix=uuid.uuid4().hex[:8]
    rid=99100+int(suffix[:4],16)
    uid, pid, mid=f'handoff-user-{suffix}',f'handoff-prod-{suffix}',rid*10+1
    def add_order(db,index,provider=None):
        oid,lid=f'handoff-{suffix}-{index}',f'handoff-launch-{suffix}-{index}'
        order=Comanda(id=oid,restaurante_id=rid,garcom_id=uid,identificador='Cliente ifood no nome',numero_pedido=201+index,tipo='Delivery',delivery_status='transito',motoboy_id=mid,delivery_telefone='85988887777',delivery_endereco='Rua antiga, 10',delivery_taxa=7,valor_desconto_cupom=5,valor_desconto_cashback=2,delivery_forma_pagamento='dinheiro',delivery_troco_para=100)
        db.add(order);db.flush()
        db.add(Lancamento(id=lid,comanda_id=oid,restaurante_id=rid,garcom_id=uid,origem='caixa'))
        db.flush()
        for j,(price,status,note) in enumerate([(20,'pronto','Sem cebola'),(20,'pronto',''),(100,'cancelado','Cancelado')]):
            db.add(Item(id=f'{oid}-item-{j}',restaurante_id=rid,comanda_id=oid,lancamento_id=lid,produto_id=pid,preco_unit=price,status=status,observacao=note))
        if provider:
            db.add(ExternalOrderReference(id=f'ref-{oid}',restaurante_id=rid,provider=provider,external_order_id=f'partner-{index}',internal_order_id=oid if provider=='keeta' else lid,raw_payload={'phone':'not-for-the-courier','payments':{'unverified':True}}))
        db.flush()
        return oid
    with SessionLocal() as db:
        db.add(Restaurante(id=rid,nome='Handoff local',plano='premium',saas_status='active'));db.flush()
        db.add(Usuario(id=uid,restaurante_id=rid,nome='Caixa local',role='admin',cargo='admin',status='ativo'))
        db.add(Categoria(id=f'cat-{suffix}',restaurante_id=rid,nome='Lanches'));db.flush()
        db.add(Produto(id=pid,restaurante_id=rid,categoria_id=f'cat-{suffix}',nome='Hambúrguer',preco=999))
        db.add(Motoboy(id=mid,restaurante_id=rid,nome='Lucas',telefone='85999990000',ativo=True));db.flush()
        first=add_order(db,0)
        db.commit()
    client=TestClient(app, client=(f'handoff-{suffix}',50000))
    auth={'Authorization':'Bearer '+create_access_token(subject=uid,restaurante_id=rid,role='admin')}
    link=client.post(f'/comandas/motoboys/{mid}/gerar-link',headers=auth)
    assert link.status_code==200,link.text
    return SimpleNamespace(rid=rid,uid=uid,pid=pid,first=first,add_order=add_order,client=client,headers={'X-Koma-Delivery-Token':link.json()['token']})


def test_real_panel_handoff_has_items_latest_address_and_no_partner_side_effects(handoff):
    h=handoff
    with SessionLocal() as db:
        address=DeliveryAddressInput(street='Rua inicial',number='10',neighborhood='Centro',city='Fortaleza',state='CE',postal_code='60000000',complement='Casa azul',reference='Em frente à praça',latitude=-3.75,longitude=-38.5)
        persist_delivery_address_snapshot(db,restaurante_id=h.rid,comanda_id=h.first,address=address)
        revise_delivery_address_snapshot(db,restaurante_id=h.rid,comanda_id=h.first,address=replace(address,street='Rua corrigida',number='99',complement='Portão lateral',latitude=-3.73,longitude=-38.52),operator_id=h.uid,reason='Correção solicitada pelo cliente')
        db.add(GrupoModificador(id='g-'+h.pid,restaurante_id=h.rid,nome='Adicionais'));db.flush()
        db.add(OpcaoModificador(id='m-'+h.pid,restaurante_id=h.rid,grupo_id='g-'+h.pid,nome='Queijo extra',preco_adicional=3));db.flush()
        db.add(ItemModificador(restaurante_id=h.rid,item_id=h.first+'-item-0',opcao_modificador_id='m-'+h.pid,preco_aplicado=3))
        for i,provider in enumerate(['ifood','99food','keeta'],1): h.add_order(db,i,provider)
        db.commit()
    response=h.client.get('/comandas/motoboys/painel-entregador',headers=h.headers)
    assert response.status_code==200,response.text
    payload=response.json(); assert payload['contract_version']==2
    local=next(item for item in payload['entregas'] if item['id']==h.first)
    assert local['source']['label']=='Caixa'  # Never infer channel from customer name.
    assert local['payment']['amount_due']==40 and local['payment']['change_amount']==60
    assert local['total']==40  # Snapshot price, excludes cancellation and discounts.
    assert local['destination']['label'].startswith('Rua corrigida, 99')
    assert local['destination']['complement']=='Portão lateral'
    assert local['destination']['reference']=='Em frente à praça'
    assert local['destination']['latitude']==-3.73 and local['destination']['longitude']==-38.52
    assert sum(item['quantity'] for item in local['items'])==2
    assert any(item['notes']=='Sem cebola' and item['modifiers']==['Queijo extra'] for item in local['items'])
    assert '85988887777' not in response.text and 'not-for-the-courier' not in response.text
    for item in payload['entregas']:
        if item['id']==h.first: continue
        assert item['source']['channel'] in {'ifood','99food','keeta'}
        assert item['confirmation']['mode']=='local_internal' and item['confirmation']['enabled'] is True
        completed=h.client.post(f"/comandas/motoboys/pedidos/{item['id']}/confirmar-entrega",headers=h.headers)
        assert completed.status_code==200,completed.text
        with SessionLocal() as db:
            row=db.get(Comanda,item['id'])
            assert row.delivery_status=='finalizado' and not row.fechada
            assert float(row.valor_pago or 0)==0
            assert db.query(ExternalOrderReference).filter_by(restaurante_id=h.rid,internal_order_id=item['id']).count() <= 1


def test_panel_queries_do_not_grow_per_delivery(handoff):
    h=handoff
    def measure():
        queries=[]
        def record(conn,cursor,statement,parameters,context,executemany):
            if statement.lstrip().upper().startswith('SELECT'): queries.append(statement)
        event.listen(engine,'before_cursor_execute',record)
        try:
            response=h.client.get('/comandas/motoboys/painel-entregador',headers=h.headers)
            assert response.status_code==200,response.text
            return len(queries),len(response.json()['entregas'])
        finally: event.remove(engine,'before_cursor_execute',record)
    one,count=measure();assert count==1
    with SessionLocal() as db:
        for i in range(1,13): h.add_order(db,i)
        db.commit()
    many,count=measure();assert count==13
    assert many<=one+1, (one,many)
    assert many<=20,(one,many)


@pytest.mark.parametrize('address', [None, {}, {'latitude': 10}, {'latitude': True, 'longitude': 20},
    {'latitude': '10', 'longitude': '20'}, {'latitude': float('nan'), 'longitude': 20},
    {'latitude': 10, 'longitude': float('inf')}, {'latitude': 91, 'longitude': 20},
    {'latitude': 0, 'longitude': 0}, {'latitude': 10**1000, 'longitude': 20}])
def test_courier_does_not_publish_unusable_coordinates(address):
    assert courier_coordinates(address) == {'latitude': None, 'longitude': None}


def test_courier_corrected_address_does_not_reuse_obsolete_coordinates(handoff):
    h = handoff
    with SessionLocal() as db:
        address = DeliveryAddressInput(street='Rua inicial',number='10',neighborhood='Centro',city='Fortaleza',state='CE',postal_code='60000000',latitude=-3.75,longitude=-38.5)
        persist_delivery_address_snapshot(db,restaurante_id=h.rid,comanda_id=h.first,address=address)
        revise_delivery_address_snapshot(db,restaurante_id=h.rid,comanda_id=h.first,address=replace(address,street='Rua nova',latitude=None,longitude=None),operator_id=h.uid,reason='Novo endereço confirmado')
        db.commit()
    response = h.client.get('/comandas/motoboys/painel-entregador', headers=h.headers)
    assert response.status_code == 200, response.text
    destination = response.json()['entregas'][0]['destination']
    assert destination['label'].startswith('Rua nova')
    assert destination['latitude'] is None and destination['longitude'] is None


def test_code_cannot_confirm_another_tenant_or_another_couriers_order(handoff):
    from app.crypt import encrypt_field
    from app.models import MotoboyTokenAtivo
    from app.security import create_motoboy_token
    h = handoff
    with SessionLocal() as db:
        order = db.get(Comanda, h.first)
        owner = order.motoboy_id
        order.delivery_receipt_secret = encrypt_field('007')
        other_rid, other_mid = h.rid + 1000000, owner + 10000000
        db.add(Restaurante(id=other_rid,nome='Other isolated restaurant',plano='premium',saas_status='active'))
        db.flush()
        for mid, rid, jti in [(other_mid,other_rid,'other-tenant-'+h.first),(owner+1,h.rid,'other-courier-'+h.first)]:
            db.add(Motoboy(id=mid,restaurante_id=rid,nome='Other courier',ativo=True,telefone='85999990000'))
            db.flush()
            db.add(MotoboyTokenAtivo(jti=jti,motoboy_id=mid,restaurante_id=rid,revogado=False))
        db.commit()
    endpoint = f'/comandas/motoboys/pedidos/{h.first}/confirmar-entrega'
    for mid, rid, jti, status in [(other_mid,other_rid,'other-tenant-'+h.first,404),(owner+1,h.rid,'other-courier-'+h.first,409)]:
        token = create_motoboy_token(mid,rid,jti)
        response = h.client.post(endpoint,headers={'X-Koma-Delivery-Token':token},json={'code':'007'})
        assert response.status_code == status, response.text
    with SessionLocal() as db:
        row=db.get(Comanda,h.first)
        assert row.delivery_status == 'transito' and not row.delivery_receipt_failed_attempts
    ok = h.client.post(endpoint,headers=h.headers,json={'code':'007'})
    assert ok.status_code == 200, ok.text

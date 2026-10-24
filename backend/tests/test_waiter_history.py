from datetime import datetime
from types import SimpleNamespace
from fastapi import HTTPException
from app.database import current_restaurante_id
from app.routes.waiter_history import list_own_history, own_history_detail

from app.database import SessionLocal
from app.models import Comanda, Item, Lancamento
from app.operational_models import AtendimentoMesa, LancamentoIdentidade
from app.security import create_access_token
from tests.characterization.orders.fixtures import CHAR_RESTAURANT_ID, char_client, char_setup


def test_history_is_own_paginated_local_day_with_official_identity_and_detail(char_client, char_setup):
    db = SessionLocal()
    try:
        check = Comanda(id='history-check', restaurante_id=CHAR_RESTAURANT_ID, mesa_id=1, garcom_id='usr-char-admin', tipo='Consumo no Local', fechada=True, numero_pedido=124)
        db.add(check)
        db.add(AtendimentoMesa(id='history-session', restaurante_id=CHAR_RESTAURANT_ID, numero_conta=124, periodo_ref='2026-10', mesa_id=1))
        db.flush()
        for index, (user, stamp) in enumerate([('usr-char-garcom', '2026-10-24T02:59:59'), ('usr-char-garcom', '2026-10-24T03:00:00'), ('usr-char-admin', '2026-10-24T13:00:00'), ('usr-char-garcom', '2026-10-24T14:00:00'), ('usr-char-garcom', '2026-10-24T15:00:00')]):
            launch_id = f'history-{index}'
            db.add(Lancamento(id=launch_id, restaurante_id=CHAR_RESTAURANT_ID, comanda_id=check.id, garcom_id=user, timestamp=datetime.fromisoformat(stamp), origem='garcom'))
            db.flush()
            db.add(Item(id=f'history-item-{index}', restaurante_id=CHAR_RESTAURANT_ID, comanda_id=check.id, lancamento_id=launch_id, produto_id='prod-char-simples', preco_unit=42, observacao='Sem cebola', cliente_nome='Ana', status='entregue'))
        db.add(LancamentoIdentidade(restaurante_id=CHAR_RESTAURANT_ID, atendimento_id='history-session', lancamento_id='history-4', sequencia=27))
        db.commit()
        token = create_access_token(subject='usr-char-garcom', restaurante_id=CHAR_RESTAURANT_ID, role='garcom')
        headers = {'Authorization': f'Bearer {token}'}
        page = char_client.get('/garcom/historico?dia=2026-10-24&limite=2', headers=headers)
        assert page.status_code == 200, page.text
        rows = page.json()['items']
        assert [row['id'] for row in rows] == ['history-4', 'history-3']
        assert rows[0]['pedido'] == '124-AA'
        assert rows[0]['horario'] == '2026-10-24T15:00:00+00:00'
        assert rows[0]['itens_count'] == 1
        next_page = char_client.get('/garcom/historico?dia=2026-10-24&limite=2&antes=history-3', headers=headers)
        assert [row['id'] for row in next_page.json()['items']] == ['history-1']
        assert next_page.json()['items'][0]['pedido'] is None
        assert next_page.json()['next_cursor'] is None
        detail = char_client.get('/garcom/historico/history-4', headers=headers)
        assert detail.status_code == 200, detail.text
        assert detail.json()['itens'][0]['observacao'] == 'Sem cebola'
        assert detail.json()['itens'][0]['cliente'] == 'Ana'
        assert detail.json()['itens'][0]['preco'] == 42
        assert char_client.get('/garcom/historico/history-2', headers=headers).status_code == 404
        assert char_client.get('/garcom/historico?dia=2026-10-24&antes=history-2', headers=headers).status_code == 422
        other_tenant = {'Authorization': f'Bearer {create_access_token(subject="usr-char-garcom", restaurante_id=778, role="garcom")}'}
        assert char_client.get('/garcom/historico/history-4', headers=other_tenant).status_code in (401, 403, 404)
        assert char_client.get('/garcom/historico?dia=invalid', headers=headers).status_code == 422
        assert char_client.get('/garcom/historico?limite=500', headers=headers).status_code == 422
        tenant_scope = current_restaurante_id.set(778)
        try:
            other = SimpleNamespace(id='usr-char-garcom')
            assert list_own_history(dia='2026-10-24', antes=None, limite=20, db=db, current_user=other)['items'] == []
            try:
                own_history_detail('history-4', db=db, current_user=other)
                raise AssertionError('Cross-tenant history detail must be rejected')
            except HTTPException as error:
                assert error.status_code == 404
        finally:
            current_restaurante_id.reset(tenant_scope)

    finally:
        db.rollback()
        db.query(Item).filter(Item.restaurante_id == CHAR_RESTAURANT_ID, Item.id.like('history-item-%')).delete(synchronize_session=False)
        db.query(LancamentoIdentidade).filter(LancamentoIdentidade.restaurante_id == CHAR_RESTAURANT_ID, LancamentoIdentidade.lancamento_id.like('history-%')).delete(synchronize_session=False)
        db.query(Lancamento).filter(Lancamento.restaurante_id == CHAR_RESTAURANT_ID, Lancamento.id.like('history-%')).delete(synchronize_session=False)
        db.query(Comanda).filter(Comanda.restaurante_id == CHAR_RESTAURANT_ID, Comanda.id == 'history-check').delete(synchronize_session=False)
        db.query(AtendimentoMesa).filter(AtendimentoMesa.restaurante_id == CHAR_RESTAURANT_ID, AtendimentoMesa.id == 'history-session').delete(synchronize_session=False)
        db.commit()
        db.close()

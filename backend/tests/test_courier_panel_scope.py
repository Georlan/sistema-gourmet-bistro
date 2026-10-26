"""The courier panel is a delivery-only projection scoped to its assignment."""
import uuid

from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal
from app.models import Restaurante, Usuario, Motoboy, Comanda, MotoboyTokenAtivo
from app.security import create_access_token


def test_panel_requires_cashier_dispatch_and_never_exposes_customer_phone():
    restaurant_id, other_restaurant_id = 99031, 99032
    suffix = uuid.uuid4().hex[:8]
    user_id = f'courier-scope-{suffix}'
    own_id, other_id = 9903101, 9903102
    states = [
        ('own-ready', 'Delivery', 'pronto', own_id, restaurant_id, False),
        ('own-route', 'Entrega', 'transito', own_id, restaurant_id, False),
        ('pickup', 'Retirada', 'pronto', own_id, restaurant_id, False),
        ('table', 'Consumo no Local', 'pronto', own_id, restaurant_id, False),
        ('unassigned', 'Delivery', 'transito', None, restaurant_id, False),
        ('other-courier', 'Delivery', 'transito', other_id, restaurant_id, False),
        ('other-tenant', 'Delivery', 'transito', None, other_restaurant_id, False),
        ('closed', 'Delivery', 'transito', own_id, restaurant_id, True),
        ('preparing', 'Delivery', 'producao', own_id, restaurant_id, False),
    ]
    with SessionLocal() as db:
        db.add_all([
            Restaurante(id=restaurant_id, nome='Courier scope local', plano='premium', saas_status='active'),
            Restaurante(id=other_restaurant_id, nome='Other scope local', plano='premium', saas_status='active'),
        ])
        db.flush()
        db.add(Usuario(id=user_id, restaurante_id=restaurant_id, nome='Admin local', role='admin', cargo='admin', status='ativo'))
        db.add_all([Motoboy(id=own_id, restaurante_id=restaurant_id, nome='Own courier', telefone='85999990001', ativo=True),
                    Motoboy(id=other_id, restaurante_id=restaurant_id, nome='Other courier', telefone='85999990002', ativo=True)])
        db.flush()
        db.add_all([Comanda(id=f'{label}-{suffix}', restaurante_id=tenant, garcom_id=user_id,
                          identificador=label, numero_pedido=1000 + index, tipo=kind, delivery_status=status, motoboy_id=courier,
                          fechada=closed, delivery_telefone='85988887777') for index, (label, kind, status, courier, tenant, closed) in enumerate(states)])
        db.commit()
    client = TestClient(app)
    admin_token = create_access_token(subject=user_id, restaurante_id=restaurant_id, role='admin')
    link = client.post(f'/comandas/motoboys/{own_id}/gerar-link', headers={'Authorization': f'Bearer {admin_token}'})
    assert link.status_code == 200, link.text
    panel = client.get('/comandas/motoboys/painel-entregador', headers={'X-Koma-Delivery-Token': link.json()['token']})
    assert panel.status_code == 200, panel.text
    assert {item['id'] for item in panel.json()['entregas']} == {f'own-route-{suffix}'}

    assert all('delivery_telefone' not in item for item in panel.json()['entregas'])
    assert '85988887777' not in panel.text
    ready_id = f'own-ready-{suffix}'
    courier_headers = {'X-Koma-Delivery-Token': link.json()['token']}
    early = client.post(f'/comandas/motoboys/pedidos/{ready_id}/confirmar-entrega', headers=courier_headers)
    assert early.status_code == 409, early.text
    with SessionLocal() as db:
        assert db.get(Comanda, ready_id).delivery_status == 'pronto'
    dispatched = client.post(f'/comandas/{ready_id}/delivery/despachar', json={'motoboy_id': own_id}, headers={'Authorization': f'Bearer {admin_token}'})
    assert dispatched.status_code == 200, dispatched.text
    assert dispatched.json()['delivery_status'] == 'transito'
    # Customer contact remains on the authorized cashier projection, not the courier API.
    assert dispatched.json()['delivery_telefone'] == '85988887777'
    refreshed = client.get('/comandas/motoboys/painel-entregador', headers=courier_headers)
    assert refreshed.status_code == 200, refreshed.text
    assert {item['id'] for item in refreshed.json()['entregas']} == {ready_id, f'own-route-{suffix}'}
    assert '85988887777' not in refreshed.text

    with SessionLocal() as db:
        assert db.query(MotoboyTokenAtivo).filter_by(restaurante_id=restaurant_id, motoboy_id=own_id, revogado=False).count() == 1
    # Explicit rotation still revokes the previous link after dispatch reused it.
    rotated = client.post(f'/comandas/motoboys/{own_id}/gerar-link', headers={'Authorization': f'Bearer {admin_token}'})
    assert rotated.status_code == 200
    assert client.get('/comandas/motoboys/painel-entregador', headers=courier_headers).status_code == 401


def test_dispatch_access_preserves_deadline_and_replaces_only_expired_access():
    import datetime
    import pytest
    from fastapi import HTTPException
    from app.security import create_motoboy_token, verify_motoboy_token
    from app.routes.orders import _criar_acesso_motoboy
    from app.database import tenant_session_scope

    rid, mid = 99033, 9903301
    now = datetime.datetime.now(datetime.timezone.utc)
    original_created = now - datetime.timedelta(hours=3)
    deadline = original_created + datetime.timedelta(hours=4)
    with SessionLocal() as db, tenant_session_scope(db, rid):
        db.add(Restaurante(id=rid, nome='Courier TTL local', plano='premium', saas_status='active'))
        db.flush()
        courier = Motoboy(id=mid, restaurante_id=rid, nome='TTL courier', telefone='85999990003', ativo=True)
        db.add(courier)
        db.flush()
        row = MotoboyTokenAtivo(jti='courier-ttl-original', motoboy_id=mid, restaurante_id=rid, criado_em=original_created, revogado=False)
        db.add(row)
        db.commit()
        original = create_motoboy_token(mid, rid, row.jti, expires_at=deadline)
        for _ in range(2):
            access = _criar_acesso_motoboy(db, courier, rid, reuse_active=True)
            assert access['token'] == original
            assert datetime.datetime.fromisoformat(access['expires_at']) == deadline
            assert verify_motoboy_token(access['token'], db)['jti'] == row.jti
        assert db.query(MotoboyTokenAtivo).filter_by(restaurante_id=rid).count() == 1
        # Simulate elapsed time beyond the four-hour token TTL without sleeping.
        row.criado_em = now - datetime.timedelta(hours=5)
        db.commit()
        expired = create_motoboy_token(mid, rid, row.jti, expires_at=now - datetime.timedelta(hours=1))
        with pytest.raises(HTTPException) as rejected:
            verify_motoboy_token(expired, db)
        assert rejected.value.status_code == 401
        renewed = _criar_acesso_motoboy(db, courier, rid, reuse_active=True)
        db.commit()
        assert verify_motoboy_token(renewed['token'], db)['jti'] != row.jti
        assert db.query(MotoboyTokenAtivo).filter_by(restaurante_id=rid, revogado=False).count() == 1
        with pytest.raises(HTTPException):
            verify_motoboy_token(original, db)

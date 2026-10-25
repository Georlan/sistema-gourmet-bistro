"""The courier panel is a delivery-only projection scoped to its assignment."""
import uuid

from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal
from app.models import Restaurante, Usuario, Motoboy, Comanda
from app.security import create_access_token


def test_panel_only_returns_own_assigned_deliveries_not_pickup_or_other_tenants():
    restaurant_id, other_restaurant_id = 99031, 99032
    suffix = uuid.uuid4().hex[:8]
    user_id = f'courier-scope-{suffix}'
    own_id, other_id = 9903101, 9903102
    states = [
        ('own-ready', 'Delivery', 'pronto', own_id, restaurant_id, False),
        ('own-route', 'Entrega', 'transito', own_id, restaurant_id, False),
        ('pickup', 'Retirada', 'pronto', own_id, restaurant_id, False),
        ('table', 'Consumo no Local', 'pronto', own_id, restaurant_id, False),
        ('unassigned', 'Delivery', 'pronto', None, restaurant_id, False),
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
                          fechada=closed) for index, (label, kind, status, courier, tenant, closed) in enumerate(states)])
        db.commit()
    client = TestClient(app)
    admin_token = create_access_token(subject=user_id, restaurante_id=restaurant_id, role='admin')
    link = client.post(f'/comandas/motoboys/{own_id}/gerar-link', headers={'Authorization': f'Bearer {admin_token}'})
    assert link.status_code == 200, link.text
    panel = client.get('/comandas/motoboys/painel-entregador', headers={'X-Koma-Delivery-Token': link.json()['token']})
    assert panel.status_code == 200, panel.text
    assert {item['id'] for item in panel.json()['entregas']} == {f'own-ready-{suffix}', f'own-route-{suffix}'}

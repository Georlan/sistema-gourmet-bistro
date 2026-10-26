"""The unified login can only exchange a courier's own active tenant identity."""
import uuid
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal, current_restaurante_id
from app.models import Restaurante, Usuario, Motoboy, MotoboyTokenAtivo
from app.security import create_access_token, verify_motoboy_token

client = TestClient(app)
PATH = '/comandas/motoboys/me/acesso'

@pytest.fixture
def identity():
    rid = 99161
    context = current_restaurante_id.set(rid)
    uid = 'courier-login-' + uuid.uuid4().hex[:10]
    try:
        with SessionLocal() as db:
            restaurant = db.get(Restaurante,rid)
            if not restaurant:
                restaurant = Restaurante(id=rid,nome='Courier login fixture',slug='courier-login-fixture',plano='premium')
                db.add(restaurant)
            restaurant.plano = 'premium'
            user = Usuario(id=uid,nome='Courier login',cargo='motoboy',restaurante_id=rid,status='ativo')
            db.add(user); db.flush()
            own = Motoboy(id=1_000_000+int(uuid.uuid4().hex[:7],16),nome='Courier login',telefone='11999999001',usuario_id=uid,restaurante_id=rid,ativo=True)
            other = Motoboy(id=1_000_000+int(uuid.uuid4().hex[:7],16),nome='Other courier',telefone='11999999002',restaurante_id=rid,ativo=True)
            db.add_all([own,other]); db.commit()
            result = (rid,uid,own.id,other.id)
        yield result
    finally:
        current_restaurante_id.reset(context)

def headers(identity):
    rid,uid,*_ = identity
    return {'Authorization':'Bearer '+create_access_token(subject=uid,restaurante_id=rid)}

def test_exchange_selects_own_courier_and_reuses_deadline_without_revocation(identity):
    rid,uid,own,other = identity
    first = client.post(PATH,headers=headers(identity),json={'motoboy_id':other,'restaurante_id':99162})
    assert first.status_code == 200,first.text
    second = client.post(PATH,headers=headers(identity))
    assert second.status_code == 200,second.text
    one = verify_motoboy_token(first.json()['token'])
    two = verify_motoboy_token(second.json()['token'])
    assert one['motoboy_id'] == own and one['restaurante_id'] == rid
    assert two['jti'] == one['jti']
    assert second.json()['expires_at'] == first.json()['expires_at']
    with SessionLocal() as db:
        assert db.query(MotoboyTokenAtivo).filter_by(restaurante_id=rid,motoboy_id=own,revogado=False).count() == 1
        assert db.query(MotoboyTokenAtivo).filter_by(restaurante_id=rid,motoboy_id=other).count() == 0

@pytest.mark.parametrize('role',['admin','gerente','caixa','garcom','cozinha'])
def test_exchange_does_not_escalate_other_staff_roles(identity,role):
    with SessionLocal() as db:
        db.get(Usuario,identity[1]).cargo=role;db.commit()
    assert client.post(PATH,headers=headers(identity)).status_code == 403

@pytest.mark.parametrize('state',['inactive_user','inactive_profile','unlinked'])
def test_exchange_requires_active_user_and_linked_profile(identity,state):
    with SessionLocal() as db:
        if state=='inactive_user': db.get(Usuario,identity[1]).status='inativo'
        elif state=='inactive_profile': db.get(Motoboy,identity[2]).ativo=False
        else: db.get(Motoboy,identity[2]).usuario_id=None
        db.commit()
    assert client.post(PATH,headers=headers(identity)).status_code in (401,403)

@pytest.mark.parametrize('plan',['pocket','pro'])
def test_exchange_preserves_plan_entitlement(identity,plan):
    with SessionLocal() as db:
        db.get(Restaurante,identity[0]).plano=plan;db.commit()
    assert client.post(PATH,headers=headers(identity)).status_code == 403

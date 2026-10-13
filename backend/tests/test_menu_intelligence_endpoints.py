"""HTTP permissions and side-effect boundaries for menu analysis/simulation."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from app.database import Base, get_db, current_restaurante_id
from app.main import app
from app.models import Restaurante, Usuario
from app.security import get_current_user

T = 9937
PAYLOAD = dict(preco_atual='10', custo_atual='1', quantidade_atual=59,
               preco_proposto='11', custo_proposto='1', quantidades=[54, 59, 65])


@pytest.fixture
def context():
    engine = create_engine('sqlite:///:memory:', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    overrides = dict(app.dependency_overrides)
    token = current_restaurante_id.set(T)
    with Session(engine) as db:
        restaurant = Restaurante(id=T, nome='Menu test', plano='pro')
        db.add(restaurant); db.flush()
        user = Usuario(id='menu-http-user', restaurante_id=T, nome='User', usuario='menu-http-user', senha_hash='unused', role='admin', status='ativo')
        db.add(user); db.commit()
        def database():
            yield db
        def current_user():
            current_restaurante_id.set(T)
            return user
        app.dependency_overrides[get_db] = database
        app.dependency_overrides[get_current_user] = current_user
        with TestClient(app) as client:
            yield client, db, restaurant, user
    app.dependency_overrides.clear(); app.dependency_overrides.update(overrides)
    current_restaurante_id.reset(token)
    engine.dispose()


def test_new_calculation_and_report_have_one_http_owner_and_no_writes(context):
    client, db, _, _ = context
    statements = []
    def record(_c, _cursor, statement, *_rest):
        statements.append(statement.lstrip().upper())
    event.listen(db.bind, 'before_cursor_execute', record)
    try:
        report = client.get('/relatorios/inteligencia-cardapio?data_inicio=2026-10-01&data_fim=2026-10-07')
        assert report.status_code == 200 and report.json()['schema_version'] == 2
        result = client.post('/relatorios/inteligencia-cardapio/simulacoes', json=PAYLOAD)
        assert result.status_code == 200
        assert result.json()['unidades_para_preservar'] == 54
        assert result.json()['natureza'] == 'simulacao_hipotetica_sem_alteracao_do_cardapio'
    finally:
        event.remove(db.bind, 'before_cursor_execute', record)
    assert not any(s.startswith(('INSERT', 'UPDATE', 'DELETE')) for s in statements)


@pytest.mark.parametrize('path', ['/relatorios/inteligencia-cardapio', '/relatorios/inteligencia-cardapio/simulacoes'])
def test_both_rbac_and_plan_are_required(context, path):
    client, db, restaurant, user = context
    call = lambda: client.post(path, json=PAYLOAD) if path.endswith('simulacoes') else client.get(path)
    restaurant.plano = 'pocket'; db.commit()
    assert call().status_code == 403
    restaurant.plano = 'pro'; user.role = 'garcom'; db.commit()
    assert call().status_code == 403
    user.role = 'gerente'; db.commit()
    assert call().status_code == 200


@pytest.mark.parametrize('change', [
    {'custo_atual': '-1'}, {'preco_proposto': 'NaN'}, {'custo_proposto': '0.001'},
    {'quantidade_atual': 1.5}, {'quantidades': [1, 2]}, {'quantidades': [1, 2, 2.5]},
    {'quantidades': [1, 2, True]}, {'quantidades': [1, 2, -1]},
    {'quantidades': [1, 2, 1_000_001]}, {'aplicar_preco': True},
])
def test_simulation_rejects_invalid_or_mutating_payloads(context, change):
    client, *_ = context
    assert client.post('/relatorios/inteligencia-cardapio/simulacoes', json=PAYLOAD | change).status_code == 422


def test_invalid_dates_and_unauthenticated_calculation(context):
    client, *_ = context
    assert client.get('/relatorios/inteligencia-cardapio?data_inicio=2026-10-10&data_fim=2026-10-01').status_code == 400
    app.dependency_overrides.pop(get_current_user)
    assert client.post('/relatorios/inteligencia-cardapio/simulacoes', json=PAYLOAD).status_code == 401

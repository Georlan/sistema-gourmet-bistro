from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, current_restaurante_id, get_db
from app.main import app
from app.models import Restaurante, Usuario, Motoboy, ActivityLog
from app.security import get_password_hash


DB_FILE = "./test_team_admin_delete_authorization.db"
engine = create_engine(
    f"sqlite:///{DB_FILE}",
    connect_args={"check_same_thread": False, "timeout": 30},
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def setup_database():
    tenant_token = current_restaurante_id.set(1)
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    with TestingSessionLocal() as db:
        db.merge(Restaurante(id=1, nome="Security Bistro", slug="security-bistro", plano="pro"))
        db.add_all(
            [
                Usuario(
                    id="admin-primary",
                    restaurante_id=1,
                    nome="Admin Primary",
                    email="admin-primary@example.test",
                    senha_hash=get_password_hash("strong-password"),
                    role="admin",
                    cargo="admin",
                    status="ativo",
                ),
                Usuario(
                    id="admin-backup",
                    restaurante_id=1,
                    nome="Admin Backup",
                    email="admin-backup@example.test",
                    senha_hash=get_password_hash("strong-password"),
                    role="admin",
                    cargo="admin",
                    status="ativo",
                ),
                Usuario(
                    id="cashier-operator",
                    restaurante_id=1,
                    nome="Cashier Operator",
                    email="cashier@example.test",
                    senha_hash=get_password_hash("strong-password"),
                    role="caixa",
                    cargo="caixa",
                    status="ativo",
                ),
            ]
        )
        db.commit()

    yield

    app.dependency_overrides.pop(get_db, None)
    current_restaurante_id.reset(tenant_token)
    engine.dispose()
    for suffix in ("", "-wal", "-shm", "-journal"):
        Path(f"{DB_FILE}{suffix}").unlink(missing_ok=True)


def _headers(client: TestClient, email: str) -> dict[str, str]:
    response = client.post(
        "/auth/login",
        json={"username": email, "password": "strong-password"},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_cashier_cannot_delete_admin_when_another_admin_would_remain():
    client = TestClient(app)
    response = client.delete(
        "/auth/usuarios/admin-primary",
        headers=_headers(client, "cashier@example.test"),
    )

    assert response.status_code == 403, response.text
    assert "Somente administradores" in response.json()["detail"]

    with TestingSessionLocal() as db:
        target = db.query(Usuario).filter(Usuario.id == "admin-primary").one()
        assert target.status == "ativo"


def test_admin_can_delete_another_admin_when_backup_remains():
    client = TestClient(app)
    response = client.delete(
        "/auth/usuarios/admin-primary",
        headers=_headers(client, "admin-backup@example.test"),
    )

    assert response.status_code == 204, response.text
    with TestingSessionLocal() as db:
        deactivated = db.query(Usuario).filter(Usuario.id == "admin-primary").one()
        assert deactivated.status == "inativo"
        backup = db.query(Usuario).filter(Usuario.id == "admin-backup").one()
        assert backup.status == "ativo"
    assert client.post(
        "/auth/login",
        json={"username": "admin-primary@example.test", "password": "strong-password"},
    ).status_code == 403


@pytest.mark.parametrize('initial_status', ['ativo', 'pendente_ativacao', 'inativo'])
def test_remove_member_releases_contacts_and_preserves_identity(initial_status):
    with TestingSessionLocal() as db:
        db.add(Usuario(id='former-member', restaurante_id=1, nome='Old Member',
                       telefone='88999616937', email='member@example.test', cargo='cozinha',
                       status=initial_status, senha_hash=get_password_hash('strong-password'),
                       token_convite='old-invitation'))
        db.commit()
    client = TestClient(app)
    headers = _headers(client, 'cashier@example.test')
    old_headers = _headers(client, 'member@example.test') if initial_status == 'ativo' else None
    url = '/auth/usuarios/former-member?remover_cadastro=true'
    assert client.delete(url, headers=headers).status_code == 204
    assert client.delete(url, headers=headers).status_code == 204
    with TestingSessionLocal() as db:
        former = db.get(Usuario, 'former-member')
        assert former.nome == 'Old Member'
        assert former.status == 'inativo'
        assert former.removed_at is not None
        assert former.telefone is None and former.email is None
        assert former.senha_hash is None and former.token_convite is None
        assert db.query(ActivityLog).filter(ActivityLog.action == 'TEAM_MEMBER_REMOVE').count() == 1
    if old_headers:
        assert client.get('/caixa/funcionarios', headers=old_headers).status_code == 401
    for path in ['/caixa/funcionarios', '/auth/usuarios']:
        assert 'former-member' not in [u['id'] for u in client.get(path, headers=headers).json()]
    assert client.patch('/auth/usuarios/former-member', headers=headers,
                        json={'status': 'ativo'}).status_code == 404
    response = client.post('/caixa/funcionarios', headers=headers,
                           json={'nome': 'New Member', 'telefone': '88999616937', 'cargo': 'cozinha'})
    assert response.status_code == 201, response.text
    assert response.json()['id'] != 'former-member'
    assert client.post('/auth/ativar', json={'token_convite': 'old-invitation', 'email': 'member@example.test',
                                            'senha': 'new-password'}).status_code == 400


def test_removal_respects_self_admin_and_tenant_boundaries():
    client = TestClient(app)
    headers = _headers(client, 'cashier@example.test')
    assert client.delete('/auth/usuarios/cashier-operator?remover_cadastro=true', headers=headers).status_code == 409
    assert client.delete('/auth/usuarios/admin-primary?remover_cadastro=true', headers=headers).status_code == 403
    with TestingSessionLocal() as db:
        db.add(Restaurante(id=2, nome='Other', slug='other', plano='pro'))
        db.add(Usuario(id='foreign-member', restaurante_id=2, nome='Foreign', cargo='cozinha', status='inativo', telefone='88999616937'))
        db.commit()
    assert client.delete('/auth/usuarios/foreign-member?remover_cadastro=true', headers=headers).status_code == 404
    current_restaurante_id.set(2)
    with TestingSessionLocal() as db:
        assert db.get(Usuario, 'foreign-member').removed_at is None


def test_removing_courier_does_not_rebind_historical_courier_to_new_member():
    with TestingSessionLocal() as db:
        db.add(Usuario(id='old-courier', restaurante_id=1, nome='Old Courier', telefone='88999616937', cargo='motoboy', status='inativo'))
        db.flush()
        courier = Motoboy(restaurante_id=1, usuario_id='old-courier', nome='Old Courier', telefone='88999616937', ativo=False)
        db.add(courier)
        db.commit()
        old_courier_id = courier.id
    client = TestClient(app)
    headers = _headers(client, 'cashier@example.test')
    assert client.delete('/auth/usuarios/old-courier?remover_cadastro=true', headers=headers).status_code == 204
    response = client.post('/caixa/funcionarios', headers=headers, json={'nome': 'New Courier', 'telefone': '88999616937', 'cargo': 'motoboy'})
    assert response.status_code == 201, response.text
    with TestingSessionLocal() as db:
        old = db.get(Motoboy, old_courier_id)
        assert old.usuario_id == 'old-courier' and old.nome == 'Old Courier' and not old.ativo
        new = db.query(Motoboy).filter(Motoboy.usuario_id == response.json()['id']).one()
        assert new.id != old_courier_id and new.ativo

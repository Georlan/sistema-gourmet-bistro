import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.main import app
from app.models import CaixaTurno, Restaurante, Usuario
from app.security import get_password_hash
from app.smartpos_models import RestauranteCapability


client = TestClient(app)
RESTAURANTE_ID = 9303
USER_ID = "smartpos-stage3-garcom"
EMAIL = "smartpos-stage3@koma.test"
PASSWORD = "senha123"


@pytest.fixture(autouse=True)
def setup_smartpos_stage3():
    Base.metadata.create_all(bind=engine)
    token = current_restaurante_id.set(RESTAURANTE_ID)
    db = SessionLocal()
    try:
        db.query(CaixaTurno).filter(CaixaTurno.restaurante_id == RESTAURANTE_ID).delete()
        db.query(RestauranteCapability).filter(
            RestauranteCapability.restaurante_id == RESTAURANTE_ID
        ).delete()
        db.query(Usuario).filter(Usuario.id == USER_ID).delete()
        restaurante = db.query(Restaurante).filter(Restaurante.id == RESTAURANTE_ID).first()
        if not restaurante:
            restaurante = Restaurante(
                id=RESTAURANTE_ID,
                nome="SmartPOS Stage 3",
                plano="pocket",
            )
            db.add(restaurante)
            db.flush()

        db.add(Usuario(
            id=USER_ID,
            nome="Garçom SmartPOS",
            email=EMAIL,
            senha_hash=get_password_hash(PASSWORD),
            cargo="garcom",
            status="ativo",
            restaurante_id=RESTAURANTE_ID,
        ))
        db.add(RestauranteCapability(
            restaurante_id=RESTAURANTE_ID,
            capability="smartpos",
            enabled=True,
            source="addon",
        ))
        db.commit()
        yield
    finally:
        db.rollback()
        db.close()
        current_restaurante_id.reset(token)


def _headers():
    response = client.post(
        "/auth/login",
        json={"username": EMAIL, "password": PASSWORD},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_pocket_pode_ter_smartpos_como_addon_sem_turno():
    response = client.get("/auth/smartpos/contexto", headers=_headers())
    assert response.status_code == 200
    data = response.json()
    assert data["smartpos_enabled"] is True
    assert data["turno_aberto"] is False
    assert data["mesas_disponiveis"] is False
    assert data["pedidos_disponiveis"] is False
    assert data["venda_rapida_disponivel"] is True


def test_turno_aberto_libera_salao_sem_dar_permissao_de_caixa_ao_garcom():
    token = current_restaurante_id.set(RESTAURANTE_ID)
    db = SessionLocal()
    try:
        db.add(CaixaTurno(
            restaurante_id=RESTAURANTE_ID,
            aberto_por_id=USER_ID,
            saldo_inicial=0,
            status="aberto",
        ))
        db.commit()
    finally:
        db.close()
        current_restaurante_id.reset(token)

    response = client.get("/auth/smartpos/contexto", headers=_headers())
    assert response.status_code == 200
    data = response.json()
    assert data["turno_aberto"] is True
    assert data["mesas_disponiveis"] is True
    assert data["pedidos_disponiveis"] is True
    assert data["venda_rapida_disponivel"] is True


def test_capability_desabilitada_faz_fail_closed_independente_do_plano():
    token = current_restaurante_id.set(RESTAURANTE_ID)
    db = SessionLocal()
    try:
        entitlement = db.query(RestauranteCapability).filter(
            RestauranteCapability.restaurante_id == RESTAURANTE_ID,
            RestauranteCapability.capability == "smartpos",
        ).one()
        entitlement.enabled = False
        db.commit()
    finally:
        db.close()
        current_restaurante_id.reset(token)

    response = client.get("/auth/smartpos/contexto", headers=_headers())
    assert response.status_code == 200
    data = response.json()
    assert data["smartpos_enabled"] is False
    assert data["mesas_disponiveis"] is False
    assert data["pedidos_disponiveis"] is False
    assert data["venda_rapida_disponivel"] is False

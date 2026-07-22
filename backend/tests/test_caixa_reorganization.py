import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import engine, Base, SessionLocal, current_restaurante_id
from app.security import create_access_token
from app.models import Restaurante, Usuario, CaixaTurno, CaixaMovimentacao, Pagamento

client = TestClient(app)


@pytest.fixture(autouse=True)
def caixa_test_setup():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    token_var = current_restaurante_id.set(888)
    try:
        # Create test restaurant 888
        rest = db.query(Restaurante).filter(Restaurante.id == 888).first()
        if not rest:
            rest = Restaurante(id=888, nome="Restaurante Caixa Test 888", plano="bistro")
            db.add(rest)
            db.commit()

        # Create test user for tenant 888
        user = db.query(Usuario).filter(Usuario.email == "caixa888@koma.com").first()
        if not user:
            user = Usuario(
                id="usr_caixa_888",
                nome="Operador Caixa 888",
                usuario="caixa888",
                email="caixa888@koma.com",
                senha_hash="$2b$12$dummyhashforcaixatestsuite",
                role="caixa",
                restaurante_id=888
            )
            db.add(user)
            db.commit()

        # Clean existing open shifts for 888
        db.query(CaixaMovimentacao).filter(CaixaMovimentacao.restaurante_id == 888).delete()
        db.query(CaixaTurno).filter(CaixaTurno.restaurante_id == 888).delete()
        db.commit()
    finally:
        current_restaurante_id.reset(token_var)
        db.close()


def get_auth_headers():
    token = create_access_token(subject="usr_caixa_888", restaurante_id=888, role="caixa")
    return {"Authorization": f"Bearer {token}"}


def test_obter_resumo_sem_turno():
    headers = get_auth_headers()
    response = client.get("/caixa/turno-atual/resumo", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "sem_turno"
    assert data["saldo_inicial"] == 0.0


def test_abrir_turno_e_obter_resumo():
    headers = get_auth_headers()
    
    # Open shift with initial cash R$ 100.00
    res_abrir = client.post("/caixa/turno/abrir", json={"saldo_inicial": 100.0}, headers=headers)
    assert res_abrir.status_code == 201
    shift_data = res_abrir.json()
    assert shift_data["status"] == "aberto"
    assert shift_data["saldo_inicial"] == 100.0

    # Get summary
    res_resumo = client.get("/caixa/turno-atual/resumo", headers=headers)
    assert res_resumo.status_code == 200
    resumo = res_resumo.json()
    assert resumo["status"] == "aberto"
    assert resumo["saldo_inicial"] == 100.0
    assert resumo["saldo_esperado_dinheiro"] == 100.0


def test_suprimento_e_sangria_flow():
    headers = get_auth_headers()
    
    # Ensure open shift
    client.post("/caixa/turno/abrir", json={"saldo_inicial": 200.0}, headers=headers)

    # 1. Registrar Suprimento de R$ 50.00
    res_sup = client.post("/caixa/suprimento", json={
        "valor": 50.0,
        "motivo": "Troco inicial extra",
        "observacao": "Notas de R$ 5,00"
    }, headers=headers)
    assert res_sup.status_code == 201
    sup_data = res_sup.json()
    assert sup_data["tipo"] == "suprimento"
    assert sup_data["valor"] == 50.0
    assert sup_data["saldo_anterior"] == 200.0
    assert sup_data["saldo_posterior"] == 250.0

    # 2. Registrar Sangria de R$ 100.00
    res_sang = client.post("/caixa/sangria", json={
        "valor": 100.0,
        "motivo": "Pagamento de entregador",
        "observacao": "Motoboy terceirizado"
    }, headers=headers)
    assert res_sang.status_code == 201
    sang_data = res_sang.json()
    assert sang_data["tipo"] == "sangria"
    assert sang_data["valor"] == 100.0
    assert sang_data["saldo_anterior"] == 250.0
    assert sang_data["saldo_posterior"] == 150.0

    # 3. Tentar Sangria acima do saldo disponível (disponível R$ 150, solicitar R$ 300) -> 400 Bad Request
    res_overflow = client.post("/caixa/sangria", json={
        "valor": 300.0,
        "motivo": "Sangria excessiva"
    }, headers=headers)
    assert res_overflow.status_code == 400
    assert "excede o saldo em dinheiro" in res_overflow.json()["detail"]

    # 4. Listar movimentações
    res_movs = client.get("/caixa/movimentacoes", headers=headers)
    assert res_movs.status_code == 200
    movs = res_movs.json()
    assert len(movs) == 2


def test_fechamento_caixa_conferencia_cega():
    headers = get_auth_headers()
    
    # Abrir turno com R$ 100.00
    client.post("/caixa/turno/abrir", json={"saldo_inicial": 100.0}, headers=headers)

    # Realizar sangria R$ 20.00 -> Esperado no final: R$ 80.00
    client.post("/caixa/sangria", json={"valor": 20.0, "motivo": "Retirada"}, headers=headers)

    # Declarar R$ 85.00 em dinheiro (sobra de R$ 5.00)
    res_fechamento = client.post("/caixa/fechamento", json={
        "declarado_dinheiro": 85.0,
        "declarado_cartao": 50.0,
        "declarado_pix": 30.0,
        "observacao": "Fechamento de teste"
    }, headers=headers)

    assert res_fechamento.status_code == 200
    fech = res_fechamento.json()
    assert fech["status"] == "fechado"
    assert fech["esperado_dinheiro"] == 80.0
    assert fech["declarado_dinheiro"] == 85.0
    assert fech["diferenca_dinheiro"] == 5.0

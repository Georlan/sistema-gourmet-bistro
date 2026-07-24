import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import engine, Base, SessionLocal, current_restaurante_id
from app.security import create_access_token
from app.models import Restaurante, Usuario, CaixaTurno, CaixaMovimentacao, Pagamento

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_caixa_pdv():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    token_var = current_restaurante_id.set(777)
    try:
        # Create test restaurant 777
        if not db.query(Restaurante).filter(Restaurante.id == 777).first():
            db.add(Restaurante(id=777, nome="Bistro Caixa Test 777", plano="bistro"))
            db.commit()

        # Create test user for tenant 777
        user = db.query(Usuario).filter(Usuario.email == "pdv777@koma.com").first()
        if not user:
            user = Usuario(
                id="usr_pdv_777",
                nome="Caixa PDV Teste",
                usuario="pdv777",
                email="pdv777@koma.com",
                senha_hash="$2b$12$dummyhashforcaixatestsuite",
                role="caixa",
                status="ativo",
                restaurante_id=777
            )
            db.add(user)
            db.commit()

        # Clean existing open shifts for 777
        db.query(CaixaMovimentacao).filter(CaixaMovimentacao.restaurante_id == 777).delete()
        db.query(CaixaTurno).filter(CaixaTurno.restaurante_id == 777).delete()
        db.commit()

        yield
    finally:
        current_restaurante_id.reset(token_var)
        db.close()


def get_pdv_auth_headers():
    token = create_access_token(subject="usr_pdv_777", restaurante_id=777, role="caixa")
    return {"Authorization": f"Bearer {token}"}


def test_pdv_caixa_full_shift_cycle():
    """1. Fluxo de Caixa/PDV: Ciclo completo de Abertura, Resumo e Fechamento de Turno."""
    headers = get_pdv_auth_headers()

    # 1. Verificação inicial sem turno
    res_sem_turno = client.get("/caixa/turno-atual/resumo", headers=headers)
    assert res_sem_turno.status_code == 200
    assert res_sem_turno.json()["status"] == "sem_turno"

    # 2. Abertura de Turno com R$ 150,00 de saldo inicial
    res_abrir = client.post("/caixa/turno/abrir", json={"saldo_inicial": 150.0}, headers=headers)
    assert res_abrir.status_code == 201
    abrir_data = res_abrir.json()
    assert abrir_data["status"] == "aberto"
    assert abrir_data["saldo_inicial"] == 150.0

    # 3. Consulta de Turno Ativo
    res_resumo = client.get("/caixa/turno-atual/resumo", headers=headers)
    assert res_resumo.status_code == 200
    resumo = res_resumo.json()
    assert resumo["status"] == "aberto"
    assert resumo["saldo_inicial"] == 150.0

    payload_fechamento = {
        "declarado_dinheiro": 150.0,
        "declarado_cartao": 0.0,
        "declarado_pix": 0.0,
        "observacao": "Fechamento de teste de regressão"
    }
    res_fechar = client.post("/caixa/turno/fechar", json=payload_fechamento, headers=headers)
    assert res_fechar.status_code in (200, 201)
    fechar_data = res_fechar.json()
    assert fechar_data["status"] in ("fechado", "ok") or "turno_id" in fechar_data

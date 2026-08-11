import pytest
from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient
from app.main import app
from app.database import engine, Base, SessionLocal, current_restaurante_id
from app.security import create_access_token
from app.models import (
    Restaurante,
    Usuario,
    Comanda,
    CaixaTurno,
    CaixaMovimentacao,
    Pagamento,
)

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
                status="ativo",
                restaurante_id=888
            )
            db.add(user)
            db.commit()

        # Clean test financial records in FK-safe order.
        db.query(Pagamento).filter(Pagamento.restaurante_id == 888).delete()
        db.query(CaixaMovimentacao).filter(CaixaMovimentacao.restaurante_id == 888).delete()
        db.query(CaixaTurno).filter(CaixaTurno.restaurante_id == 888).delete()
        db.query(Comanda).filter(
            Comanda.restaurante_id == 888,
            Comanda.id.like("cmd-caixa-resumo-%"),
        ).delete(synchronize_session=False)
        db.query(Comanda).filter(
            Comanda.restaurante_id == 888,
            Comanda.id.like("cmd-caixa-integrity-%"),
        ).delete(synchronize_session=False)
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


def test_resumo_concilia_pagamentos_e_movimentacoes_sem_arredondamento_incorreto():
    headers = get_auth_headers()
    response = client.post(
        "/caixa/turno/abrir",
        json={"saldo_inicial": 100.0},
        headers=headers,
    )
    assert response.status_code == 201
    turno_id = response.json()["id"]

    db = SessionLocal()
    token_var = current_restaurante_id.set(888)
    try:
        comandas = [
            Comanda(
                id=f"cmd-caixa-resumo-{numero}",
                restaurante_id=888,
                garcom_id="usr_caixa_888",
                numero_pedido=numero,
            )
            for numero in (8801, 8802)
        ]
        db.add_all(comandas)
        db.flush()

        db.add_all([
            Pagamento(
                id="pag-caixa-resumo-dinheiro-1",
                restaurante_id=888,
                comanda_id=comandas[0].id,
                turno_id=turno_id,
                valor=10.10,
                metodo="dinheiro",
                status="aprovado",
                idempotency_key="caixa-resumo-dinheiro-1",
            ),
            Pagamento(
                id="pag-caixa-resumo-dinheiro-2",
                restaurante_id=888,
                comanda_id=comandas[0].id,
                turno_id=turno_id,
                valor=20.20,
                metodo="dinheiro",
                status="aprovado",
                idempotency_key="caixa-resumo-dinheiro-2",
            ),
            Pagamento(
                id="pag-caixa-resumo-pix",
                restaurante_id=888,
                comanda_id=comandas[1].id,
                turno_id=turno_id,
                valor=30.30,
                metodo="pix",
                status="aprovado",
                idempotency_key="caixa-resumo-pix",
            ),
            Pagamento(
                id="pag-caixa-resumo-cartao",
                restaurante_id=888,
                comanda_id=comandas[1].id,
                turno_id=turno_id,
                valor=40.40,
                metodo="cartao_credito",
                status="aprovado",
                idempotency_key="caixa-resumo-cartao",
            ),
            Pagamento(
                id="pag-caixa-resumo-cancelado",
                restaurante_id=888,
                comanda_id=comandas[1].id,
                turno_id=turno_id,
                valor=999.99,
                metodo="dinheiro",
                status="cancelado",
                idempotency_key="caixa-resumo-cancelado",
            ),
            CaixaMovimentacao(
                restaurante_id=888,
                turno_id=turno_id,
                usuario_id="usr_caixa_888",
                tipo="suprimento",
                valor=5.05,
                descricao="Teste de conciliação",
            ),
            CaixaMovimentacao(
                restaurante_id=888,
                turno_id=turno_id,
                usuario_id="usr_caixa_888",
                tipo="sangria",
                valor=2.02,
                descricao="Teste de conciliação",
            ),
        ])
        db.commit()
    finally:
        current_restaurante_id.reset(token_var)
        db.close()

    resumo_response = client.get("/caixa/turno-atual/resumo", headers=headers)
    assert resumo_response.status_code == 200
    resumo = resumo_response.json()
    assert resumo["total_vendas"] == 101.0
    assert resumo["total_dinheiro"] == 30.30
    assert resumo["total_pix"] == 30.30
    assert resumo["total_cartao"] == 40.40
    assert resumo["total_pedidos_pagos"] == 2
    assert resumo["comandas_abertas_count"] == 2
    assert resumo["total_suprimentos"] == 5.05
    assert resumo["total_sangrias"] == 2.02
    assert resumo["saldo_esperado_dinheiro"] == 133.33
    assert (
        resumo["total_dinheiro"] + resumo["total_pix"] + resumo["total_cartao"]
        == resumo["total_vendas"]
    )
    atividades = resumo["atividades_recentes"]
    assert len(atividades) == 6
    assert {atividade["tipo"] for atividade in atividades} == {
        "recebimento",
        "suprimento",
        "sangria",
    }
    assert sum(1 for atividade in atividades if atividade["tipo"] == "recebimento") == 4
    assert all(atividade["valor"] != 999.99 for atividade in atividades)
    assert all(atividade["origem"] for atividade in atividades)


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

    # Bloqueio de nova movimentação (sangria/suprimento) após fechamento
    res_post_sangria = client.post("/caixa/sangria", json={"valor": 10.0, "motivo": "Teste"}, headers=headers)
    assert res_post_sangria.status_code == 400
    assert "Não há nenhum turno de caixa aberto" in res_post_sangria.json()["detail"]

    res_post_suprimento = client.post("/caixa/suprimento", json={"valor": 10.0, "motivo": "Teste"}, headers=headers)
    assert res_post_suprimento.status_code == 400
    assert "Não há nenhum turno de caixa aberto" in res_post_suprimento.json()["detail"]


def test_fechamento_bloqueia_comandas_e_pagamentos_pendentes():
    headers = get_auth_headers()
    open_response = client.post(
        "/caixa/turno/abrir",
        json={"saldo_inicial": 100.0},
        headers=headers,
    )
    assert open_response.status_code == 201
    turno_id = open_response.json()["id"]

    db = SessionLocal()
    token_var = current_restaurante_id.set(888)
    try:
        comanda = Comanda(
            id="cmd-caixa-integrity-pending",
            restaurante_id=888,
            garcom_id="usr_caixa_888",
            numero_pedido=8890,
            fechada=False,
        )
        db.add(comanda)
        db.flush()
        db.add(Pagamento(
            id="pag-caixa-integrity-pending",
            restaurante_id=888,
            comanda_id=comanda.id,
            turno_id=turno_id,
            valor=25.0,
            metodo="dinheiro",
            status="pendente",
            idempotency_key="caixa-integrity-pending",
        ))
        db.commit()
    finally:
        current_restaurante_id.reset(token_var)
        db.close()

    response = client.post(
        "/caixa/fechamento",
        json={
            "declarado_dinheiro": 100.0,
            "declarado_cartao": 0.0,
            "declarado_pix": 0.0,
            "observacao": "Tentativa com pendências",
        },
        headers=headers,
    )
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert "1 pagamento(s) aguardando confirmação" in detail
    assert "1 comanda(s) ainda aberta(s)" in detail

    resumo = client.get("/caixa/turno-atual/resumo", headers=headers).json()
    assert resumo["status"] == "aberto"
    assert resumo["comandas_abertas_count"] == 1


def test_aprovacao_rejeita_pagamento_de_turno_encerrado():
    headers = get_auth_headers()
    open_response = client.post(
        "/caixa/turno/abrir",
        json={"saldo_inicial": 50.0},
        headers=headers,
    )
    assert open_response.status_code == 201
    turno_id = open_response.json()["id"]

    close_response = client.post(
        "/caixa/fechamento",
        json={
            "declarado_dinheiro": 50.0,
            "declarado_cartao": 0.0,
            "declarado_pix": 0.0,
            "observacao": "Turno encerrado",
        },
        headers=headers,
    )
    assert close_response.status_code == 200

    db = SessionLocal()
    token_var = current_restaurante_id.set(888)
    try:
        comanda = Comanda(
            id="cmd-caixa-integrity-closed",
            restaurante_id=888,
            garcom_id="usr_caixa_888",
            numero_pedido=8891,
            fechada=True,
            fechado_em=datetime.now(timezone.utc),
        )
        db.add(comanda)
        db.flush()
        db.add(Pagamento(
            id="pag-caixa-integrity-closed-turn",
            restaurante_id=888,
            comanda_id=comanda.id,
            turno_id=turno_id,
            valor=10.0,
            metodo="dinheiro",
            status="pendente",
            idempotency_key="caixa-integrity-closed-turn",
        ))
        db.commit()
    finally:
        current_restaurante_id.reset(token_var)
        db.close()

    response = client.post(
        "/caixa/pagamentos/pag-caixa-integrity-closed-turn/aprovar",
        headers=headers,
    )
    assert response.status_code == 409
    assert "turno já encerrado" in response.json()["detail"]


def test_historico_movimentacoes_limita_100_e_inclui_operador():
    headers = get_auth_headers()
    open_response = client.post(
        "/caixa/turno/abrir",
        json={"saldo_inicial": 100.0},
        headers=headers,
    )
    assert open_response.status_code == 201
    turno_id = open_response.json()["id"]

    db = SessionLocal()
    token_var = current_restaurante_id.set(888)
    try:
        base_time = datetime(2026, 8, 11, 8, 0, tzinfo=timezone.utc)
        db.add_all([
            CaixaMovimentacao(
                restaurante_id=888,
                turno_id=turno_id,
                usuario_id="usr_caixa_888",
                tipo="suprimento" if index % 2 == 0 else "sangria",
                valor=index + 1,
                saldo_anterior=100 + index,
                saldo_posterior=101 + index,
                descricao=f"Movimentação {index:03d}",
                criado_em=base_time + timedelta(minutes=index),
            )
            for index in range(105)
        ])
        db.commit()
    finally:
        current_restaurante_id.reset(token_var)
        db.close()

    response = client.get("/caixa/movimentacoes", headers=headers)
    assert response.status_code == 200
    movimentacoes = response.json()
    assert len(movimentacoes) == 100
    assert movimentacoes[0]["descricao"] == "Movimentação 104"
    assert movimentacoes[-1]["descricao"] == "Movimentação 005"
    assert all(item["usuario_nome"] == "Operador Caixa 888" for item in movimentacoes)

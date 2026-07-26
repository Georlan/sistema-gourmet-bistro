import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import engine, Base, SessionLocal, current_restaurante_id
from app.security import create_access_token
from app.models import (
    Restaurante,
    Usuario,
    Categoria,
    Produto,
    Mesa,
    Comanda,
    Lancamento,
    Item,
    CaixaTurno,
    CaixaMovimentacao,
    Pagamento,
    ConfiguracaoRestaurante,
)

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

        # Limpa o fluxo financeiro/operacional criado por testes anteriores.
        db.query(Pagamento).filter(Pagamento.restaurante_id == 777).delete()
        db.query(Item).filter(Item.restaurante_id == 777).delete()
        db.query(Lancamento).filter(Lancamento.restaurante_id == 777).delete()
        db.query(Comanda).filter(Comanda.restaurante_id == 777).delete()
        db.query(CaixaMovimentacao).filter(CaixaMovimentacao.restaurante_id == 777).delete()
        db.query(CaixaTurno).filter(CaixaTurno.restaurante_id == 777).delete()

        categoria = db.query(Categoria).filter(
            Categoria.restaurante_id == 777,
            Categoria.id == "cat-pdv-777",
        ).first()
        if not categoria:
            db.add(Categoria(
                id="cat-pdv-777",
                restaurante_id=777,
                nome="Categoria PDV 777",
            ))
            db.flush()

        produto = db.query(Produto).filter(
            Produto.restaurante_id == 777,
            Produto.id == "prod-pdv-777",
        ).first()
        if not produto:
            db.add(Produto(
                id="prod-pdv-777",
                restaurante_id=777,
                categoria_id="cat-pdv-777",
                nome="Produto PDV 777",
                preco=42.0,
                ativo=True,
            ))

        mesa = db.query(Mesa).filter(
            Mesa.restaurante_id == 777,
            Mesa.id == 7,
        ).first()
        if not mesa:
            db.add(Mesa(
                id=7,
                restaurante_id=777,
                capacidade=4,
                nome="Mesa 7",
            ))

        config = db.query(ConfiguracaoRestaurante).filter(
            ConfiguracaoRestaurante.restaurante_id == 777
        ).first()
        if not config:
            db.add(ConfiguracaoRestaurante(
                restaurante_id=777,
                taxa_servico_ativa=True,
                taxa_servico_padrao=10.0,
            ))
        else:
            config.taxa_servico_ativa = True
            config.taxa_servico_padrao = 10.0
        db.commit()

        yield
    finally:
        current_restaurante_id.reset(token_var)
        db.close()


def get_pdv_auth_headers():
    token = create_access_token(subject="usr_pdv_777", restaurante_id=777, role="caixa")
    return {"Authorization": f"Bearer {token}"}


def criar_comanda_mesa(
    *,
    comanda_id: str,
    item_id: str,
    valor: float,
    numero_pedido: int,
):
    db = SessionLocal()
    try:
        comanda = Comanda(
            id=comanda_id,
            restaurante_id=777,
            mesa_id=7,
            garcom_id="usr_pdv_777",
            tipo="Consumo no Local",
            numero_pedido=numero_pedido,
            status_comanda="aguardando_pagamento",
            valor_pago=0.0,
            fechada=False,
        )
        lancamento = Lancamento(
            id=f"lan-{comanda_id}",
            restaurante_id=777,
            comanda_id=comanda_id,
            garcom_id="usr_pdv_777",
        )
        item = Item(
            id=item_id,
            restaurante_id=777,
            comanda_id=comanda_id,
            lancamento_id=lancamento.id,
            produto_id="prod-pdv-777",
            preco_unit=valor,
            status="pronto",
            pago=False,
        )
        db.add_all([comanda, lancamento, item])
        db.commit()
    finally:
        db.close()


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


def test_pagamento_parcial_abate_saldo_e_exato_libera_mesa():
    """R$ 20 de R$ 42 mantém a mesa; os R$ 22 restantes quitam e liberam."""
    headers = get_pdv_auth_headers()
    abrir = client.post(
        "/caixa/turno/abrir",
        json={"saldo_inicial": 100.0},
        headers=headers,
    )
    assert abrir.status_code == 201
    criar_comanda_mesa(
        comanda_id="cmd-mesa-42",
        item_id="item-mesa-42",
        valor=42.0,
        numero_pedido=4201,
    )

    parcial_payload = {
        "valor": 20.0,
        "metodo": "pix",
        "incluir_taxa_servico": False,
        "idempotency_key": "mesa-42-parcial-pix",
    }
    parcial = client.post(
        "/caixa/mesas/7/pagar",
        json=parcial_payload,
        headers=headers,
    )
    assert parcial.status_code == 201
    assert parcial.json()["valor"] == 20.0

    db = SessionLocal()
    try:
        comanda = db.query(Comanda).filter(Comanda.id == "cmd-mesa-42").one()
        item = db.query(Item).filter(Item.id == "item-mesa-42").one()
        assert comanda.valor_pago == 20.0
        assert comanda.fechada is False
        assert item.pago is False
    finally:
        db.close()

    # Repetir a mesma requisição não pode contabilizar R$ 20 novamente.
    repetido = client.post(
        "/caixa/mesas/7/pagar",
        json=parcial_payload,
        headers=headers,
    )
    assert repetido.status_code == 201
    assert repetido.json()["id"] == parcial.json()["id"]

    exato = client.post(
        "/caixa/mesas/7/pagar",
        json={
            "valor": 22.0,
            "metodo": "cartao_debito",
            "incluir_taxa_servico": False,
            "idempotency_key": "mesa-42-restante-exato",
        },
        headers=headers,
    )
    assert exato.status_code == 201
    assert exato.json()["valor"] == 22.0

    db = SessionLocal()
    try:
        comanda = db.query(Comanda).filter(Comanda.id == "cmd-mesa-42").one()
        item = db.query(Item).filter(Item.id == "item-mesa-42").one()
        pagamentos = db.query(Pagamento).filter(
            Pagamento.restaurante_id == 777
        ).all()
        assert comanda.valor_pago == 42.0
        assert comanda.fechada is True
        assert item.pago is True
        assert sum(p.valor for p in pagamentos) == 42.0
        assert len(pagamentos) == 2
    finally:
        db.close()


def test_pagamento_mesa_por_itens_e_pagamento_livre_coexistem():
    """
    A seleção dá baixa visual nos itens escolhidos, enquanto pagamentos sem
    seleção continuam abatendo somente o saldo monetário global da mesa.
    """
    headers = get_pdv_auth_headers()
    assert client.post(
        "/caixa/turno/abrir",
        json={"saldo_inicial": 100.0},
        headers=headers,
    ).status_code == 201
    criar_comanda_mesa(
        comanda_id="cmd-mesa-itens",
        item_id="item-mesa-selecionado",
        valor=15.0,
        numero_pedido=4251,
    )

    db = SessionLocal()
    try:
        db.add(Item(
            id="item-mesa-livre",
            restaurante_id=777,
            comanda_id="cmd-mesa-itens",
            lancamento_id="lan-cmd-mesa-itens",
            produto_id="prod-pdv-777",
            preco_unit=27.0,
            status="pronto",
            pago=False,
        ))
        db.commit()
    finally:
        db.close()

    # Uma seleção não pode receber valor inferior e fingir que o item foi pago.
    incompleto = client.post(
        "/caixa/mesas/7/pagar",
        json={
            "valor": 10.0,
            "metodo": "pix",
            "incluir_taxa_servico": True,
            "item_ids": ["item-mesa-selecionado"],
            "idempotency_key": "mesa-item-valor-incompleto",
        },
        headers=headers,
    )
    assert incompleto.status_code == 400

    por_item = client.post(
        "/caixa/mesas/7/pagar",
        json={
            "valor": 16.5,
            "metodo": "pix",
            "incluir_taxa_servico": True,
            "item_ids": ["item-mesa-selecionado"],
            "idempotency_key": "mesa-item-selecionado",
        },
        headers=headers,
    )
    assert por_item.status_code == 201
    assert por_item.json()["valor"] == 16.5

    db = SessionLocal()
    try:
        comanda = db.query(Comanda).filter(
            Comanda.id == "cmd-mesa-itens"
        ).one()
        selecionado = db.query(Item).filter(
            Item.id == "item-mesa-selecionado"
        ).one()
        livre = db.query(Item).filter(Item.id == "item-mesa-livre").one()
        assert comanda.valor_pago == 16.5
        assert comanda.fechada is False
        assert selecionado.pago is True
        assert livre.pago is False
    finally:
        db.close()

    # Sem item_ids, a baixa continua sendo livre e não altera o item restante.
    livre_parcial = client.post(
        "/caixa/mesas/7/pagar",
        json={
            "valor": 5.0,
            "metodo": "cartao_debito",
            "incluir_taxa_servico": True,
            "idempotency_key": "mesa-pagamento-livre-parcial",
        },
        headers=headers,
    )
    assert livre_parcial.status_code == 201

    db = SessionLocal()
    try:
        comanda = db.query(Comanda).filter(
            Comanda.id == "cmd-mesa-itens"
        ).one()
        livre = db.query(Item).filter(Item.id == "item-mesa-livre").one()
        assert comanda.valor_pago == 21.5
        assert comanda.fechada is False
        assert livre.pago is False
    finally:
        db.close()

    restante = client.post(
        "/caixa/mesas/7/pagar",
        json={
            "valor": 24.7,
            "metodo": "dinheiro",
            "incluir_taxa_servico": True,
            "idempotency_key": "mesa-pagamento-livre-restante",
        },
        headers=headers,
    )
    assert restante.status_code == 201

    db = SessionLocal()
    try:
        comanda = db.query(Comanda).filter(
            Comanda.id == "cmd-mesa-itens"
        ).one()
        livre = db.query(Item).filter(Item.id == "item-mesa-livre").one()
        assert comanda.valor_pago == 46.2
        assert comanda.fechada is True
        assert livre.pago is True
    finally:
        db.close()


def test_pagamento_da_mesa_distribui_entre_multiplas_comandas():
    """Uma única baixa deve ser atômica mesmo com comandas agrupadas."""
    headers = get_pdv_auth_headers()
    assert client.post(
        "/caixa/turno/abrir",
        json={"saldo_inicial": 100.0},
        headers=headers,
    ).status_code == 201
    criar_comanda_mesa(
        comanda_id="cmd-mesa-a",
        item_id="item-mesa-a",
        valor=15.0,
        numero_pedido=4301,
    )
    criar_comanda_mesa(
        comanda_id="cmd-mesa-b",
        item_id="item-mesa-b",
        valor=27.0,
        numero_pedido=4302,
    )

    parcial = client.post(
        "/caixa/mesas/7/pagar",
        json={
            "valor": 20.0,
            "metodo": "pix",
            "incluir_taxa_servico": False,
            "idempotency_key": "mesa-multi-parcial",
        },
        headers=headers,
    )
    assert parcial.status_code == 201

    db = SessionLocal()
    try:
        primeira = db.query(Comanda).filter(Comanda.id == "cmd-mesa-a").one()
        segunda = db.query(Comanda).filter(Comanda.id == "cmd-mesa-b").one()
        assert primeira.valor_pago == 15.0
        assert primeira.fechada is True
        assert segunda.valor_pago == 5.0
        assert segunda.fechada is False
    finally:
        db.close()

    restante = client.post(
        "/caixa/mesas/7/pagar",
        json={
            "valor": 22.0,
            "metodo": "cartao_credito",
            "incluir_taxa_servico": False,
            "idempotency_key": "mesa-multi-restante",
        },
        headers=headers,
    )
    assert restante.status_code == 201

    db = SessionLocal()
    try:
        comandas_abertas = db.query(Comanda).filter(
            Comanda.restaurante_id == 777,
            Comanda.mesa_id == 7,
            Comanda.fechada == False,
        ).count()
        total_pagamentos = sum(
            pagamento.valor
            for pagamento in db.query(Pagamento).filter(
                Pagamento.restaurante_id == 777
            ).all()
        )
        assert comandas_abertas == 0
        assert total_pagamentos == 42.0
    finally:
        db.close()

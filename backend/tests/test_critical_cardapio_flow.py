import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import engine, Base, SessionLocal, current_restaurante_id
from app.models import Restaurante, Categoria, Produto, Usuario, Mesa, PrintJob, Comanda
from app.security import create_access_token

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_cardapio_data():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    token_var = current_restaurante_id.set(100)
    try:
        # Create test restaurant 100
        rest = db.query(Restaurante).filter(Restaurante.id == 100).first()
        if not rest:
            rest = Restaurante(
                id=100,
                nome="Bistro Teste Cardapio",
                plano="pro",
                slug="bistro-teste-cardapio",
                subtitulo="O melhor sabor da cidade",
                cor_primaria="#ff9900",
                cor_fundo="#111111",
                endereco="Rua Teste 100"
            )
            db.add(rest)
            db.commit()
        elif rest.plano != "pro":
            rest.plano = "pro"
            db.commit()

        # Create Mesa 1 for restaurant 100
        mesa = db.query(Mesa).filter(Mesa.restaurante_id == 100, Mesa.id == 1).first()
        if not mesa:
            mesa = Mesa(id=1, capacidade=4, nome="Mesa 1", restaurante_id=100)
            db.add(mesa)
            db.commit()

        # Create user for restaurant 100
        user = db.query(Usuario).filter(Usuario.email == "cardapio100@koma.com").first()
        if not user:
            user = Usuario(
                id="usr_cardapio_100",
                nome="Garcom Cardapio 100",
                email="cardapio100@koma.com",
                cargo="admin",
                role="admin",
                status="ativo",
                restaurante_id=100
            )
            db.add(user)
            db.commit()

        # Create category for restaurant 100
        cat = db.query(Categoria).filter(Categoria.restaurante_id == 100, Categoria.nome == "Hambúrgueres Teste").first()
        if not cat:
            cat = Categoria(
                id="cat-cardapio-test",
                nome="Hambúrgueres Teste",
                restaurante_id=100
            )
            db.add(cat)
            db.commit()

        # Create active product for restaurant 100
        prod = db.query(Produto).filter(Produto.restaurante_id == 100, Produto.nome == "Burguer Especial Teste").first()
        if not prod:
            prod = Produto(
                id="prod-cardapio-test",
                nome="Burguer Especial Teste",
                preco=25.0,
                descricao="Ingredientes selecionados",
                ativo=True,
                categoria_id="cat-cardapio-test",
                restaurante_id=100
            )
            db.add(prod)
            db.commit()

        yield
    finally:
        current_restaurante_id.reset(token_var)
        db.close()


def test_cardapio_digital_config_loading():
    """1. Cardápio Digital: Carregar configurações whitelabel do restaurante."""
    response = client.get("/api/cardapio-digital/config?restaurante_id=100")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == 100
    assert data["nome"] == "Bistro Teste Cardapio"
    assert data["cor_primaria"] == "#ff9900"
    assert data["endereco"] == "Rua Teste 100"


def test_cardapio_digital_categorias_listing():
    """2. Cardápio Digital: Listar categorias ativas do restaurante."""
    response = client.get("/api/cardapio-digital/categorias?restaurante_id=100")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert any(c["nome"] == "Hambúrgueres Teste" for c in data)


def test_cardapio_digital_produtos_listing():
    """3. Cardápio Digital: Listar produtos ativos do restaurante."""
    response = client.get("/api/cardapio-digital/produtos?restaurante_id=100")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert any(p["nome"] == "Burguer Especial Teste" for p in data)
    for p in data:
        assert p["ativo"] is True


def test_caixa_venda_direta_mesa():
    """4. Caixa: criar pedido manual de mesa."""
    token = create_access_token(subject="usr_cardapio_100", restaurante_id=100, role="admin")
    headers = {"Authorization": f"Bearer {token}"}

    payload = {
        "restaurante_id": 100,
        "mesa_id": 1,
        "garcom_id": "usr_cardapio_100",
        "tipo": "Consumo no Local",
        "itens": [
            {
                "produto_id": "prod-cardapio-test",
                "quantidade": 1,
                "preco_unitario": 25.0,
                "observacao": "Sem cebola"
            }
        ]
    }
    response = client.post("/comandas/venda-direta", json=payload, headers=headers)
    assert response.status_code in (200, 201)
    data = response.json()
    assert "id" in data or "numero_pedido" in data
    assert data["tipo"] == "Consumo no Local"
    assert data["mesa_id"] == 1
    assert data["delivery_status"] is None

    db = SessionLocal()
    try:
        print_job = db.query(PrintJob).filter(
            PrintJob.restaurante_id == 100,
            PrintJob.source_type == "pedido",
            PrintJob.source_id == data["id"],
        ).one()
        assert print_job.status == "pending"
    finally:
        db.close()


@pytest.mark.parametrize(
    ("tipo", "identificador", "telefone", "endereco"),
    [
        ("Entrega", "Cliente Delivery", "81999990003", "Rua Manual, 123"),
        ("Retirada", "Cliente Retirada", "81999990004", None),
    ],
)
def test_caixa_venda_direta_nao_passa_pela_gaveta_online(
    tipo,
    identificador,
    telefone,
    endereco,
):
    """Delivery e retirada digitados pelo caixa já entram aceitos em produção."""
    token = create_access_token(subject="usr_cardapio_100", restaurante_id=100, role="admin")
    payload = {
        "mesa_id": None,
        "garcom_id": "usr_cardapio_100",
        "tipo": tipo,
        "identificador": identificador,
        "delivery_telefone": telefone,
        "delivery_endereco": endereco,
        "delivery_taxa": 8.0 if tipo == "Entrega" else 0.0,
        "itens": [
            {
                "produto_id": "prod-cardapio-test",
                "observacao": "",
                "cliente_nome": identificador,
            }
        ],
    }

    response = client.post(
        "/comandas/venda-direta",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 201
    data = response.json()
    assert data["tipo"] == tipo
    assert data["mesa_id"] is None
    assert data["delivery_status"] == "producao"


def test_caixa_delivery_manual_exige_dados_de_entrega():
    token = create_access_token(subject="usr_cardapio_100", restaurante_id=100, role="admin")
    response = client.post(
        "/comandas/venda-direta",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "tipo": "Entrega",
            "identificador": "Cliente sem endereço",
            "delivery_telefone": "81999990005",
            "itens": [{"produto_id": "prod-cardapio-test"}],
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Informe o endereço de entrega."


@pytest.mark.parametrize(
    (
        "tipo_pedido",
        "endereco",
        "forma_pagamento",
        "tipo_esperado",
        "endereco_esperado",
        "taxa_esperada",
    ),
    [
        ("delivery", "Rua das Flores, 123", "na_entrega", "Delivery", "Rua das Flores, 123", 8.0),
        ("retirada", "Retirada no Balcão", "na_entrega", "Retirada", None, 0.0),
    ],
)
def test_pedido_online_preserva_modalidade_no_kanban(
    tipo_pedido,
    endereco,
    forma_pagamento,
    tipo_esperado,
    endereco_esperado,
    taxa_esperada,
):
    """Pedidos digitais chegam à gaveta com a modalidade correta."""
    payload = {
        "restaurante_id": 100,
        "itens": [
            {
                "produto_id": "prod-cardapio-test",
                "quantidade": 2,
                "observacao": "Sem cebola",
            }
        ],
        "cliente_nome": f"Cliente {tipo_pedido}",
        "cliente_telefone": "81999990000" if tipo_pedido == "delivery" else "81999990001",
        "endereco_entrega": endereco,
        "taxa_entrega": 8.0,
        "forma_pagamento": forma_pagamento,
        "tipo_pedido": tipo_pedido,
    }

    response = client.post("/cardapio/pedidos", json=payload)
    assert response.status_code == 201
    assert response.json()["pagamento"] == {
        "status": "pendente_no_atendimento",
        "cobranca_online": False,
    }
    assert "pixCode" not in response.json()
    assert "orderId" not in response.json()

    db = SessionLocal()
    try:
        comanda = db.query(Comanda).filter(Comanda.id == response.json()["comanda_id"]).one()
        assert comanda.tipo == tipo_esperado
        assert comanda.delivery_status == "pendente"
        assert comanda.delivery_endereco == endereco_esperado
        assert comanda.delivery_taxa == taxa_esperada
        assert comanda.status_comanda is None
        assert len(comanda.itens) == 2
    finally:
        db.close()


@pytest.mark.parametrize("forma_pagamento", ["Pix", "PIX", "Cartão de Crédito", "Dinheiro"])
def test_pedido_online_rejeita_cobranca_nao_integrada(forma_pagamento):
    """O cardápio não pode fingir que criou uma cobrança sem gateway homologado."""
    db = SessionLocal()
    try:
        comandas_antes = db.query(Comanda).filter(Comanda.restaurante_id == 100).count()
    finally:
        db.close()

    response = client.post(
        "/cardapio/pedidos",
        json={
            "restaurante_id": 100,
            "itens": [
                {
                    "produto_id": "prod-cardapio-test",
                    "quantidade": 1,
                    "observacao": "",
                }
            ],
            "cliente_nome": "Cliente pagamento",
            "cliente_telefone": "81999990006",
            "endereco_entrega": "",
            "taxa_entrega": 0,
            "forma_pagamento": forma_pagamento,
            "tipo_pedido": "retirada",
        },
    )

    assert response.status_code == 422

    db = SessionLocal()
    try:
        comandas_depois = db.query(Comanda).filter(Comanda.restaurante_id == 100).count()
        assert comandas_depois == comandas_antes
    finally:
        db.close()


@pytest.mark.parametrize(
    "path",
    [
        "/cardapio/identificar",
        "/cardapio/enviar-otp",
        "/cardapio/verificar-otp",
    ],
)
def test_recuperacao_otp_simulada_nao_esta_publicada(path):
    response = client.post(
        path,
        json={
            "restaurante_id": 100,
            "telefone": "81999990000",
            "otp": "0000",
        },
    )

    assert response.status_code == 404


def test_caixa_pode_recusar_pedido_antes_da_producao():
    payload = {
        "restaurante_id": 100,
        "itens": [
            {
                "produto_id": "prod-cardapio-test",
                "quantidade": 1,
                "observacao": "",
            }
        ],
        "cliente_nome": "Cliente recusado",
        "cliente_telefone": "81999990002",
        "endereco_entrega": "",
        "taxa_entrega": 0,
        "forma_pagamento": "na_entrega",
        "tipo_pedido": "retirada",
    }
    created = client.post("/cardapio/pedidos", json=payload)
    assert created.status_code == 201

    token = create_access_token(subject="usr_cardapio_100", restaurante_id=100, role="admin")
    response = client.put(
        f"/comandas/{created.json()['comanda_id']}/delivery/status?status_novo=recusado",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200

    db = SessionLocal()
    try:
        comanda = db.query(Comanda).filter(Comanda.id == created.json()["comanda_id"]).one()
        assert comanda.delivery_status == "recusado"
        assert comanda.fechada is True
        assert all(item.status == "cancelado" for item in comanda.itens)
    finally:
        db.close()


def test_koma_pocket_nao_enfileira_impressao_automatica():
    db = SessionLocal()
    try:
        restaurante = db.query(Restaurante).filter(Restaurante.id == 100).one()
        restaurante.plano = "pocket"
        db.commit()
    finally:
        db.close()

    token = create_access_token(subject="usr_cardapio_100", restaurante_id=100, role="admin")
    response = client.post(
        "/comandas/venda-direta",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "restaurante_id": 100,
            "mesa_id": 1,
            "garcom_id": "usr_cardapio_100",
            "tipo": "Consumo no Local",
            "itens": [
                {
                    "produto_id": "prod-cardapio-test",
                    "quantidade": 1,
                    "preco_unitario": 25.0,
                    "observacao": "",
                }
            ],
        },
    )
    assert response.status_code in (200, 201)

    db = SessionLocal()
    try:
        print_job = db.query(PrintJob).filter(
            PrintJob.restaurante_id == 100,
            PrintJob.source_type == "pedido",
            PrintJob.source_id == response.json()["id"],
        ).first()
        assert print_job is None
    finally:
        db.close()

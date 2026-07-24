import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import engine, Base, SessionLocal, current_restaurante_id
from app.models import Restaurante, Categoria, Produto, Usuario, Mesa
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
                slug="bistro-teste-cardapio",
                subtitulo="O melhor sabor da cidade",
                cor_primaria="#ff9900",
                cor_fundo="#111111",
                endereco="Rua Teste 100"
            )
            db.add(rest)
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


def test_cardapio_digital_venda_direta_order():
    """4. Cardápio Digital: Finalizar e criar pedido."""
    token = create_access_token(subject="usr_cardapio_100", restaurante_id=100, role="admin")
    headers = {"Authorization": f"Bearer {token}"}

    payload = {
        "restaurante_id": 100,
        "mesa_id": 1,
        "garcom_id": "usr_cardapio_100",
        "tipo": "Delivery",
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

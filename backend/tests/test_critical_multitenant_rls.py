import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import engine, Base, SessionLocal, current_restaurante_id
from app.models import Restaurante, Categoria, Produto

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_multitenant_data():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    
    # Setup Tenant 101
    tok101 = current_restaurante_id.set(101)
    try:
        if not db.query(Restaurante).filter(Restaurante.id == 101).first():
            db.add(Restaurante(id=101, nome="Tenant A (Hamburgueria)", plano="bistro"))
            db.commit()

        if not db.query(Categoria).filter(Categoria.nome == "Categoria Tenant A").first():
            db.add(Categoria(id="cat-tenant-a", nome="Categoria Tenant A", restaurante_id=101))
            db.commit()

        if not db.query(Produto).filter(Produto.nome == "Burguer Tenant A").first():
            db.add(Produto(id="prod-tenant-a", nome="Burguer Tenant A", preco=30.0, categoria_id="cat-tenant-a", restaurante_id=101, ativo=True))
            db.commit()
    finally:
        current_restaurante_id.reset(tok101)

    # Setup Tenant 202
    tok202 = current_restaurante_id.set(202)
    try:
        if not db.query(Restaurante).filter(Restaurante.id == 202).first():
            db.add(Restaurante(id=202, nome="Tenant B (Pizzeria)", plano="bistro"))
            db.commit()

        if not db.query(Categoria).filter(Categoria.nome == "Categoria Tenant B").first():
            db.add(Categoria(id="cat-tenant-b", nome="Categoria Tenant B", restaurante_id=202))
            db.commit()

        if not db.query(Produto).filter(Produto.nome == "Pizza Tenant B").first():
            db.add(Produto(id="prod-tenant-b", nome="Pizza Tenant B", preco=45.0, categoria_id="cat-tenant-b", restaurante_id=202, ativo=True))
            db.commit()
    finally:
        current_restaurante_id.reset(tok202)
        db.close()


def test_multitenant_categories_isolation():
    """1. Isolamento Multi-Tenant: Categorias do Tenant A não vazam para o Tenant B."""
    response_a = client.get("/api/cardapio-digital/categorias?restaurante_id=101")
    assert response_a.status_code == 200
    data_a = response_a.json()
    assert any(c["nome"] == "Categoria Tenant A" for c in data_a)
    assert not any(c["nome"] == "Categoria Tenant B" for c in data_a)

    response_b = client.get("/api/cardapio-digital/categorias?restaurante_id=202")
    assert response_b.status_code == 200
    data_b = response_b.json()
    assert any(c["nome"] == "Categoria Tenant B" for c in data_b)
    assert not any(c["nome"] == "Categoria Tenant A" for c in data_b)


def test_multitenant_products_isolation():
    """2. Isolamento Multi-Tenant: Produtos do Tenant A não vazam para o Tenant B."""
    response_a = client.get("/api/cardapio-digital/produtos?restaurante_id=101")
    assert response_a.status_code == 200
    data_a = response_a.json()
    assert any(p["nome"] == "Burguer Tenant A" for p in data_a)
    assert not any(p["nome"] == "Pizza Tenant B" for p in data_a)

    response_b = client.get("/api/cardapio-digital/produtos?restaurante_id=202")
    assert response_b.status_code == 200
    data_b = response_b.json()
    assert any(p["nome"] == "Pizza Tenant B" for p in data_b)
    assert not any(p["nome"] == "Burguer Tenant A" for p in data_b)

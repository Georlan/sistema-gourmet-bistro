import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import engine, Base, SessionLocal, current_restaurante_id
from app.models import Restaurante, Categoria, Produto
from app.routes.cardapio_digital import public_tenant_scope

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_multitenant_data():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    
    # Setup Tenant 101
    tok101 = current_restaurante_id.set(101)
    try:
        restaurant_a = db.query(Restaurante).filter(Restaurante.id == 101).first()
        if not restaurant_a:
            db.add(Restaurante(
                id=101,
                nome="Tenant A (Hamburgueria)",
                plano="bistro",
                slug="tenant-a-hamburgueria",
            ))
            db.commit()
        elif restaurant_a.slug != "tenant-a-hamburgueria":
            restaurant_a.slug = "tenant-a-hamburgueria"
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
        restaurant_b = db.query(Restaurante).filter(Restaurante.id == 202).first()
        if not restaurant_b:
            db.add(Restaurante(
                id=202,
                nome="Tenant B (Pizzeria)",
                plano="bistro",
                slug="tenant-b-pizzeria",
            ))
            db.commit()
        elif restaurant_b.slug != "tenant-b-pizzeria":
            restaurant_b.slug = "tenant-b-pizzeria"
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


def test_public_menu_resolves_id_and_slug_without_cross_tenant_leak():
    response_a = client.get(
        "/api/cardapio-digital/public?restaurante_id=101"
    )
    response_b = client.get(
        "/api/cardapio-digital/public?slug=tenant-b-pizzeria"
    )

    assert response_a.status_code == 200
    assert response_b.status_code == 200

    menu_a = response_a.json()
    menu_b = response_b.json()
    assert menu_a["restaurante"]["id"] == 101
    assert menu_b["restaurante"]["id"] == 202
    assert {item["nome"] for item in menu_a["produtos"]} == {
        "Burguer Tenant A"
    }
    assert {item["nome"] for item in menu_b["produtos"]} == {
        "Pizza Tenant B"
    }


def test_public_menu_exposes_only_minimal_dto():
    response = client.get(
        "/api/cardapio-digital/public?slug=tenant-a-hamburgueria"
    )

    assert response.status_code == 200
    menu = response.json()
    assert "plano" not in menu["restaurante"]
    assert "latitude" not in menu["restaurante"]
    assert "longitude" not in menu["restaurante"]
    assert "restaurante_id" not in menu["categorias"][0]
    assert "destino_impressao" not in menu["categorias"][0]
    assert "restaurante_id" not in menu["produtos"][0]
    assert "ativo" not in menu["produtos"][0]


@pytest.mark.parametrize(
    "path",
    [
        "/api/cardapio-digital/public",
        "/api/cardapio-digital/public?restaurante_id=999999",
        "/api/cardapio-digital/public?slug=tenant-inexistente",
    ],
)
def test_public_menu_rejects_missing_or_unknown_tenant(path):
    response = client.get(path)
    assert response.status_code in {400, 404}


def test_public_tenant_scope_switches_and_restores_session_identity():
    token = current_restaurante_id.set(202)
    db = SessionLocal()
    try:
        with public_tenant_scope("101", None, db) as rest_id:
            assert rest_id == 101
            assert db.restaurante_id == 101
            assert current_restaurante_id.get() == 101
            products = db.query(Produto).filter(
                Produto.restaurante_id == rest_id
            ).all()
            assert {product.nome for product in products} == {
                "Burguer Tenant A"
            }

        assert current_restaurante_id.get() == 202
    finally:
        db.close()
        current_restaurante_id.reset(token)

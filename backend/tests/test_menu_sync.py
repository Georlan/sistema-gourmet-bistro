import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.models import Restaurante, Usuario, Produto, Categoria, Item, Comanda, Lancamento, Mesa, GrupoModificador, OpcaoModificador, ProdutoGrupoModificador
from app.security import get_password_hash
from app.main import app

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_menu_sync.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})

@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()

TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

@pytest.fixture(autouse=True)
def setup_database():
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    
    # Criar dados iniciais de teste
    db = TestingSessionLocal()
    
    # Criar restaurante padrão apenas se não existir
    rest = db.query(Restaurante).filter(Restaurante.id == 1).first()
    if not rest:
        rest = Restaurante(id=1, nome="Kôma Bistrô", plano="pocket")
        db.add(rest)
        db.commit()
    
    db.add(Usuario(id="u-admin", restaurante_id=1, nome="Admin Test", usuario="admin", senha_hash=get_password_hash("123"), role="admin", status="ativo"))
    db.add(Mesa(id=1, restaurante_id=1, capacidade=4, nome=None))
    
    cat1 = Categoria(id="cat-bebidas", restaurante_id=1, nome="Bebidas")
    cat2 = Categoria(id="cat-comidas", restaurante_id=1, nome="Comidas")
    db.add(cat1)
    db.add(cat2)
    
    p1 = Produto(id="prod-coca", restaurante_id=1, nome="Coca-Cola", categoria_id="cat-bebidas", preco=6.0, ativo=True)
    p2 = Produto(id="prod-burguer", restaurante_id=1, nome="Burguer", categoria_id="cat-comidas", preco=22.0, ativo=True)
    db.add(p1)
    db.add(p2)
    
    db.commit()
    db.close()
    
    yield
    Base.metadata.drop_all(bind=engine)
    app.dependency_overrides.clear()
    

def test_sincronizacao_manual_cardapio():
    client = TestClient(app)
    
    # 1. Obter token admin para alterar produtos
    login_res = client.post("/auth/login", json={"username": "admin", "password": "123"})
    assert login_res.status_code == 200
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # 2. Criar uma nova categoria
    res_cat = client.post("/produtos/categorias", json={
        "id": "cat-sobremesas",
        "nome": "Sobremesas",
        "destino_impressao": "COZINHA"
    }, headers=headers)
    assert res_cat.status_code == 201
    
    # 3. Criar um novo produto
    res_prod = client.post("/produtos/", json={
        "id": "prod-pudim",
        "nome": "Pudim",
        "categoria_id": "cat-sobremesas",
        "preco": 10.0,
        "descricao": "Pudim cremoso de leite",
        "imagem": "",
        "ativo": True
    }, headers=headers)
    assert res_prod.status_code == 201
    
    # O snapshot autenticado é a fonte única; nenhum arquivo local participa do runtime.
    catalog = client.get("/produtos/catalogo", headers=headers).json()
    categories = catalog["categorias"]
    products = catalog["produtos"]

    assert any(category["nome"] == "Sobremesas" for category in categories)
    assert any(p["id"] == "prod-pudim" for p in products)
    
    # 4. Atualizar o preço do pudim
    res_update = client.put("/produtos/prod-pudim", json={
        "preco": 12.0
    }, headers=headers)
    assert res_update.status_code == 200
    
    catalog = client.get("/produtos/catalogo", headers=headers).json()
    pudim = next(p for p in catalog["produtos"] if p["id"] == "prod-pudim")
    assert pudim["preco"] == 12.0
    
    # 5. Deletar o produto Pudim
    res_delete = client.delete("/produtos/prod-pudim", headers=headers)
    assert res_delete.status_code == 204
    
    # A exclusão é lógica: preserva histórico, mas some dos canais públicos.
    catalog = client.get("/produtos/catalogo", headers=headers).json()
    pudim = next(p for p in catalog["produtos"] if p["id"] == "prod-pudim")
    assert pudim["ativo"] is False
    public_menu = client.get("/api/cardapio-digital/public?restaurante_id=1").json()
    assert not any(p["id"] == "prod-pudim" for p in public_menu["produtos"])

def test_importacao_sobrescreve_cardapio():
    client = TestClient(app)
    
    # Token
    login_res = client.post("/auth/login", json={"username": "admin", "password": "123"})
    assert login_res.status_code == 200
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # Importar um novo cardápio de fora (contendo apenas Guarana e Pizza)
    novos_produtos = [
        {
            "id": "prod-guarana",
            "nome": "Guaraná",
            "categoria_id": "cat-bebidas",
            "preco": 5.0,
            "descricao": "Guaraná lata",
            "imagem": "",
            "ativo": True
        },
        {
            "id": "prod-pizza",
            "nome": "Pizza de Pepperoni",
            "categoria_id": "cat-comidas",
            "preco": 35.0,
            "descricao": "Pizza grande",
            "imagem": "",
            "ativo": True
        }
    ]
    
    res_import = client.post("/produtos/importar", json=novos_produtos, headers=headers)
    assert res_import.status_code == 200
    
    # Verificar no banco de dados se os produtos antigos (Coca e Burguer) foram inativados/deletados
    db = TestingSessionLocal()
    coca = db.query(Produto).filter(Produto.id == "prod-coca").first()
    burguer = db.query(Produto).filter(Produto.id == "prod-burguer").first()
    
    # Como a deleção física de produtos foi removida, Coca-Cola e Burguer devem continuar existindo, mas inativos
    assert coca is not None
    assert coca.ativo is False
    assert burguer is not None
    assert burguer.ativo is False
    
    # pizza e guarana devem existir e estar ativos
    pizza = db.query(Produto).filter(Produto.id == "prod-pizza").first()
    assert pizza is not None
    assert pizza.ativo is True
    
    catalog = client.get("/produtos/catalogo", headers=headers).json()
    products = [p for p in catalog["produtos"] if p["ativo"]]
    assert len(products) == 2
    assert any(p["id"] == "prod-guarana" for p in products)
    assert any(p["id"] == "prod-pizza" for p in products)
    assert not any(p["id"] == "prod-coca" for p in products)
    
    db.close()

def test_importacao_preserva_fk_historica():
    client = TestClient(app)
    
    # Token
    login_res = client.post("/auth/login", json={"username": "admin", "password": "123"})
    assert login_res.status_code == 200
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # 1. Criar um item associado ao produto 'prod-coca' para simular histórico de comanda
    db = TestingSessionLocal()
    comanda = Comanda(id="comanda-teste", restaurante_id=1, mesa_id=1, garcom_id="u-admin", tipo="Consumo no Local", numero_pedido=1, fechada=True)
    db.add(comanda)
    db.commit()
    
    lancamento = Lancamento(
        id="lan-teste",
        restaurante_id=1,
        comanda_id="comanda-teste",
        garcom_id="u-admin",
    )
    db.add(lancamento)
    db.commit()
    
    item = Item(id="item-teste", restaurante_id=1, comanda_id="comanda-teste", lancamento_id="lan-teste", produto_id="prod-coca", preco_unit=6.0, status="entregue")
    db.add(item)
    db.commit()
    db.close()
    
    # 2. Fazer uma importação de cardápio que NÃO contém o item 'prod-coca'
    novos_produtos = [
        {
            "id": "prod-pizza",
            "nome": "Pizza de Pepperoni",
            "categoria_id": "cat-comidas",
            "preco": 35.0,
            "descricao": "Pizza grande",
            "imagem": "",
            "ativo": True
        }
    ]
    
    res_import = client.post("/produtos/importar", json=novos_produtos, headers=headers)
    assert res_import.status_code == 200
    
    # 3. Validar que Coca-Cola ainda existe no banco para evitar quebrar a FK do histórico de vendas
    db = TestingSessionLocal()
    coca = db.query(Produto).filter(Produto.id == "prod-coca").first()
    assert coca is not None
    # Mas ela deve estar INATIVA para não aparecer no menu
    assert coca.ativo is False
    
    # 4. Checar que Coca-Cola foi removida do cardápio público ativo.
    public_menu = client.get("/api/cardapio-digital/public?restaurante_id=1").json()
    assert not any(p["id"] == "prod-coca" for p in public_menu["produtos"])
    
    db.close()

def test_importacao_composta_cardapio():
    client = TestClient(app)
    
    # Token
    login_res = client.post("/auth/login", json={"username": "admin", "password": "123"})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # Importar cardápio no formato composto {categories, products}
    payload_composto = {
        "categories": ["Refrescos Finos", "Comidas Rápidas"],
        "products": [
            {
                "id": "prod-limonada",
                "nome": "Limonada Suíça",
                "categoria_id": "cat-refrescos-finos",
                "preco": 8.0,
                "descricao": "Suco de limão fresco",
                "imagem": "",
                "ativo": True
            },
            {
                "id": "prod-pastel",
                "nome": "Pastel de Carne",
                "categoria_id": "cat-comidas-rapidas",
                "preco": 12.0,
                "descricao": "Pastel crocante de carne",
                "imagem": "",
                "ativo": True
            }
        ]
    }
    
    res_import = client.post("/produtos/importar", json=payload_composto, headers=headers)
    assert res_import.status_code == 200
    
    # Verificar no banco
    db = TestingSessionLocal()
    cat_refrescos = db.query(Categoria).filter(Categoria.id == "cat-refrescos-finos").first()
    assert cat_refrescos is not None
    assert cat_refrescos.nome == "Refrescos Finos"
    
    limonada = db.query(Produto).filter(Produto.id == "prod-limonada").first()
    assert limonada is not None
    assert limonada.ativo is True
    
    catalog = client.get("/produtos/catalogo", headers=headers).json()
    assert any(category["nome"] == "Refrescos Finos" for category in catalog["categorias"])
    assert any(p["id"] == "prod-limonada" and p["ativo"] for p in catalog["produtos"])
    db.close()


def test_universal_product_family_sells_only_real_skus_and_preserves_tenant_isolation():
    """Products remain real IDs; families only change catalog presentation."""
    client = TestClient(app)
    response = client.post("/auth/login", json={"username": "admin", "password": "123"})
    assert response.status_code == 200
    headers = {"Authorization": f"Bearer {response.json()['access_token']}"}

    with TestingSessionLocal() as db:
        db.add(GrupoModificador(id="group-included", restaurante_id=1, nome="Ponto da carne", tipo="obrigatorio", min_selecoes=1, max_selecoes=1))
        db.add(GrupoModificador(id="group-paid", restaurante_id=1, nome="Extras", tipo="opcional", min_selecoes=0, max_selecoes=2))
        db.flush()
        db.add(OpcaoModificador(id="rare", restaurante_id=1, grupo_id="group-included", nome="Mal passado", preco_adicional=0, ativo=True))
        db.add(OpcaoModificador(id="bacon", restaurante_id=1, grupo_id="group-paid", nome="Bacon extra", preco_adicional=2, ativo=True))
        db.commit()

    new_family = {
        "grupo_ids": ["group-included", "group-paid"],
        "nome": "Porção do dia",
        "descricao": "Fritas artesanais com molho",
        "eixo": "tamanho",
        "categoria_id": "cat-comidas",
        "cardapio_id": None,
        "imagem": "",
        "variantes": [
            {"rotulo": "Pequena (200 g)", "preco": 12, "ativo": True},
            {"rotulo": "Grande (400 g)", "preco": 18, "ativo": True},
        ],
    }
    created = client.post("/produto-familias", json=new_family, headers=headers)
    assert created.status_code == 201, created.text
    family = created.json()
    assert family["nome"] == "Porção do dia"
    assert family["eixo"] == "tamanho"
    assert len(family["variantes"]) == 2
    assert set(family["grupo_ids"]) == {"group-included", "group-paid"}
    first, second = family["variantes"]
    with TestingSessionLocal() as db:
        links = db.query(ProdutoGrupoModificador).filter(
            ProdutoGrupoModificador.restaurante_id == 1,
            ProdutoGrupoModificador.produto_id.in_([first["produto_id"], second["produto_id"]]),
        ).all()
        assert {(row.produto_id, row.grupo_id) for row in links} == {
            (sku, group) for sku in (first["produto_id"], second["produto_id"])
            for group in ("group-included", "group-paid")
        }
    assert first["produto_id"] != second["produto_id"]

    menu = client.get("/api/cardapio-digital/public?restaurante_id=1")
    assert menu.status_code == 200, menu.text
    created_items = {
        product["id"]: product for product in menu.json()["produtos"]
        if product["id"] in (first["produto_id"], second["produto_id"])
    }
    assert len(created_items) == 2
    assert {item["preco"] for item in created_items.values()} == {12, 18}
    assert all(item["familia_id"] == family["id"] for item in created_items.values())
    assert {item["variacao_rotulo"] for item in created_items.values()} == {
        "Pequena (200 g)", "Grande (400 g)",
    }
    assert all(item["familia_nome"] == "Porção do dia" for item in created_items.values())
    assert {product["id"] for product in client.get("/produtos/catalogo", headers=headers).json()["produtos"]}.issuperset(created_items)

    # No silent deletion of variants with potential sale history.
    partial = {**new_family, "variantes": [
        {"produto_id": first["produto_id"], "rotulo": "Pequena", "preco": 14, "ativo": True}
    ]}
    blocked = client.put(f"/produto-familias/{family['id']}", json=partial, headers=headers)
    assert blocked.status_code == 409
    assert len(client.get("/produto-familias", headers=headers).json()[0]["variantes"]) == 2

    # Editing one variant keeps real SKU IDs and can pause it without deleting.
    updated = {**new_family, "grupo_ids": ["group-included"], "nome": "Porção especial", "variantes": [
        {"produto_id": first["produto_id"], "rotulo": "P (200 g)", "preco": 12, "ativo": True},
        {"produto_id": second["produto_id"], "rotulo": "G (400 g)", "preco": 19, "ativo": False},
    ]}
    result = client.put(f"/produto-familias/{family['id']}", json=updated, headers=headers)
    assert result.status_code == 200, result.text
    assert {variant["produto_id"] for variant in result.json()["variantes"]} == {
        first["produto_id"], second["produto_id"],
    }
    assert {variant["preco"] for variant in result.json()["variantes"]} == {12, 19}
    with TestingSessionLocal() as db:
        links = db.query(ProdutoGrupoModificador).filter(
            ProdutoGrupoModificador.restaurante_id == 1,
            ProdutoGrupoModificador.produto_id.in_([first["produto_id"], second["produto_id"]]),
        ).all()
        assert {link.grupo_id for link in links} == {"group-included"}
        assert len(links) == 2

    with TestingSessionLocal() as db:
        db.add(Restaurante(id=2, nome="Outra loja", plano="pocket"))
        db.flush()
        db.add(Categoria(id="cat-comidas", restaurante_id=2, nome="Comidas"))
        db.add(Usuario(id="u-admin2", restaurante_id=2, nome="Outro admin",
                       usuario="outro-admin", senha_hash=get_password_hash("456"),
                       role="admin", status="ativo"))
        db.commit()

    other_login = client.post("/auth/login", json={"username": "outro-admin", "password": "456"})
    assert other_login.status_code == 200, other_login.text
    other_headers = {"Authorization": f"Bearer {other_login.json()['access_token']}"}
    assert client.get("/produto-familias", headers=other_headers).json() == []
    assert client.put(f"/produto-familias/{family['id']}", json=updated, headers=other_headers).status_code == 404
    cross_tenant = {**new_family, "variantes": [
        {"produto_id": first["produto_id"], "rotulo": "Usar item externo", "preco": 12, "ativo": True}
    ]}
    assert client.post("/produto-familias", json=cross_tenant, headers=other_headers).status_code == 404


def test_single_product_customizations_configurable_without_editing_global_group():
    client = TestClient(app)
    with TestingSessionLocal() as db:
        db.add(GrupoModificador(id="single-free", restaurante_id=1, nome="Molhos", tipo="opcional", min_selecoes=0, max_selecoes=1))
        db.add(GrupoModificador(id="single-paid", restaurante_id=1, nome="Extras", tipo="opcional", min_selecoes=0, max_selecoes=1))
        db.commit()

    login = client.post("/auth/login", json={"username": "admin", "password": "123"})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    created = client.post("/produtos/", headers=headers, json={
        "id": "sku-custom", "nome": "Hambúrguer com escolhas", "categoria_id": "cat-comidas",
        "preco": 20, "grupo_ids": ["single-free", "single-paid"],
    })
    assert created.status_code == 201, created.text
    with TestingSessionLocal() as db:
        linked = db.query(ProdutoGrupoModificador).filter_by(restaurante_id=1, produto_id="sku-custom").all()
        assert {row.grupo_id for row in linked} == {"single-free", "single-paid"}

    edited = client.put("/produtos/sku-custom", headers=headers, json={"grupo_ids": ["single-free"]})
    assert edited.status_code == 200, edited.text
    with TestingSessionLocal() as db:
        linked = db.query(ProdutoGrupoModificador).filter_by(restaurante_id=1, produto_id="sku-custom").all()
        assert {row.grupo_id for row in linked} == {"single-free"}

    invalid = client.put("/produtos/sku-custom", headers=headers, json={"grupo_ids": ["foreign-tenant-group"]})
    assert invalid.status_code == 404
    with TestingSessionLocal() as db:
        assert {row.grupo_id for row in db.query(ProdutoGrupoModificador).filter_by(restaurante_id=1, produto_id="sku-custom")} == {"single-free"}

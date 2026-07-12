import os
import json
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Configurar banco de testes
os.environ["DATABASE_URL"] = "sqlite:///./test_menu_sync.db"

from app.database import Base, get_db
from app.models import Restaurante, Usuario, Produto, Categoria, Item, Comanda, Lancamento, Mesa
from app.security import get_password_hash
from app.main import app

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_menu_sync.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})

from sqlalchemy import event
from sqlalchemy.engine import Engine

@event.listens_for(Engine, "connect")
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
    
    db.add(Usuario(id="u-admin", restaurante_id=1, nome="Admin Test", usuario="admin", senha_hash=get_password_hash("123"), role="admin"))
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
    
    # Limpar arquivo dump.json antigo se houver
    if os.path.exists("backend/dump.json"):
        os.remove("backend/dump.json")
        
    yield
    Base.metadata.drop_all(bind=engine)
    app.dependency_overrides.clear()
    
    if os.path.exists("backend/dump.json"):
        os.remove("backend/dump.json")

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
    
    # Verificar se o dump.json foi criado e contém o novo produto
    assert os.path.exists("backend/dump.json")
    with open("backend/dump.json", "r", encoding="utf-8") as f:
        dump = json.load(f)
        
    categories = dump["categories"]
    products = dump["products"]
    
    assert "Sobremesas" in categories
    assert any(p["id"] == "prod-pudim" for p in products)
    
    # 4. Atualizar o preço do pudim
    res_update = client.put("/produtos/prod-pudim", json={
        "preco": 12.0
    }, headers=headers)
    assert res_update.status_code == 200
    
    # Verificar se o dump.json foi atualizado com o novo preço
    with open("backend/dump.json", "r", encoding="utf-8") as f:
        dump = json.load(f)
    pudim = next(p for p in dump["products"] if p["id"] == "prod-pudim")
    assert pudim["preco"] == 12.0
    
    # 5. Deletar o produto Pudim
    res_delete = client.delete("/produtos/prod-pudim", headers=headers)
    assert res_delete.status_code == 204
    
    # Verificar se o pudim saiu do dump.json
    with open("backend/dump.json", "r", encoding="utf-8") as f:
        dump = json.load(f)
    assert not any(p["id"] == "prod-pudim" for p in dump["products"])

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
    
    # Verificar dump.json
    with open("backend/dump.json", "r", encoding="utf-8") as f:
        dump = json.load(f)
        
    products = dump["products"]
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
    
    lancamento = Lancamento(id="lan-teste", comanda_id="comanda-teste", garcom_id="u-admin")
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
    
    # 4. Checar que Coca-Cola foi removida do dump.json ativo para que o menu seja dinâmico
    with open("backend/dump.json", "r", encoding="utf-8") as f:
        dump = json.load(f)
    assert not any(p["id"] == "prod-coca" for p in dump["products"])
    
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
    
    # Verificar dump.json
    with open("backend/dump.json", "r", encoding="utf-8") as f:
        dump = json.load(f)
        
    assert "Refrescos Finos" in dump["categories"]
    assert any(p["id"] == "prod-limonada" for p in dump["products"])
    db.close()

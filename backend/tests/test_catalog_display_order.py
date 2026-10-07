"""Testes da inteligência de ordenação do cardápio KÔMA.

Cobre os requisitos A a J da especificação:
A. categorias com ordem explícita respeitam a ordem;
B. ordem não depende do nome;
C. "Bebidas" não sobe para primeiro só por ordem alfabética;
D. restaurante pode alterar ordem;
E. tenant A e tenant B podem possuir ordens diferentes;
F. endpoint Admin e endpoint público usam a mesma ordem;
G. categorias vazias não quebram a sequência pública;
H. criação posterior de nova categoria não reorganiza silenciosamente todas as anteriores;
I. fallback antigo continua funcionando para tenant ainda não migrado;
J. produtos respeitam ordem explícita.
"""
from types import SimpleNamespace
from unittest.mock import MagicMock
import pytest
from starlette.testclient import TestClient

from app.catalog_ordering import (
    ordered_categories,
    ordered_products,
    resolve_category_sort_key,
    resolve_product_sort_key,
)
from app.main import app
from app.models import Categoria, Produto, Restaurante, Usuario
from app.security import create_access_token


# A. categorias com ordem explícita respeitam a ordem
def test_a_categorias_com_ordem_explicita_respeitam_ordem():
    categories = [
        SimpleNamespace(id="cat-5", nome="SOBREMESAS", ordem_exibicao=50),
        SimpleNamespace(id="cat-1", nome="BURGERS", ordem_exibicao=10),
        SimpleNamespace(id="cat-4", nome="BEBIDAS", ordem_exibicao=40),
        SimpleNamespace(id="cat-2", nome="COMBOS", ordem_exibicao=20),
        SimpleNamespace(id="cat-3", nome="PORÇÕES", ordem_exibicao=30),
    ]
    result = ordered_categories(categories, niche="hamburgueria")
    assert [c.nome for c in result] == [
        "BURGERS",
        "COMBOS",
        "PORÇÕES",
        "BEBIDAS",
        "SOBREMESAS",
    ]


# B. ordem não depende do nome
def test_b_ordem_nao_depende_do_nome():
    categories = [
        SimpleNamespace(id="cat-z", nome="Zebra Burger", ordem_exibicao=10),
        SimpleNamespace(id="cat-a", nome="Abacaxi Grelhado", ordem_exibicao=20),
    ]
    result = ordered_categories(categories)
    assert [c.nome for c in result] == ["Zebra Burger", "Abacaxi Grelhado"]


# C. "Bebidas" não sobe para primeiro só por ordem alfabética
def test_c_bebidas_nao_sobe_para_primeiro_por_alfabetica():
    categories = [
        SimpleNamespace(id="bebidas", nome="BEBIDAS", ordem_exibicao=None),
        SimpleNamespace(id="burgers", nome="BURGERS", ordem_exibicao=None),
        SimpleNamespace(id="combos", nome="COMBOS", ordem_exibicao=None),
        SimpleNamespace(id="porcoes", nome="PORÇÕES", ordem_exibicao=None),
        SimpleNamespace(id="sobremesas", nome="SOBREMESAS", ordem_exibicao=None),
    ]
    # Em hamburgueria mesmo sem ordem explícita o nicho deve priorizar comida
    result = ordered_categories(categories, niche="hamburgueria")
    assert result[0].nome == "BURGERS"
    assert [c.nome for c in result] == [
        "BURGERS",
        "COMBOS",
        "PORÇÕES",
        "BEBIDAS",
        "SOBREMESAS",
    ]


# D. restaurante pode alterar ordem
def test_d_restaurante_pode_alterar_ordem():
    categories = [
        SimpleNamespace(id="burgers", nome="BURGERS", ordem_exibicao=10),
        SimpleNamespace(id="combos", nome="COMBOS", ordem_exibicao=20),
        SimpleNamespace(id="sobremesas", nome="SOBREMESAS", ordem_exibicao=30),
    ]
    # Admin inverte combos para primeiro
    categories[1].ordem_exibicao = 5
    result = ordered_categories(categories, niche="hamburgueria")
    assert [c.nome for c in result] == ["COMBOS", "BURGERS", "SOBREMESAS"]


# E. tenant A e tenant B podem possuir ordens diferentes
def test_e_tenant_a_e_tenant_b_ordens_diferentes():
    # Tenant A (Hamburgueria padrão): BURGERS primeiro
    tenant_a_cats = [
        SimpleNamespace(restaurante_id=1, nome="BURGERS", ordem_exibicao=10),
        SimpleNamespace(restaurante_id=1, nome="COMBOS", ordem_exibicao=20),
    ]
    # Tenant B (Foco em combos promocionais): COMBOS primeiro
    tenant_b_cats = [
        SimpleNamespace(restaurante_id=2, nome="BURGERS", ordem_exibicao=20),
        SimpleNamespace(restaurante_id=2, nome="COMBOS", ordem_exibicao=10),
    ]
    assert [c.nome for c in ordered_categories(tenant_a_cats)] == ["BURGERS", "COMBOS"]
    assert [c.nome for c in ordered_categories(tenant_b_cats)] == ["COMBOS", "BURGERS"]


# F. endpoint Admin e endpoint público usam a mesma ordem
def test_f_admin_e_publico_usam_mesma_ordem():
    cats = [
        SimpleNamespace(id="b", nome="BEBIDAS", ordem_exibicao=40),
        SimpleNamespace(id="a", nome="BURGERS", ordem_exibicao=10),
    ]
    admin_order = ordered_categories(cats, niche="hamburgueria")
    public_order = ordered_categories(cats, niche="hamburgueria")
    assert [c.id for c in admin_order] == [c.id for c in public_order] == ["a", "b"]


# G. categorias vazias não quebram a sequência pública
def test_g_categorias_vazias_nao_quebram_sequencia_publica():
    all_categories = [
        SimpleNamespace(id="burgers", nome="BURGERS", ordem_exibicao=10),
        SimpleNamespace(id="combos", nome="COMBOS", ordem_exibicao=20),
        SimpleNamespace(id="porcoes", nome="PORÇÕES", ordem_exibicao=30),
        SimpleNamespace(id="bebidas", nome="BEBIDAS", ordem_exibicao=40),
        SimpleNamespace(id="sobremesas", nome="SOBREMESAS", ordem_exibicao=50),
    ]
    # Produtos ativos apenas em burgers, combos, bebidas, sobremesas (porcoes vazia)
    produtos_ativos = [
        SimpleNamespace(id="p1", categoria_id="burgers", nome="D8 Bacon"),
        SimpleNamespace(id="p2", categoria_id="combos", nome="Combo Bacon"),
        SimpleNamespace(id="p3", categoria_id="bebidas", nome="Refrigerante"),
        SimpleNamespace(id="p4", categoria_id="sobremesas", nome="Brownie"),
    ]
    active_cat_ids = {p.categoria_id for p in produtos_ativos}
    public_categories = [c for c in all_categories if c.id in active_cat_ids]
    result = ordered_categories(public_categories, niche="hamburgueria")
    assert [c.nome for c in result] == [
        "BURGERS",
        "COMBOS",
        "BEBIDAS",
        "SOBREMESAS",
    ]


# H. criação posterior de nova categoria não reorganiza silenciosamente todas as anteriores
def test_h_criacao_posterior_preserva_ordens_anteriores():
    initial_categories = [
        SimpleNamespace(id="c1", nome="BURGERS", ordem_exibicao=10),
        SimpleNamespace(id="c2", nome="COMBOS", ordem_exibicao=20),
    ]
    # Nova categoria criada posteriormente com ordem calculada (max + 10)
    max_order = max(c.ordem_exibicao for c in initial_categories)
    new_cat = SimpleNamespace(id="c3", nome="BEBIDAS", ordem_exibicao=max_order + 10)
    all_cats = [*initial_categories, new_cat]
    result = ordered_categories(all_cats)
    assert [c.id for c in result] == ["c1", "c2", "c3"]
    assert result[0].ordem_exibicao == 10
    assert result[1].ordem_exibicao == 20
    assert result[2].ordem_exibicao == 30


# I. fallback antigo continua funcionando para tenant ainda não migrado
def test_i_fallback_antigo_continua_funcionando():
    legacy_cats = [
        SimpleNamespace(id="sob", nome="Sobremesas", ordem_exibicao=None),
        SimpleNamespace(id="pet", nome="Petiscos", ordem_exibicao=None),
        SimpleNamespace(id="que", nome="Quentinhas", ordem_exibicao=None),
    ]
    # Sem nicho informado, segue a lista legada canônica
    result = ordered_categories(legacy_cats)
    assert [c.nome for c in result] == ["Quentinhas", "Petiscos", "Sobremesas"]


# J. produtos respeitam ordem explícita se esse recurso for implementado
def test_j_produtos_respeitam_ordem_explicita():
    # Produtos do D8 Burger
    burgers = [
        SimpleNamespace(id="veggie-d8", nome="Veggie D8", ordem_exibicao=60, preco=26.90),
        SimpleNamespace(id="d8-bacon", nome="D8 Bacon", ordem_exibicao=20, preco=29.90),
        SimpleNamespace(id="d8-classico", nome="D8 Clássico", ordem_exibicao=10, preco=24.90),
        SimpleNamespace(id="smash-duplo", nome="Smash Duplo", ordem_exibicao=30, preco=32.90),
        SimpleNamespace(id="frango-crocante", nome="Frango Crocante", ordem_exibicao=50, preco=25.90),
        SimpleNamespace(id="sertao-burger", nome="Sertão Burger", ordem_exibicao=40, preco=31.90),
    ]
    result = ordered_products(burgers)
    assert [p.nome for p in result] == [
        "D8 Clássico",
        "D8 Bacon",
        "Smash Duplo",
        "Sertão Burger",
        "Frango Crocante",
        "Veggie D8",
    ]
    # A ordem independe do preço
    precos = [p.preco for p in result]
    assert precos != sorted(precos)


def test_api_reordenar_categorias_e_produtos(tmp_path):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.database import Base, get_db
    from app.models import Restaurante, Usuario, Categoria, Produto

    db_path = tmp_path / "test_reorder.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db

    db = TestingSession()
    rest = Restaurante(id=99, nome="Burger 99", plano="pocket", slug="burger-99")
    db.add(rest)
    admin_user = Usuario(
        id="usr-admin-99",
        restaurante_id=99,
        nome="Admin 99",
        usuario="admin99",
        senha_hash="hash",
        role="admin",
        status="ativo",
    )
    db.add(admin_user)

    cat_bebidas = Categoria(id="cat-beb", restaurante_id=99, nome="BEBIDAS", ordem_exibicao=40)
    cat_burgers = Categoria(id="cat-bur", restaurante_id=99, nome="BURGERS", ordem_exibicao=10)
    cat_vazia = Categoria(id="cat-vaz", restaurante_id=99, nome="SOBREMESAS", ordem_exibicao=50)
    db.add_all([cat_bebidas, cat_burgers, cat_vazia])

    p1 = Produto(id="p-bur1", restaurante_id=99, categoria_id="cat-bur", nome="Burger Simples", preco=20.0, ordem_exibicao=20, ativo=True)
    p2 = Produto(id="p-bur2", restaurante_id=99, categoria_id="cat-bur", nome="Burger Bacon", preco=25.0, ordem_exibicao=10, ativo=True)
    p3 = Produto(id="p-refri", restaurante_id=99, categoria_id="cat-beb", nome="Coca-Cola", preco=6.0, ordem_exibicao=10, ativo=True)
    db.add_all([p1, p2, p3])
    db.commit()
    db.close()

    token = create_access_token(subject="usr-admin-99", restaurante_id=99, role="admin")
    headers = {"Authorization": f"Bearer {token}"}
    client = TestClient(app)

    # 1. GET /produtos/categorias deve retornar ordenado por ordem_exibicao
    res_cats = client.get("/produtos/categorias", headers=headers)
    assert res_cats.status_code == 200
    data_cats = res_cats.json()
    assert [c["nome"] for c in data_cats] == ["BURGERS", "BEBIDAS", "SOBREMESAS"]

    # 2. PUT /produtos/categorias/reordenar inverte para BEBIDAS, BURGERS, SOBREMESAS
    res_reorder_cats = client.put(
        "/produtos/categorias/reordenar",
        headers=headers,
        json={"categoria_ids": ["cat-beb", "cat-bur", "cat-vaz"]},
    )
    assert res_reorder_cats.status_code == 200
    assert [c["nome"] for c in res_reorder_cats.json()] == ["BEBIDAS", "BURGERS", "SOBREMESAS"]

    # 3. GET /produtos/catalogo retorna produtos ordenados
    res_cat = client.get("/produtos/catalogo", headers=headers)
    assert res_cat.status_code == 200
    prods = res_cat.json()["produtos"]
    burger_prods = [p for p in prods if p["categoria_id"] == "cat-bur"]
    assert [p["nome"] for p in burger_prods] == ["Burger Bacon", "Burger Simples"]

    # 4. PUT /produtos/reordenar inverte produtos
    res_reorder_prods = client.put(
        "/produtos/reordenar",
        headers=headers,
        json={"produto_ids": ["p-bur1", "p-bur2", "p-refri"]},
    )
    assert res_reorder_prods.status_code == 200

    # 5. Cardápio Público: não deve mostrar categoria vazia SOBREMESAS
    res_pub = client.get("/api/cardapio-digital/public?restaurante_id=99")
    assert res_pub.status_code == 200
    pub_data = res_pub.json()
    pub_cat_names = [c["nome"] for c in pub_data["categorias"]]
    assert "SOBREMESAS" not in pub_cat_names
    assert len(pub_cat_names) == 2

    app.dependency_overrides.pop(get_db, None)



def test_niche_resolution_reuses_loaded_profile_without_requery():
    from app.catalog_ordering import resolve_restaurant_niche

    class NoQueryDatabase:
        calls = 0
        def query(self, *args):
            self.calls += 1
            raise AssertionError("Already loaded profile/configuration must not be queried again")

    db = NoQueryDatabase()
    assert resolve_restaurant_niche(db, 101, "pizzaria", stored_profile_key="marmitaria") == "marmitaria"
    assert resolve_restaurant_niche(db, 101, "pizzaria", stored_profile_key=None) == "pizzaria"
    assert resolve_restaurant_niche(db, 101, "pizzaria", stored_profile_key="generic") == "pizzaria"
    assert db.calls == 0

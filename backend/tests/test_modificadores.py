import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal, current_restaurante_id
from app.models import Restaurante, Usuario, Categoria, Produto, GrupoModificador, OpcaoModificador, ProdutoGrupoModificador
from app.routes.auth import create_access_token

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_mod_test():
    db = SessionLocal()
    token = current_restaurante_id.set(999)
    try:
        rest = db.query(Restaurante).filter(Restaurante.id == 999).first()
        if not rest:
            rest = Restaurante(id=999, nome="Restaurante Teste 999", slug="rest-999")
            db.add(rest)
            db.commit()

        user = db.query(Usuario).filter(Usuario.id == "usr-admin-mod").first()
        if not user:
            user = Usuario(
                id="usr-admin-mod",
                restaurante_id=999,
                nome="Admin Mod",
                email="modadmin@koma.com",
                cargo="admin",
                status="ativo",
            )
            db.add(user)
            db.commit()

        cat = db.query(Categoria).filter(Categoria.restaurante_id == 999, Categoria.id == "cat-burgers").first()
        if not cat:
            cat = Categoria(id="cat-burgers", restaurante_id=999, nome="Burgers")
            db.add(cat)
            db.commit()

        prod = db.query(Produto).filter(Produto.restaurante_id == 999, Produto.id == "prod-burger-1").first()
        if not prod:
            prod = Produto(id="prod-burger-1", restaurante_id=999, categoria_id="cat-burgers", nome="Burger Clássico", preco=35.0)
            db.add(prod)
            db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()


def _auth_headers():
    token = create_access_token(subject="usr-admin-mod", restaurante_id=999, role="admin")
    return {"Authorization": f"Bearer {token}"}


def test_criar_e_listar_grupos_modificadores():
    headers = _auth_headers()
    res = client.post(
        "/cardapio/modificadores/grupos",
        headers=headers,
        json={
            "nome": "Ponto da Carne",
            "min_selecoes": 1,
            "max_selecoes": 1,
            "tipo": "obrigatorio",
            "opcoes": [
                {"nome": "Ao Ponto", "preco_adicional": 0.0, "ativo": True},
                {"nome": "Bem Passado", "preco_adicional": 0.0, "ativo": True},
            ],
            "produto_ids": ["prod-burger-1"],
        }
    )
    assert res.status_code == 201
    data = res.json()
    assert data["nome"] == "Ponto da Carne"
    assert data["min_selecoes"] == 1
    assert data["max_selecoes"] == 1
    assert data["tipo"] == "obrigatorio"
    assert len(data["opcoes"]) == 2
    assert "prod-burger-1" in data["produto_ids"]

    # Consulta pública
    res_pub = client.get("/cardapio/modificadores/publico/999")
    assert res_pub.status_code == 200
    grupos_pub = res_pub.json()
    assert any(g["nome"] == "Ponto da Carne" for g in grupos_pub)

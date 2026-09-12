import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.main import app
from app.database import SessionLocal, current_restaurante_id
from app.models import Restaurante, Usuario, Categoria, Produto, GrupoModificador, OpcaoModificador, ProdutoGrupoModificador
from app.routes.auth import create_access_token
from app.routes.modificadores import listar_grupos_publico

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
                {"nome": "Opção Interna Futura", "preco_adicional": 7.5, "ativo": False},
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
    assert len(data["opcoes"]) == 3
    assert any(op["nome"] == "Opção Interna Futura" and op["ativo"] is False for op in data["opcoes"])
    assert "prod-burger-1" in data["produto_ids"]

    # Consulta pública: configuração desativada não pode vazar para cliente anônimo.
    res_pub = client.get("/cardapio/modificadores/publico/999")
    assert res_pub.status_code == 200
    grupos_pub = res_pub.json()
    grupo_publico = next(g for g in grupos_pub if g["nome"] == "Ponto da Carne")
    assert {op["nome"] for op in grupo_publico["opcoes"]} == {"Ao Ponto", "Bem Passado"}
    assert all(op["ativo"] is True for op in grupo_publico["opcoes"])


def test_listar_grupos_publico_has_constant_query_count():
    """A listagem deve custar quatro SELECTs, independentemente do número de grupos."""
    db = SessionLocal()
    token = current_restaurante_id.set(999)
    try:
        for index in range(8):
            group_id = f"gmod-perf-{index}"
            if db.query(GrupoModificador).filter(
                GrupoModificador.restaurante_id == 999,
                GrupoModificador.id == group_id,
            ).first() is None:
                db.add(
                    GrupoModificador(
                        id=group_id,
                        restaurante_id=999,
                        nome=f"Grupo Perf {index}",
                        min_selecoes=0,
                        max_selecoes=1,
                        tipo="opcional",
                    )
                )
                db.add(
                    OpcaoModificador(
                        id=f"opmod-perf-{index}",
                        restaurante_id=999,
                        grupo_id=group_id,
                        nome=f"Opção Perf {index}",
                        preco_adicional=0.0,
                        ativo=True,
                    )
                )
                db.add(
                    ProdutoGrupoModificador(
                        restaurante_id=999,
                        produto_id="prod-burger-1",
                        grupo_id=group_id,
                    )
                )
        db.commit()

        select_statements: list[str] = []
        engine = db.get_bind()

        def capture_selects(_conn, _cursor, statement, _parameters, _context, _executemany):
            if statement.lstrip().upper().startswith("SELECT"):
                select_statements.append(statement)

        event.listen(engine, "before_cursor_execute", capture_selects)
        try:
            payload = listar_grupos_publico(999, db)
        finally:
            event.remove(engine, "before_cursor_execute", capture_selects)

        assert len([grupo for grupo in payload if grupo.id.startswith("gmod-perf-")]) == 8
        assert len(select_statements) == 4
    finally:
        current_restaurante_id.reset(token)
        db.close()

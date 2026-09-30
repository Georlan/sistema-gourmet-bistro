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


def test_pause_option_preserves_ids_and_bindings_and_hides_public_choice():
    response = client.post('/cardapio/modificadores/grupos', headers=_auth_headers(), json={
        'nome': 'Proteínas do dia', 'min_selecoes': 1, 'max_selecoes': 1, 'tipo': 'obrigatorio',
        'opcoes': [{'nome': 'Frango', 'preco_adicional': 0, 'ativo': True}, {'nome': 'Carne', 'preco_adicional': 3, 'ativo': True}],
        'produto_ids': ['prod-burger-1'],
    })
    assert response.status_code == 201, response.text
    group = response.json()
    option = group['opcoes'][0]
    url = f"/cardapio/modificadores/opcoes/{option['id']}/disponibilidade"
    assert client.patch(url, json={'ativo': False}).status_code == 401
    db = SessionLocal()
    tenant_token = current_restaurante_id.set(999)
    try:
        db.add(Usuario(id='usr-waiter-marmitaria', restaurante_id=999, nome='Garçom', email='waiter-marmitaria@koma.test', cargo='garcom', status='ativo'))
        db.commit()
    finally:
        current_restaurante_id.reset(tenant_token)
        db.close()
    waiter_token = create_access_token(subject='usr-waiter-marmitaria', restaurante_id=999, role='garcom')
    assert client.patch(url, headers={'Authorization': f'Bearer {waiter_token}'}, json={'ativo': False}).status_code == 403
    assert client.patch(url, headers=_auth_headers(), json={'ativo': 'false'}).status_code == 422
    assert client.patch(url, headers=_auth_headers(), json={'ativo': False, 'preco_adicional': 99}).status_code == 422
    for active in [False, True]:
        changed = client.patch(url, headers=_auth_headers(), json={'ativo': active})
        assert changed.status_code == 200, changed.text
        assert changed.json() == {**option, 'ativo': active}
        public = client.get('/api/cardapio-digital/public?restaurante_id=999').json()
        product = next(p for p in public['produtos'] if p['id'] == 'prod-burger-1')
        modifier = next(g for g in product['grupos_modificadores'] if g['id'] == group['id'])
        assert (option['id'] in {o['id'] for o in modifier['opcoes']}) is active
        internal = client.get('/cardapio/modificadores/grupos', headers=_auth_headers()).json()
        saved = next(g for g in internal if g['id'] == group['id'])
        assert {o['id'] for o in saved['opcoes']} == {o['id'] for o in group['opcoes']}
        assert saved['produto_ids'] == group['produto_ids']
        assert saved['min_selecoes'] == 1 and saved['max_selecoes'] == 1
    assert client.patch('/cardapio/modificadores/opcoes/does-not-exist/disponibilidade', headers=_auth_headers(), json={'ativo': False}).status_code == 404


def test_option_availability_rejects_cross_tenant_access_and_archived_groups():
    from app.routes.modificadores import ARCHIVED_MODIFIER_TYPE

    db = SessionLocal()
    token = current_restaurante_id.set(998)
    try:
        if not db.query(Restaurante).filter_by(id=998).first():
            db.add(Restaurante(id=998, nome='Outra marmitaria', slug='other-marmitaria-998'))
            db.commit()
        db.add(GrupoModificador(id='other-proteins', restaurante_id=998, nome='Proteínas', tipo='opcional', min_selecoes=0, max_selecoes=1))
        db.flush()
        db.add(OpcaoModificador(id='other-chicken', restaurante_id=998, grupo_id='other-proteins', nome='Frango', preco_adicional=0, ativo=True))
        db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()
    assert client.patch('/cardapio/modificadores/opcoes/other-chicken/disponibilidade', headers=_auth_headers(), json={'ativo': False}).status_code == 404
    db = SessionLocal()
    token = current_restaurante_id.set(998)
    try:
        assert db.query(OpcaoModificador).filter_by(id='other-chicken').one().ativo is True
    finally:
        current_restaurante_id.reset(token)
        db.close()
    response = client.post('/cardapio/modificadores/grupos', headers=_auth_headers(), json={
        'nome': 'Grupo arquivado', 'min_selecoes': 0, 'max_selecoes': 1, 'tipo': 'opcional',
        'opcoes': [{'nome': 'Salada', 'preco_adicional': 0, 'ativo': True}], 'produto_ids': [],
    })
    assert response.status_code == 201
    group = response.json()
    db = SessionLocal()
    token = current_restaurante_id.set(999)
    try:
        db.query(GrupoModificador).filter_by(id=group['id']).one().tipo = ARCHIVED_MODIFIER_TYPE
        db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()
    assert client.patch(f"/cardapio/modificadores/opcoes/{group['opcoes'][0]['id']}/disponibilidade", headers=_auth_headers(), json={'ativo': False}).status_code == 404


def test_paused_product_is_hidden_and_returns_without_recreating_it():
    url = '/produtos/prod-burger-1'
    try:
        for active in [False, True]:
            response = client.put(url, headers=_auth_headers(), json={'ativo': active})
            assert response.status_code == 200, response.text
            assert response.json()['id'] == 'prod-burger-1'
            public = client.get('/api/cardapio-digital/public?restaurante_id=999')
            assert public.status_code == 200
            assert ('prod-burger-1' in {p['id'] for p in public.json()['produtos']}) is active
    finally:
        client.put(url, headers=_auth_headers(), json={'ativo': True})

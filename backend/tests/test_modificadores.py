import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.main import app
from app.database import SessionLocal, current_restaurante_id
from app.models import (
    Restaurante,
    Usuario,
    Categoria,
    Produto,
    GrupoModificador,
    OpcaoModificador,
    ProdutoGrupoModificador,
    Comanda,
    Lancamento,
    Item,
    ItemModificador,
)
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


def test_atualizar_grupo_preserva_opcao_referenciada_por_pedido_historico():
    headers = _auth_headers()
    created = client.post(
        "/cardapio/modificadores/grupos",
        headers=headers,
        json={
            "nome": "Proteínas históricas",
            "min_selecoes": 0,
            "max_selecoes": 2,
            "tipo": "opcional",
            "opcoes": [
                {"nome": "Frango", "preco_adicional": 0, "ativo": True},
                {"nome": "Carne", "preco_adicional": 2, "ativo": True},
            ],
            "produto_ids": ["prod-burger-1"],
        },
    )
    assert created.status_code == 201, created.text
    group = created.json()
    referenced = group["opcoes"][0]

    db = SessionLocal()
    tenant_token = current_restaurante_id.set(999)
    try:
        order_id = f"order-{group['id']}"
        launch_id = f"launch-{group['id']}"
        item_id = f"item-{group['id']}"
        timestamp = datetime.datetime(2026, 10, 2, 9, 0, 0)
        db.add(
            Comanda(
                id=order_id,
                restaurante_id=999,
                garcom_id="usr-admin-mod",
                mesa_id=None,
                tipo="Consumo no Local",
                numero_pedido=999001,
                fechada=True,
                criado_em=timestamp,
            )
        )
        db.add(
            Lancamento(
                id=launch_id,
                restaurante_id=999,
                comanda_id=order_id,
                garcom_id="usr-admin-mod",
                origem="garcom",
                status="producao",
                timestamp=timestamp,
            )
        )
        db.add(
            Item(
                id=item_id,
                restaurante_id=999,
                comanda_id=order_id,
                lancamento_id=launch_id,
                produto_id="prod-burger-1",
                preco_unit=35.0,
                observacao="",
                cliente_nome="Consumo Geral",
                status="entregue",
                pago=True,
            )
        )
        db.flush()
        db.add(
            ItemModificador(
                restaurante_id=999,
                item_id=item_id,
                opcao_modificador_id=referenced["id"],
                preco_aplicado=referenced["preco_adicional"],
            )
        )
        db.commit()
    finally:
        current_restaurante_id.reset(tenant_token)
        db.close()

    payload = {
        "nome": "Proteínas atualizadas",
        "min_selecoes": group["min_selecoes"],
        "max_selecoes": group["max_selecoes"],
        "tipo": group["tipo"],
        "opcoes": [
            {
                "id": option["id"],
                "nome": "Frango grelhado" if option["id"] == referenced["id"] else option["nome"],
                "preco_adicional": option["preco_adicional"],
                "ativo": option["ativo"],
            }
            for option in group["opcoes"]
        ],
        "produto_ids": group["produto_ids"],
        "categoria_ids": group["categoria_ids"],
        "incluir_subcategorias": group["incluir_subcategorias"],
    }
    changed = client.put(
        f"/cardapio/modificadores/grupos/{group['id']}",
        headers=headers,
        json=payload,
    )
    assert changed.status_code == 200, changed.text
    changed_group = changed.json()
    assert {option["id"] for option in changed_group["opcoes"]} == {
        option["id"] for option in group["opcoes"]
    }
    assert next(
        option for option in changed_group["opcoes"] if option["id"] == referenced["id"]
    )["nome"] == "Frango grelhado"

    removing_historical = {
        **payload,
        "opcoes": [
            option
            for option in payload["opcoes"]
            if option["id"] != referenced["id"]
        ],
    }
    refused = client.put(
        f"/cardapio/modificadores/grupos/{group['id']}",
        headers=headers,
        json=removing_historical,
    )
    assert refused.status_code == 200, refused.text
    assert referenced["id"] not in {option["id"] for option in refused.json()["opcoes"]}

    db = SessionLocal()
    tenant_token = current_restaurante_id.set(999)
    try:
        historical = db.query(ItemModificador).filter(
            ItemModificador.restaurante_id == 999,
            ItemModificador.opcao_modificador_id == referenced["id"],
        ).one()
        saved_option = db.query(OpcaoModificador).filter(
            OpcaoModificador.restaurante_id == 999,
            OpcaoModificador.id == referenced["id"],
        ).one()
        assert historical.opcao_modificador_id == referenced["id"]
        assert saved_option.nome == "Frango grelhado"
        assert saved_option.arquivada is True and saved_option.ativo is False
        assert saved_option.grupo_id == group["id"]
        from app.services.order_item_composition import load_item_modifiers
        restored = load_item_modifiers(db, 999, [historical.item_id])[historical.item_id]
        assert next(option for option in restored if option.id == referenced["id"]).grupo_id == group["id"]
    finally:
        current_restaurante_id.reset(tenant_token)
        db.close()


    # Removing the group also keeps all historical foreign keys and labels.
    assert client.delete(f"/cardapio/modificadores/grupos/{group['id']}", headers=headers).status_code == 204
    assert group['id'] not in {entry['id'] for entry in client.get('/cardapio/modificadores/grupos', headers=headers).json()}
    db = SessionLocal()
    token = current_restaurante_id.set(999)
    try:
        from app.services.order_item_composition import load_item_modifiers
        history = load_item_modifiers(db, 999, [item_id])[item_id]
        assert next(option for option in history if option.id == referenced['id']).grupo_nome == changed_group['nome']
        assert db.query(OpcaoModificador).filter_by(id=referenced['id'], restaurante_id=999).one().arquivada is True
    finally:
        current_restaurante_id.reset(token)
        db.close()



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


def test_paid_complements_follow_source_and_preserve_existing_ids_prices():
    headers = _auth_headers()
    def create(name, options):
        response = client.post('/cardapio/modificadores/grupos', headers=headers, json={'nome': name, 'opcoes': options})
        assert response.status_code == 201, response.text
        return response.json()
    source = create('Proteínas vinculadas', [{'nome': 'Frango', 'ativo': True}, {'nome': 'Ovo frito', 'ativo': False}])
    target = create('Extras vinculados', [{'nome': 'Frango adicional', 'preco_adicional': 7}, {'nome': 'Bacon independente', 'preco_adicional': 3}])
    original_id = target['opcoes'][0]['id']
    target.update(grupo_origem_id=source['id'], preco_novo_adicional=5, preco_novo_ovo=2)
    result = client.put(f"/cardapio/modificadores/grupos/{target['id']}", headers=headers, json=target)
    assert result.status_code == 200, result.text
    target = result.json()
    chicken = next(option for option in target['opcoes'] if option['nome'] == 'Frango adicional')
    egg = next(option for option in target['opcoes'] if option['nome'] == 'Ovo frito adicional')
    assert chicken['id'] == original_id and chicken['preco_adicional'] == 7
    assert chicken['opcao_origem_id'] == source['opcoes'][0]['id']
    assert egg['ativo'] is False and egg['preco_adicional'] == 2
    assert client.patch(f"/cardapio/modificadores/opcoes/{chicken['id']}/disponibilidade", headers=headers, json={'ativo': False}).status_code == 409
    assert client.patch(f"/cardapio/modificadores/opcoes/{source['opcoes'][0]['id']}/disponibilidade", headers=headers, json={'ativo': False}).status_code == 200
    source['opcoes'][0].update(nome='Frango acebolado', ativo=False)
    source['opcoes'][1]['ativo'] = True
    source['opcoes'].append({'nome': 'Carne nova', 'ativo': True})
    response = client.put(f"/cardapio/modificadores/grupos/{source['id']}", headers=headers, json=source)
    assert response.status_code == 200, response.text
    groups = client.get('/cardapio/modificadores/grupos', headers=headers).json()
    updated = next(group for group in groups if group['id'] == target['id'])
    by_name = {option['nome']: option for option in updated['opcoes']}
    assert by_name['Frango acebolado adicional']['id'] == original_id
    assert by_name['Frango acebolado adicional']['preco_adicional'] == 7
    assert by_name['Frango acebolado adicional']['ativo'] is False
    assert by_name['Ovo frito adicional']['id'] == egg['id'] and by_name['Ovo frito adicional']['ativo'] is True
    assert by_name['Carne nova adicional']['preco_adicional'] == 5
    assert by_name['Bacon independente']['preco_adicional'] == 3
    # Re-saving is idempotent and cannot unlink via an older client omitting new fields.
    legacy = {key: updated[key] for key in ('nome', 'tipo', 'min_selecoes', 'max_selecoes', 'opcoes', 'produto_ids')}
    response = client.put(f"/cardapio/modificadores/grupos/{target['id']}", headers=headers, json=legacy)
    assert response.status_code == 200, response.text
    assert response.json()['grupo_origem_id'] == source['id']
    assert {option['id'] for option in response.json()['opcoes']} == {option['id'] for option in updated['opcoes']}
    source = client.get('/cardapio/modificadores/grupos', headers=headers).json()
    source = next(group for group in source if group['id'] == target['grupo_origem_id'])
    source['opcoes'] = source['opcoes'][1:]
    assert client.put(f"/cardapio/modificadores/grupos/{source['id']}", headers=headers, json=source).status_code == 200
    db = SessionLocal()
    token = current_restaurante_id.set(999)
    try:
        archived = db.query(OpcaoModificador).filter_by(id=original_id, restaurante_id=999).one()
        assert archived.arquivada is True and archived.ativo is False
        assert archived.preco_adicional == 7 and archived.opcao_origem_id
        source_option = db.query(OpcaoModificador).filter_by(id=archived.opcao_origem_id, restaurante_id=999).one()
        assert source_option.arquivada is True
        stale_id = source_option.id
    finally:
        current_restaurante_id.reset(token)
        db.close()
    assert client.patch(f"/cardapio/modificadores/opcoes/{stale_id}/disponibilidade", headers=headers, json={"ativo": True}).status_code == 404
    stale_batch = {"opcoes": [{"id": stale_id, "ativo_anterior": False, "ativo": True}]}
    assert client.patch("/cardapio/modificadores/cardapio-diario", headers=headers, json=stale_batch).status_code == 404
    assert client.delete(f"/cardapio/modificadores/grupos/{source['id']}", headers=headers).status_code == 409
    public = client.get('/cardapio/modificadores/publico/999').json()
    public_target = next(group for group in public if group['id'] == target['id'])
    assert 'Frango acebolado adicional' not in {option['nome'] for option in public_target['opcoes']}


def test_paid_complement_sync_rejects_cycles_and_foreign_sources():
    headers = _auth_headers()
    created = client.post('/cardapio/modificadores/grupos', headers=headers, json={'nome': 'Origem segura', 'opcoes': [{'nome': 'Carne'}]}).json()
    for source_id in (created['id'], 'foreign-source'):
        payload = {**created, 'grupo_origem_id': source_id, 'preco_novo_adicional': 5, 'preco_novo_ovo': 2}
        assert client.put(f"/cardapio/modificadores/grupos/{created['id']}", headers=headers, json=payload).status_code == 422


def test_paid_links_reject_actual_other_tenant_and_ambiguous_existing_copies():
    headers = _auth_headers()
    db = SessionLocal()
    token = current_restaurante_id.set(997)
    try:
        db.add(Restaurante(id=997, nome='Other linked catalog', slug='other-linked-catalog'))
        db.flush()
        db.add(GrupoModificador(id='foreign-link-source', restaurante_id=997, nome='Proteínas', tipo='opcional'))
        db.commit()
    finally:
        db.close()
        current_restaurante_id.reset(token)
    source = client.post('/cardapio/modificadores/grupos', headers=headers, json={'nome': 'Source duplicate test', 'opcoes': [{'nome': 'Frango'}]}).json()
    target = client.post('/cardapio/modificadores/grupos', headers=headers, json={'nome': 'Target duplicate test', 'opcoes': [{'nome': 'Frango adicional', 'preco_adicional': 5}, {'nome': 'Frango adicional', 'preco_adicional': 9}]}).json()
    payload = {**target, 'grupo_origem_id': 'foreign-link-source', 'preco_novo_adicional': 5, 'preco_novo_ovo': 2}
    assert client.put(f"/cardapio/modificadores/grupos/{target['id']}", headers=headers, json=payload).status_code == 422
    payload['grupo_origem_id'] = source['id']
    assert client.put(f"/cardapio/modificadores/grupos/{target['id']}", headers=headers, json=payload).status_code == 409
    saved = next(group for group in client.get('/cardapio/modificadores/grupos', headers=headers).json() if group['id'] == target['id'])
    assert saved['grupo_origem_id'] is None
    assert {option['id'] for option in saved['opcoes']} == {option['id'] for option in target['opcoes']}
    assert sorted(option['preco_adicional'] for option in saved['opcoes']) == [5, 9]


def test_daily_menu_is_atomic_preserves_prices_and_syncs_linked_extras():
    headers = _auth_headers()
    source = client.post('/cardapio/modificadores/grupos', headers=headers, json={
        'nome': 'Diário proteínas', 'opcoes': [
            {'nome': 'Frango diário', 'preco_adicional': 0, 'ativo': True},
            {'nome': 'Peixe diário', 'preco_adicional': 2, 'ativo': False},
        ], 'produto_ids': ['prod-burger-1'],
    }).json()
    extra = client.post('/cardapio/modificadores/grupos', headers=headers, json={
        'nome': 'Diário extras', 'grupo_origem_id': source['id'],
        'preco_novo_adicional': 5, 'preco_novo_ovo': 2,
        'opcoes': [{'nome': 'Frango diário adicional', 'preco_adicional': 7}],
    }).json()
    chicken, fish = source['opcoes']
    original_extra = next(o for o in extra['opcoes'] if o['opcao_origem_id'] == chicken['id'])
    changes = [{'id': chicken['id'], 'ativo_anterior': True, 'ativo': False},
               {'id': fish['id'], 'ativo_anterior': False, 'ativo': True}]
    url = '/cardapio/modificadores/cardapio-diario'
    assert client.patch(url, json={'opcoes': changes}).status_code == 401
    response = client.patch(url, headers=headers, json={'opcoes': changes})
    assert response.status_code == 200, response.text
    assert response.json()['atualizadas'] == 2
    groups = client.get('/cardapio/modificadores/grupos', headers=headers).json()
    saved = next(g for g in groups if g['id'] == source['id'])
    saved_extra = next(g for g in groups if g['id'] == extra['id'])
    assert saved['produto_ids'] == ['prod-burger-1']
    assert [(o['id'], o['preco_adicional'], o['ativo']) for o in saved['opcoes']] == [(chicken['id'], 0, False), (fish['id'], 2, True)]
    linked = next(o for o in saved_extra['opcoes'] if o['opcao_origem_id'] == chicken['id'])
    assert (linked['id'], linked['preco_adicional'], linked['ativo']) == (original_extra['id'], 7, False)
    # A competing stale change must not partially pause the other option.
    stale = [{'id': fish['id'], 'ativo_anterior': True, 'ativo': False},
             {'id': chicken['id'], 'ativo_anterior': True, 'ativo': False}]
    assert client.patch(url, headers=headers, json={'opcoes': stale}).status_code == 409
    current = client.get('/cardapio/modificadores/grupos', headers=headers).json()
    assert next(o for g in current if g['id'] == source['id'] for o in g['opcoes'] if o['id'] == fish['id'])['ativo'] is True
    foreign = [{'id': fish['id'], 'ativo_anterior': True, 'ativo': False},
               {'id': 'missing-or-foreign-option', 'ativo_anterior': True, 'ativo': False}]
    assert client.patch(url, headers=headers, json={'opcoes': foreign}).status_code == 404
    assert client.patch(url, headers=headers, json={'opcoes': [{'id': linked['id'], 'ativo_anterior': False, 'ativo': True}]}).status_code == 409
    assert client.patch(url, headers=headers, json={'opcoes': [changes[0], changes[0]]}).status_code == 422
    assert client.patch(url, headers=headers, json={'opcoes': [{'id': chicken['id'], 'ativo_anterior': False, 'ativo': 'true'}]}).status_code == 422
    assert client.patch(url, headers=headers, json={'opcoes': [], 'preco': 0}).status_code == 422

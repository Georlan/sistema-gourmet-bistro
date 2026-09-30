from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import SessionLocal, current_restaurante_id
from app.models import Restaurante, Usuario, Categoria, Produto, GrupoModificador
from app.restaurant_profile_models import RestauranteOperationProfile
from app.routes.auth import create_access_token
from app.application.orders.validation_loader import ValidationDataLoader
from app.domain.orders.validation import OrderValidationService
from app.domain.orders.errors import ModifierSelectionLimitError, ModifierInactiveError

client = TestClient(app)
TENANT = 99650


@pytest.fixture
def catalog():
    global TENANT
    TENANT += 1
    db = SessionLocal()
    context = current_restaurante_id.set(TENANT)
    try:
        db.add(Restaurante(id=TENANT, nome='Marmitaria tamanhos', slug='marmitaria-tamanhos-test'))
        db.commit()
        db.add(Usuario(id='marmitaria-sizes-admin', restaurante_id=TENANT, nome='Dona', email='sizes@koma.test', cargo='admin', status='ativo'))
        db.add(Usuario(id='marmitaria-sizes-waiter', restaurante_id=TENANT, nome='Garçom', email='sizes-waiter@koma.test', cargo='garcom', status='ativo'))
        db.add(RestauranteOperationProfile(restaurante_id=TENANT, profile_key='marmitaria'))
        db.commit()
    finally:
        current_restaurante_id.reset(context)
        db.close()
    token = create_access_token(subject='marmitaria-sizes-admin', restaurante_id=TENANT, role='admin')
    headers = {'Authorization': f'Bearer {token}'}
    response = client.post('/cardapio/modificadores/grupos', headers=headers, json={
        'nome': 'Proteínas compartilhadas', 'tipo': 'opcional', 'min_selecoes': 0, 'max_selecoes': 3,
        'opcoes': [{'nome': name, 'preco_adicional': 0, 'ativo': True} for name in ['Frango', 'Carne', 'Peixe']],
    })
    assert response.status_code == 201, response.text
    yield headers, response.json()
    # O banco isolado é reconstruído no início de cada execução da suíte.
    db = SessionLocal()
    context = current_restaurante_id.set(TENANT)
    try:
        db.query(RestauranteOperationProfile).filter_by(restaurante_id=TENANT).delete()
        db.query(Usuario).filter(Usuario.id.in_(['marmitaria-sizes-admin', 'marmitaria-sizes-waiter'])).delete()
        db.commit()
    finally:
        current_restaurante_id.reset(context)
        db.close()


def create_size(headers, group, name, minimum):
    payload = {'nome': name, 'preco': 22.5, 'ativo': True, 'regras': [{'grupo_id': group['id'], 'minimo': minimum, 'maximo': minimum, 'modo_selecao': 'tipos'}]}
    response = client.post('/cardapio/marmitaria/tamanhos', headers=headers, json=payload)
    assert response.status_code == 201, response.text
    return response.json(), payload


def validate(product, options):
    db = SessionLocal()
    context = current_restaurante_id.set(TENANT)
    try:
        validation = ValidationDataLoader.build_validation_context(db, restaurante_id=TENANT, fulfillment='pickup', itens_solicitados=[{'produto_id': product['id'], 'quantidade': 1, 'modificador_ids': options}])
        return OrderValidationService.validate(validation)
    finally:
        current_restaurante_id.reset(context)
        db.close()


def test_shared_options_have_distinct_size_limits_and_backend_validation(catalog):
    headers, group = catalog
    medium, _ = create_size(headers, group, 'Marmita média', 1)
    large, payload = create_size(headers, group, 'Marmita grande', 2)
    options = [o['id'] for o in group['opcoes']]
    public = client.get(f'/api/cardapio-digital/public?restaurante_id={TENANT}').json()
    products = {p['id']: p for p in public['produtos']}
    for product, quantity in [(medium, 1), (large, 2)]:
        effective = products[product['id']]['grupos_modificadores'][0]
        assert effective['min_selecoes'] == effective['max_selecoes'] == quantity
        assert {o['id'] for o in effective['opcoes']} == set(options)
    validate(medium, options[:1])
    validate(large, options[:2])
    with pytest.raises(ModifierSelectionLimitError):
        validate(large, [options[0], options[0], options[1]])
    for product, chosen in [(medium, options[:2]), (large, []), (large, options[:1]), (large, options), (large, [options[0], options[0]])]:
        with pytest.raises(ModifierSelectionLimitError):
            validate(product, chosen)
    changed = client.put(f"/cardapio/marmitaria/tamanhos/{large['id']}", headers=headers, json={**payload, 'preco': 25})
    assert changed.status_code == 200
    assert changed.json()['id'] == large['id']
    assert changed.json()['categoria_id'] == large['categoria_id']
    assert client.patch(f'/cardapio/modificadores/opcoes/{options[0]}/disponibilidade', headers=headers, json={'ativo': False}).status_code == 200
    public = client.get(f'/api/cardapio-digital/public?restaurante_id={TENANT}').json()
    for product in public['produtos']:
        assert options[0] not in {o['id'] for o in product['grupos_modificadores'][0]['opcoes']}
    with pytest.raises(ModifierInactiveError):
        validate(medium, options[:1])
    assert client.patch(f'/cardapio/modificadores/opcoes/{options[0]}/disponibilidade', headers=headers, json={'ativo': True}).status_code == 200
    validate(large, options[:2])


def test_size_setup_requires_profile_auth_and_atomic_valid_data(catalog):
    headers, group = catalog
    payload = {'nome': 'Especial', 'preco': 20, 'ativo': False, 'regras': [{'grupo_id': group['id'], 'minimo': 1, 'maximo': 2}]}
    assert client.post('/cardapio/marmitaria/tamanhos', json=payload).status_code == 401
    waiter = create_access_token(subject='marmitaria-sizes-waiter', restaurante_id=TENANT, role='garcom')
    assert client.post('/cardapio/marmitaria/tamanhos', headers={'Authorization': f'Bearer {waiter}'}, json=payload).status_code == 403
    for invalid in [{'preco': -1}, {'preco': 'NaN'}, {'nome': '   '}, {'regras': []}, {'regras': [{'grupo_id': group['id'], 'minimo': 3, 'maximo': 1}]}]:
        assert client.post('/cardapio/marmitaria/tamanhos', headers=headers, json={**payload, **invalid}).status_code == 422
    assert client.post('/cardapio/marmitaria/tamanhos', headers=headers, json={**payload, 'regras': [{'grupo_id': 'foreign-group', 'minimo': 0, 'maximo': 1}]}).status_code == 422
    assert client.put('/cardapio/marmitaria/tamanhos/foreign-product', headers=headers, json=payload).status_code == 404
    before = len(client.get('/cardapio/marmitaria/tamanhos', headers=headers).json()['tamanhos'])
    size, _ = create_size(headers, group, 'Especial', 1)
    assert client.post('/cardapio/marmitaria/tamanhos', headers=headers, json=payload).status_code == 409
    assert len(client.get('/cardapio/marmitaria/tamanhos', headers=headers).json()['tamanhos']) == before + 1
    db = SessionLocal()
    context = current_restaurante_id.set(TENANT)
    try:
        db.query(RestauranteOperationProfile).filter_by(restaurante_id=TENANT).one().profile_key = 'pizzaria'
        db.commit()
    finally:
        current_restaurante_id.reset(context)
        db.close()
    assert client.get('/cardapio/marmitaria/tamanhos', headers=headers).json()['enabled'] is False
    assert client.put(f"/cardapio/marmitaria/tamanhos/{size['id']}", headers=headers, json=payload).status_code == 403


def test_group_edit_preserves_size_limits_and_cannot_silently_remove_them(catalog):
    headers, group = catalog
    # O teste anterior alterna o perfil; restaura explicitamente para esta configuração.
    db = SessionLocal()
    token = current_restaurante_id.set(TENANT)
    try:
        db.query(RestauranteOperationProfile).filter_by(restaurante_id=TENANT).one().profile_key = 'marmitaria'
        db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()
    size, payload = create_size(headers, group, 'Executiva', 2)
    groups = client.get('/cardapio/modificadores/grupos', headers=headers).json()
    saved = next(g for g in groups if g['id'] == group['id'])
    body = {key: saved[key] for key in ['nome', 'tipo', 'min_selecoes', 'max_selecoes', 'opcoes', 'produto_ids', 'categoria_ids', 'incluir_subcategorias']}
    body['opcoes'] = [{key: option[key] for key in ['id', 'nome', 'preco_adicional', 'ativo']} for option in body['opcoes']]
    changed = client.put(f"/cardapio/modificadores/grupos/{group['id']}", headers=headers, json=body)
    assert changed.status_code == 200, changed.text
    validate(size, [o['id'] for o in group['opcoes'][:2]])
    with pytest.raises(ModifierSelectionLimitError):
        validate(size, [group['opcoes'][0]['id']])
    assert client.put(f"/cardapio/modificadores/grupos/{group['id']}", headers=headers, json={**body, 'categoria_ids': []}).status_code == 422
    assert client.delete(f"/cardapio/modificadores/grupos/{group['id']}", headers=headers).status_code == 409
    # Pausas podem ser salvas, mas um tamanho ativo exige opções suficientes.
    for option in group['opcoes']:
        client.patch(f"/cardapio/modificadores/opcoes/{option['id']}/disponibilidade", headers=headers, json={'ativo': False})
    assert client.put(f"/cardapio/marmitaria/tamanhos/{size['id']}", headers=headers, json=payload).status_code == 409
    assert client.put(f"/cardapio/marmitaria/tamanhos/{size['id']}", headers=headers, json={**payload, 'ativo': False}).status_code == 200


def test_portions_allow_repeat_but_enforce_total_and_active_options(catalog):
    headers, group = catalog
    # Reativa as opções pausadas pelo teste de proteção do editor.
    for option in group['opcoes']:
        client.patch(f"/cardapio/modificadores/opcoes/{option['id']}/disponibilidade", headers=headers, json={'ativo': True})
    payload = {'nome': 'Grande por porções', 'preco': 25, 'ativo': True, 'regras': [{'grupo_id': group['id'], 'minimo': 2, 'maximo': 2, 'modo_selecao': 'porcoes'}]}
    response = client.post('/cardapio/marmitaria/tamanhos', headers=headers, json=payload)
    assert response.status_code == 201
    size = response.json()
    first, second, third = [o['id'] for o in group['opcoes']]
    validate(size, [first, first])
    validate(size, [first, second])
    for choices in [[], [first], [first, first, first], [first, second, third]]:
        with pytest.raises(ModifierSelectionLimitError):
            validate(size, choices)
    # Uma única proteína disponível ainda pode preencher duas porções da mesma.
    for option in [second, third]:
        client.patch(f'/cardapio/modificadores/opcoes/{option}/disponibilidade', headers=headers, json={'ativo': False})
    assert client.put(f"/cardapio/marmitaria/tamanhos/{size['id']}", headers=headers, json=payload).status_code == 200
    invalid = {**payload, 'regras': [{**payload['regras'][0], 'modo_selecao': 'tipos'}]}
    assert client.put(f"/cardapio/marmitaria/tamanhos/{size['id']}", headers=headers, json=invalid).status_code == 409


def test_foreign_group_cannot_be_linked_and_creates_no_partial_category(catalog):
    headers, _ = catalog
    db = SessionLocal()
    token = current_restaurante_id.set(99352)
    try:
        db.add(Restaurante(id=99352, nome='Outro restaurante', slug='marmitaria-foreign-size-test'))
        db.commit()
        db.add(GrupoModificador(id='marmitaria-foreign-group', restaurante_id=99352, nome='Grupo alheio', tipo='opcional', min_selecoes=0, max_selecoes=1))
        db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()
    response = client.post('/cardapio/marmitaria/tamanhos', headers=headers, json={'nome': 'Não deve existir', 'preco': 20, 'regras': [{'grupo_id': 'marmitaria-foreign-group', 'minimo': 0, 'maximo': 1}]})
    assert response.status_code == 422
    db = SessionLocal()
    token = current_restaurante_id.set(TENANT)
    try:
        assert not db.query(Categoria).filter_by(restaurante_id=TENANT, nome='Não deve existir').first()
        assert not db.query(Produto).filter_by(restaurante_id=TENANT, nome='Não deve existir').first()
    finally:
        current_restaurante_id.reset(token)
        db.close()

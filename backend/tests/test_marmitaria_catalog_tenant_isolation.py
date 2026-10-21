"""Two restaurants can use the same profile without sharing catalogue records."""
import uuid

from fastapi.testclient import TestClient

from app.database import SessionLocal, tenant_session_scope
from app.main import app
from app.models import Categoria, Produto, Restaurante, Usuario
from app.restaurant_profile_models import RestauranteOperationProfile
from app.routes.auth import create_access_token


def test_two_marmitarias_create_own_complements_and_reject_foreign_writes():
    client = TestClient(app)
    suffix = uuid.uuid4().hex
    restaurants = []
    db = SessionLocal()
    try:
        for index in range(2):
            restaurant = Restaurante(nome=f'Marmitaria isolada {index}', slug=f'marmitaria-{suffix}-{index}')
            db.add(restaurant)
            db.commit()
            tenant_id = restaurant.id
            user_id = f'user-{suffix}-{index}'
            product_id = f'marmita-{suffix}-{index}'
            category_id = f'category-{suffix}-{index}'
            with tenant_session_scope(db, tenant_id):
                db.add(RestauranteOperationProfile(restaurante_id=tenant_id, profile_key='marmitaria'))
                db.add(Usuario(id=user_id, restaurante_id=tenant_id, nome='Admin local', email=f'{user_id}@example.com', cargo='admin', status='ativo'))
                db.add(Categoria(id=category_id, restaurante_id=tenant_id, nome='Marmitas'))
                db.flush()
                db.add(Produto(id=product_id, restaurante_id=tenant_id, categoria_id=category_id, nome='Marmita P', preco=20, marmitaria_tamanho='P'))
                db.commit()
            restaurants.append((tenant_id, product_id, {'Authorization': f'Bearer {create_access_token(subject=user_id, restaurante_id=tenant_id, role="admin")}'}))
    finally:
        db.close()

    url = '/cardapio/modificadores/grupos'
    groups = []
    for _, product_id, headers in restaurants:
        response = client.post(url, headers=headers, json={
            'nome': 'Proteínas', 'tipo': 'obrigatorio', 'min_selecoes': 1, 'max_selecoes': 1,
            'opcoes': [{'nome': 'Frango', 'preco_adicional': 0, 'ativo': True}],
            'produto_ids': [product_id],
        })
        assert response.status_code == 201, response.text
        groups.append(response.json())
    assert groups[0]['id'] != groups[1]['id']

    for index, (_, own_product, headers) in enumerate(restaurants):
        own, foreign = groups[index], groups[1 - index]
        listed = client.get(url, headers=headers)
        assert listed.status_code == 200
        assert [group['id'] for group in listed.json()] == [own['id']]
        assert listed.json()[0]['produto_ids'] == [own_product]
        payload = {'nome': 'Alteração indevida', 'tipo': 'opcional', 'min_selecoes': 0, 'max_selecoes': 1}
        assert client.put(f"{url}/{foreign['id']}", headers=headers, json=payload).status_code == 404
        assert client.delete(f"{url}/{foreign['id']}", headers=headers).status_code == 404
        option_url = f"/cardapio/modificadores/opcoes/{foreign['opcoes'][0]['id']}/disponibilidade"
        assert client.patch(option_url, headers=headers, json={'ativo': False}).status_code == 404
        foreign_binding = {**payload, 'produto_ids': [restaurants[1 - index][1]]}
        rejected = client.post(url, headers=headers, json=foreign_binding)
        assert rejected.status_code == 422
        assert rejected.json()['detail'] == 'Um ou mais produtos não pertencem ao restaurante ativo.'

    for index, (_, _, headers) in enumerate(restaurants):
        preserved = client.get(url, headers=headers).json()
        assert len(preserved) == 1
        assert preserved[0]['nome'] == 'Proteínas'
        assert preserved[0]['opcoes'][0]['ativo'] is True
        assert preserved[0]['opcoes'][0]['preco_adicional'] == 0
        assert preserved[0]['id'] == groups[index]['id']

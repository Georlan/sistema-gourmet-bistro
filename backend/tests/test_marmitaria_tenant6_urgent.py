from decimal import Decimal
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import SessionLocal, current_restaurante_id
from app.models import (
    Restaurante,
    Usuario,
    Categoria,
    Produto,
    GrupoModificador,
    OpcaoModificador,
    Comanda,
    Item,
    ConfiguracaoRestaurante,
    CaixaTurno,
)
from app.restaurant_profile_models import RestauranteOperationProfile
from app.routes.auth import create_access_token
from app.application.orders.validation_loader import ValidationDataLoader
from app.domain.orders.validation import OrderValidationService
from app.domain.orders.pricing import OrderPricingService
from app.domain.orders.errors import ModifierSelectionLimitError

client = TestClient(app)
TENANT = 99680


@pytest.fixture
def marmitaria_tenant():
    global TENANT
    TENANT += 1
    db = SessionLocal()
    context = current_restaurante_id.set(TENANT)
    try:
        db.add(Restaurante(id=TENANT, nome='Quentinha Caseira Tenant 6 Test', slug=f'quentinha-caseira-{TENANT}'))
        db.add(ConfiguracaoRestaurante(restaurante_id=TENANT, delivery_ativo=True))
        db.commit()
        db.add(Usuario(id=f'admin-{TENANT}', restaurante_id=TENANT, nome='Admin Tenant', email=f'admin{TENANT}@koma.test', cargo='admin', status='ativo'))
        db.add(Usuario(id=f'waiter-{TENANT}', restaurante_id=TENANT, nome='Caixa Tenant', email=f'caixa{TENANT}@koma.test', cargo='garcom', status='ativo'))
        db.add(RestauranteOperationProfile(restaurante_id=TENANT, profile_key='marmitaria'))
        db.commit()
    finally:
        current_restaurante_id.reset(context)
        db.close()

    token = create_access_token(subject=f'admin-{TENANT}', restaurante_id=TENANT, role='admin')
    headers = {'Authorization': f'Bearer {token}'}

    # 1. Criar grupos de modificadores em Complementos
    # Proteínas: incluídas no preço (R$ 0,00)
    res_prot = client.post('/cardapio/modificadores/grupos', headers=headers, json={
        'nome': 'Proteínas', 'tipo': 'opcional', 'min_selecoes': 0, 'max_selecoes': 2,
        'opcoes': [
            {'nome': 'Frango Grelhado', 'preco_adicional': 0.0, 'ativo': True},
            {'nome': 'Carne Assada', 'preco_adicional': 0.0, 'ativo': True},
            {'nome': 'Ovo Cozido', 'preco_adicional': 0.0, 'ativo': True},
        ],
    })
    assert res_prot.status_code == 201, res_prot.text
    group_prot = res_prot.json()

    # Saladas: incluídas (R$ 0,00)
    res_sal = client.post('/cardapio/modificadores/grupos', headers=headers, json={
        'nome': 'Saladas', 'tipo': 'opcional', 'min_selecoes': 0, 'max_selecoes': 3,
        'opcoes': [
            {'nome': 'Alface', 'preco_adicional': 0.0, 'ativo': True},
            {'nome': 'Tomate', 'preco_adicional': 0.0, 'ativo': True},
            {'nome': 'Cenoura', 'preco_adicional': 0.0, 'ativo': True},
        ],
    })
    assert res_sal.status_code == 201, res_sal.text
    group_sal = res_sal.json()

    # Guarnições: livres (R$ 0,00)
    res_guar = client.post('/cardapio/modificadores/grupos', headers=headers, json={
        'nome': 'Guarnições', 'tipo': 'opcional', 'min_selecoes': 0, 'max_selecoes': 20,
        'opcoes': [
            {'nome': 'Arroz Branco', 'preco_adicional': 0.0, 'ativo': True},
            {'nome': 'Feijão Carioca', 'preco_adicional': 0.0, 'ativo': True},
            {'nome': 'Macarrão', 'preco_adicional': 0.0, 'ativo': True},
            {'nome': 'Farofa', 'preco_adicional': 0.0, 'ativo': True},
        ],
    })
    assert res_guar.status_code == 201, res_guar.text
    group_guar = res_guar.json()

    # Adicionais pagos: carnes (+R$ 5,00) e ovos (+R$ 2,00)
    res_add = client.post('/cardapio/modificadores/grupos', headers=headers, json={
        'nome': 'Adicionais pagos', 'tipo': 'opcional', 'min_selecoes': 0, 'max_selecoes': 20,
        'opcoes': [
            {'nome': 'Carne Adicional', 'preco_adicional': 5.0, 'ativo': True},
            {'nome': 'Ovo Adicional', 'preco_adicional': 2.0, 'ativo': True},
        ],
    })
    assert res_add.status_code == 201, res_add.text
    group_add = res_add.json()

    # 2. Criar Quentinha G com as regras completas
    res_size = client.post('/cardapio/marmitaria/tamanhos', headers=headers, json={
        'tamanho': 'G',
        'nome': 'Quentinha G',
        'preco': 10.0,
        'ativo': True,
        'regras': [
            {'grupo_id': group_prot['id'], 'minimo': 0, 'maximo': 2, 'modo_selecao': 'porcoes'},
            {'grupo_id': group_sal['id'], 'minimo': 0, 'maximo': 3, 'modo_selecao': 'tipos'},
            {'grupo_id': group_guar['id'], 'minimo': 0, 'maximo': 20, 'modo_selecao': 'porcoes'},
            {'grupo_id': group_add['id'], 'minimo': 0, 'maximo': 20, 'modo_selecao': 'porcoes'},
        ],
    })
    assert res_size.status_code == 201, res_size.text
    size_g = res_size.json()

    yield {
        'tenant_id': TENANT,
        'headers': headers,
        'product': size_g,
        'group_prot': group_prot,
        'group_sal': group_sal,
        'group_guar': group_guar,
        'group_add': group_add,
    }

    db = SessionLocal()
    context = current_restaurante_id.set(TENANT)
    try:
        db.query(Item).filter(Item.restaurante_id == TENANT).delete()
        db.query(Comanda).filter(Comanda.restaurante_id == TENANT).delete()
        db.query(CaixaTurno).filter(CaixaTurno.restaurante_id == TENANT).delete()
        db.query(RestauranteOperationProfile).filter_by(restaurante_id=TENANT).delete()
        db.query(Usuario).filter(Usuario.restaurante_id == TENANT).delete()
        db.commit()
    except Exception:
        db.rollback()
    finally:
        current_restaurante_id.reset(context)
        db.close()


def _validate(tenant_id, product_id, options):
    db = SessionLocal()
    context = current_restaurante_id.set(tenant_id)
    try:
        validation = ValidationDataLoader.build_validation_context(
            db,
            restaurante_id=tenant_id,
            fulfillment='pickup',
            itens_solicitados=[{'produto_id': product_id, 'quantidade': 1, 'modificador_ids': options}],
        )
        validated = OrderValidationService.validate(validation)
        return OrderPricingService.calculate_quote(validated.to_pricing_context())
    finally:
        current_restaurante_id.reset(context)
        db.close()


def test_marmitaria_tenant6_fluxo_completo_persistencia_minimo_zero(marmitaria_tenant):
    """Fluxo completo: salvar -> recarregar/reabrir -> API pública -> cardápio público."""
    data = marmitaria_tenant
    headers = data['headers']
    product = data['product']
    tenant_id = data['tenant_id']

    # 1. Recarregar da tela administrativa (/cardapio/marmitaria/tamanhos)
    res_list = client.get('/cardapio/marmitaria/tamanhos', headers=headers)
    assert res_list.status_code == 200
    tamanhos = res_list.json()['tamanhos']
    saved_g = next(t for t in tamanhos if t['id'] == product['id'])
    assert saved_g['preco'] == 10.0
    assert saved_g['ativo'] is True

    # Checar regras persistidas
    regras_by_group = {r['grupo_id']: r for r in saved_g['regras']}
    prot_rule = regras_by_group[data['group_prot']['id']]
    assert prot_rule['minimo'] == 0, "Mínimo 0 deve persistir em Proteínas"
    assert prot_rule['maximo'] == 2
    assert prot_rule['modo_selecao'] == 'porcoes'

    guar_rule = regras_by_group[data['group_guar']['id']]
    assert guar_rule['minimo'] == 0, "Mínimo 0 deve persistir em Guarnições"
    assert guar_rule['maximo'] == 20

    sal_rule = regras_by_group[data['group_sal']['id']]
    assert sal_rule['minimo'] == 0, "Mínimo 0 deve persistir em Saladas"
    assert sal_rule['maximo'] == 3

    add_rule = regras_by_group[data['group_add']['id']]
    assert add_rule['minimo'] == 0, "Mínimo 0 deve persistir em Adicionais pagos"
    assert add_rule['maximo'] == 20
    assert add_rule['modo_selecao'] == 'porcoes'

    # 2. API Pública do cardápio digital (/api/cardapio-digital/public)
    res_pub = client.get(f'/api/cardapio-digital/public?restaurante_id={tenant_id}')
    assert res_pub.status_code == 200
    pub_data = res_pub.json()
    pub_prod = next(p for p in pub_data['produtos'] if p['id'] == product['id'])
    pub_groups = {g['id']: g for g in pub_prod['grupos_modificadores']}

    # Nenhum grupo com min=0 deve ter tipo "obrigatorio"
    for g_id, g in pub_groups.items():
        assert g['min_selecoes'] == 0
        assert g['tipo'] == 'opcional', f"Grupo {g['nome']} com min=0 não deve ser obrigatório"

    # Preços adicionais corretos
    add_opts = {o['nome']: o['preco_adicional'] for o in pub_groups[data['group_add']['id']]['opcoes']}
    assert add_opts['Carne Adicional'] == 5.0
    assert add_opts['Ovo Adicional'] == 2.0

    prot_opts = {o['nome']: o['preco_adicional'] for o in pub_groups[data['group_prot']['id']]['opcoes']}
    assert prot_opts['Frango Grelhado'] == 0.0
    assert prot_opts['Carne Assada'] == 0.0
    assert prot_opts['Ovo Cozido'] == 0.0


def test_marmitaria_tenant6_cenarios_minimos_obrigatorios(marmitaria_tenant):
    """Cobre todos os 11 cenários mínimos antes do merge."""
    data = marmitaria_tenant
    tenant_id = data['tenant_id']
    prod_id = data['product']['id']

    prot_options = {o['nome']: o['id'] for o in data['group_prot']['opcoes']}
    add_options = {o['nome']: o['id'] for o in data['group_add']['opcoes']}
    frango = prot_options['Frango Grelhado']
    carne_inc = prot_options['Carne Assada']
    ovo_inc = prot_options['Ovo Cozido']

    carne_paga = add_options['Carne Adicional']
    ovo_pago = add_options['Ovo Adicional']

    # 1. Quentinha G com 0 proteína (válido, subtotal 10.00)
    ctx_0 = _validate(tenant_id, prod_id, [])
    assert ctx_0.subtotal == Decimal('10.00')
    assert ctx_0.items[0].unit_price == Decimal('10.00')

    # 2. Quentinha G com 1 proteína (válido, subtotal 10.00)
    ctx_1 = _validate(tenant_id, prod_id, [frango])
    assert ctx_1.subtotal == Decimal('10.00')
    assert ctx_1.items[0].unit_price == Decimal('10.00')

    # 3. Quentinha G com 2 proteínas diferentes (válido, subtotal 10.00)
    ctx_2_diff = _validate(tenant_id, prod_id, [frango, carne_inc])
    assert ctx_2_diff.subtotal == Decimal('10.00')
    assert ctx_2_diff.items[0].unit_price == Decimal('10.00')

    # 4. Quentinha G com 2 unidades da mesma proteína (válido, modo porcoes permite repetir, subtotal 10.00)
    ctx_2_same = _validate(tenant_id, prod_id, [ovo_inc, ovo_inc])
    assert ctx_2_same.subtotal == Decimal('10.00')
    assert ctx_2_same.items[0].unit_price == Decimal('10.00')

    # 5. Tentativa de ultrapassar 2 proteínas incluídas (bloqueado com ModifierSelectionLimitError)
    with pytest.raises(ModifierSelectionLimitError):
        _validate(tenant_id, prod_id, [frango, carne_inc, ovo_inc])

    with pytest.raises(ModifierSelectionLimitError):
        _validate(tenant_id, prod_id, [ovo_inc, ovo_inc, ovo_inc])

    # 6. Carne adicional +R$5 (subtotal 15.00)
    ctx_carne_5 = _validate(tenant_id, prod_id, [carne_paga])
    assert ctx_carne_5.subtotal == Decimal('15.00')
    assert ctx_carne_5.items[0].unit_price == Decimal('15.00')

    # 7. 2 carnes adicionais +R$10 (subtotal 20.00)
    ctx_carne_10 = _validate(tenant_id, prod_id, [carne_paga, carne_paga])
    assert ctx_carne_10.subtotal == Decimal('20.00')
    assert ctx_carne_10.items[0].unit_price == Decimal('20.00')

    # 8. Ovo adicional +R$2 (subtotal 12.00)
    ctx_ovo_2 = _validate(tenant_id, prod_id, [ovo_pago])
    assert ctx_ovo_2.subtotal == Decimal('12.00')
    assert ctx_ovo_2.items[0].unit_price == Decimal('12.00')

    # 9. 2 ovos adicionais +R$4 (subtotal 14.00)
    ctx_ovo_4 = _validate(tenant_id, prod_id, [ovo_pago, ovo_pago])
    assert ctx_ovo_4.subtotal == Decimal('14.00')
    assert ctx_ovo_4.items[0].unit_price == Decimal('14.00')

    # 10. Exemplo completo da especificação:
    # 2 ovos em Proteínas (incluídos) + 1 ovo em Adicionais (+R$2) + 1 carne em Adicionais (+R$5) = R$ 17.00
    # Valor exibido no cardápio = valor autoritativo calculado pelo backend
    ctx_full = _validate(tenant_id, prod_id, [ovo_inc, ovo_inc, ovo_pago, carne_paga])
    assert ctx_full.subtotal == Decimal('17.00')
    assert ctx_full.items[0].unit_price == Decimal('17.00')

    # 11. Pedido chega ao Caixa com todas as unidades e preços corretos
    headers = data['headers']
    open_res = client.post('/caixa/turno/abrir', json={'saldo_inicial': 100.0}, headers=headers)
    assert open_res.status_code == 201, open_res.text
    venda_res = client.post('/cardapio/modificadores/venda-direta', headers=headers, json={
        'tipo': 'Balcão',
        'identificador': 'Cliente Marmitaria 6',
        'itens': [
            {
                'produto_id': prod_id,
                'observacao': '2x Ovo Cozido, 1x Ovo Adicional, 1x Carne Adicional',
                'cliente_nome': 'Cliente Balcão',
                'modificador_ids': [ovo_inc, ovo_inc, ovo_pago, carne_paga],
            }
        ],
    })
    assert venda_res.status_code in (200, 201), venda_res.text
    comanda = venda_res.json()
    assert comanda['itens'][0]['preco_unit'] == 17.0

    db = SessionLocal()
    context = current_restaurante_id.set(tenant_id)
    try:
        itens = db.query(Item).filter_by(comanda_id=comanda['id'], restaurante_id=tenant_id).all()
        assert len(itens) == 1
        item = itens[0]
        assert float(item.preco_unit) == 17.0
        assert '2x Ovo Cozido' in item.observacao
        assert '1x Ovo Adicional' in item.observacao
        assert '1x Carne Adicional' in item.observacao
    finally:
        current_restaurante_id.reset(context)
        db.close()

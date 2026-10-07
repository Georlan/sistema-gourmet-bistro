"""Read budgets in isolated SQLite: no requests to hosted services."""
from contextlib import contextmanager
import json
import uuid
import pytest
from sqlalchemy import event
from app.database import engine, SessionLocal
from app.models import GrupoModificador, OpcaoModificador, ProdutoGrupoModificador
from app.security import _authenticated_user_from_token
from app.services.plan_entitlements import resolve_plan_entitlements
from tests.characterization.orders.fixtures import char_client, char_setup


@contextmanager
def reads():
    recorded = []
    def record(_conn, cursor, statement, _parameters, _context, _many):
        if statement.lstrip().upper().startswith('SELECT'):
            recorded.append((statement, [column[0] for column in cursor.description or ()]))
    event.listen(engine, 'after_cursor_execute', record)
    try:
        yield recorded
    finally:
        event.remove(engine, 'after_cursor_execute', record)


@pytest.fixture
def modifier_group(char_setup):
    rid = char_setup['restaurant_id']
    group_id = 'read-budget-' + uuid.uuid4().hex
    with SessionLocal(restaurante_id=rid) as db:
        db.add(GrupoModificador(id=group_id, restaurante_id=rid, nome='Escolhas', min_selecoes=1, max_selecoes=2))
        db.flush()
        db.add(OpcaoModificador(id=group_id + '-option', restaurante_id=rid, grupo_id=group_id, nome='Opção', preco_adicional=1, ativo=True))
        db.add(ProdutoGrupoModificador(restaurante_id=rid, produto_id='prod-char-simples', grupo_id=group_id, min_selecoes=1, max_selecoes=2))
        db.commit()
    try:
        yield group_id
    finally:
        with SessionLocal(restaurante_id=rid) as db:
            db.query(ProdutoGrupoModificador).filter_by(restaurante_id=rid, grupo_id=group_id).delete(synchronize_session=False)
            db.query(OpcaoModificador).filter_by(restaurante_id=rid, grupo_id=group_id).delete(synchronize_session=False)
            db.query(GrupoModificador).filter_by(restaurante_id=rid, id=group_id).delete(synchronize_session=False)
            db.commit()


def test_public_menu_has_no_duplicate_link_reads_or_private_configuration(char_client, char_setup, modifier_group):
    rid = char_setup['restaurant_id']
    with reads() as queries:
        response = char_client.get('/api/cardapio-digital/public', params={'restaurante_id': rid})
    assert response.status_code == 200, response.text
    print('READ_BUDGET_PUBLIC=' + json.dumps({'selects': len(queries), 'columns': sum(len(columns) for _, columns in queries)}))
    for table in ('produto_grupo_modificadores', 'categoria_grupo_modificadores', 'categoria_relacoes'):
        assert sum(f'FROM {table}' in sql for sql, _ in queries) == 1
    config_queries = [(sql, columns) for sql, columns in queries if 'FROM configuracoes_restaurante' in sql]
    assert len(config_queries) == 1
    assert 'webhook_secret' not in config_queries[0][0]
    assert 'whatsapp_recipient_phone' not in config_queries[0][0]
    assert 'JOIN restaurantes' not in config_queries[0][0]
    assert sum('FROM restaurante_operation_profiles' in sql for sql, _ in queries) == 1
    assert len(queries) <= 15
    assert sum('FROM restaurante_capabilities' in sql for sql, _ in queries) == 1
    product = next(p for p in response.json()['produtos'] if p['id'] == 'prod-char-simples')
    group = next(g for g in product['grupos_modificadores'] if g['id'] == modifier_group)
    assert (group['min_selecoes'], group['max_selecoes']) == (1, 2)
    assert group['opcoes'][0]['preco_adicional'] == 1


def test_full_entitlements_resolve_with_one_capability_read_and_one_scalar_plan(char_setup):
    with SessionLocal(restaurante_id=char_setup['restaurant_id']) as db:
        with reads() as queries:
            result = resolve_plan_entitlements(db, char_setup['restaurant_id'])
    print('READ_BUDGET_ENTITLEMENTS=' + json.dumps({'selects': len(queries), 'columns': sum(len(columns) for _, columns in queries)}))
    assert all(result.values())  # This fixture's premium plan grants all features.
    assert len(queries) == 2
    assert all(len(columns) <= 2 for _, columns in queries)


def test_order_validation_reads_each_modifier_relation_once(char_setup):
    from app.application.orders.validation_loader import ValidationDataLoader
    rid = char_setup['restaurant_id']
    with SessionLocal(restaurante_id=rid) as db:
        with reads() as queries:
            context = ValidationDataLoader.build_validation_context(
                db, restaurante_id=rid, fulfillment='pickup',
                itens_solicitados=[{'produto_id': 'prod-char-simples', 'quantidade': 1}],
            )
    print('READ_BUDGET_VALIDATION=' + json.dumps({'selects': len(queries), 'columns': sum(len(columns) for _, columns in queries)}))
    assert context.catalog_products['prod-char-simples'].is_active
    for table in ('produto_grupo_modificadores', 'categoria_grupo_modificadores', 'categoria_relacoes'):
        assert sum(f'FROM {table}' in sql for sql, _ in queries) == 1
    assert len(queries) == 5


def test_auth_checks_live_suspension_without_reading_restaurant_branding(char_setup):
    token = char_setup['headers']['Authorization'].removeprefix('Bearer ')
    with SessionLocal(restaurante_id=char_setup['restaurant_id']) as db:
        with reads() as queries:
            user = _authenticated_user_from_token(token, db)
    assert user.id == 'usr-char-admin'
    restaurant_queries = [(sql, columns) for sql, columns in queries if 'FROM restaurantes' in sql]
    print('READ_BUDGET_AUTH=' + json.dumps({'restaurant_columns': [len(columns) for _, columns in restaurant_queries]}))
    assert len(restaurant_queries) == 1
    assert len(restaurant_queries[0][1]) == 1
    assert 'saas_status' in restaurant_queries[0][0]


def test_suspension_still_takes_effect_on_the_next_authentication(char_setup):
    from fastapi import HTTPException
    from app.models import Restaurante
    rid = char_setup['restaurant_id']
    token = char_setup['headers']['Authorization'].removeprefix('Bearer ')
    with SessionLocal(restaurante_id=rid) as db:
        _authenticated_user_from_token(token, db)
        rest = db.get(Restaurante, rid)
        original = rest.saas_status
        try:
            rest.saas_status = 'suspended'
            db.commit()
            with pytest.raises(HTTPException) as exc:
                _authenticated_user_from_token(token, db)
            assert exc.value.status_code == 403
        finally:
            db.get(Restaurante, rid).saas_status = original
            db.commit()


def test_batch_capability_resolution_preserves_revocation_without_a_cache(char_setup):
    from app.smartpos_models import RestauranteCapability
    rid = char_setup['restaurant_id']
    with SessionLocal(restaurante_id=rid) as db:
        cap = db.query(RestauranteCapability).filter_by(restaurante_id=rid, capability='loyalty').first()
        created = cap is None
        original = cap.enabled if cap is not None else None
        if cap is None:
            cap = RestauranteCapability(restaurante_id=rid, capability='loyalty', enabled=True, source='manual')
            db.add(cap)
        try:
            cap.enabled = True
            db.commit()
            assert resolve_plan_entitlements(db, rid, entitlements=('loyalty',)) == {'loyalty': True}
            cap.enabled = False
            db.commit()
            assert resolve_plan_entitlements(db, rid, entitlements=('loyalty',)) == {'loyalty': False}
        finally:
            if created:
                db.delete(cap)
            else:
                cap.enabled = original
            db.commit()

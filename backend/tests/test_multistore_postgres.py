"""Real RLS/grants checks against the migrated disposable PostgreSQL used by CI."""
import os
import uuid
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError

URL = os.environ.get('KOMA_SECURITY_TEST_DATABASE_URL')
pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL not configured')

@pytest.fixture()
def pg():
    engine = create_engine(URL)
    with engine.connect() as conn:
        transaction = conn.begin()
        # All data and role-local changes are rolled back at the end of the test.
        for rid in (998515, 998516):
            conn.execute(text("INSERT INTO restaurantes(id,nome,plano,saas_status,billing_mode) VALUES (:rid,'Teste rede','pro','active','subscription')"), {'rid': rid})
            conn.execute(text("INSERT INTO usuarios(id,nome,cargo,status,restaurante_id,created_at) VALUES (:id,'Gestor','admin','ativo',:rid,now())"), {'id': f'rls-network-{rid}', 'rid': rid})
        network_id = str(uuid.uuid4())
        conn.execute(text("INSERT INTO restaurant_networks(id,restaurante_id,nome) VALUES (:id,998515,'Rede RLS')"), {'id': network_id})
        for rid in (998515, 998516):
            conn.execute(text('INSERT INTO restaurant_network_units(restaurante_id,network_id,network_owner_id) VALUES (:rid,:id,998515)'), {'rid': rid, 'id': network_id})
        conn.execute(text("INSERT INTO restaurant_network_access(id,restaurante_id,usuario_id,destino_restaurante_id,destino_usuario_id,network_id) VALUES (:id,998515,'rls-network-998515',998516,'rls-network-998516',:network)"), {'id': str(uuid.uuid4()), 'network': network_id})
        yield conn, network_id
        transaction.rollback()
    engine.dispose()


def scope(conn, role, rid):
    conn.execute(text(f'SET LOCAL ROLE {role}'))  # Role is a test constant, never user input.
    conn.execute(text("SELECT set_config('app.current_restaurante_id',:id,true)"), {'id': str(rid) if rid else ''})


@pytest.mark.parametrize('table', ['restaurant_networks', 'restaurant_network_units', 'restaurant_network_access'])
def test_network_tables_restrict_rows_to_the_active_tenant(pg, table):
    conn, _ = pg
    scope(conn, 'koma_app', 998515)
    rows = conn.execute(text(f'SELECT restaurante_id FROM {table}')).scalars().all()
    assert rows and set(rows) == {998515}
    scope(conn, 'koma_app', None)
    assert conn.execute(text(f'SELECT restaurante_id FROM {table}')).all() == []
    scope(conn, 'koma_app', 998516)
    assert all(row == 998516 for row in conn.execute(text(f'SELECT restaurante_id FROM {table}')).scalars())


def test_wrong_tenant_cannot_create_or_reassign_network_rows(pg):
    conn, network_id = pg
    scope(conn, 'koma_app', 998516)
    with conn.begin_nested():
        assert conn.execute(text('UPDATE restaurant_networks SET nome=:name WHERE id=:id'), {'name': 'Forged', 'id': network_id}).rowcount == 0
    savepoint = conn.begin_nested()
    with pytest.raises(DBAPIError):
        conn.execute(text('INSERT INTO restaurant_networks(id,restaurante_id,nome) VALUES (:id,998515,\'Forged\')'), {'id': str(uuid.uuid4())})
    savepoint.rollback()
    scope(conn, 'koma_app', 998515)
    savepoint = conn.begin_nested()
    with pytest.raises(DBAPIError):
        conn.execute(text('UPDATE restaurant_network_access SET restaurante_id=998516'))
    savepoint.rollback()


@pytest.mark.parametrize('role', ['anon', 'authenticated'])
@pytest.mark.parametrize('table', ['restaurant_networks', 'restaurant_network_units', 'restaurant_network_access'])
def test_browser_roles_have_no_direct_access_even_with_a_tenant_setting(pg, role, table):
    conn, _ = pg
    scope(conn, role, 998515)
    savepoint = conn.begin_nested()
    with pytest.raises(DBAPIError):
        conn.execute(text(f'SELECT * FROM {table}'))
    savepoint.rollback()

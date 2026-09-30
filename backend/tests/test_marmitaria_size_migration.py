import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text


def test_additive_migration_preserves_legacy_rows_and_can_rollback():
    path = Path(__file__).parents[1] / 'alembic/versions/y5c6d7e8f9a0_marmitaria_size_limits.py'
    spec = importlib.util.spec_from_file_location('marmitaria_size_migration', path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine('sqlite://')
    with engine.begin() as connection:
        connection.execute(text('CREATE TABLE categorias (id TEXT PRIMARY KEY, nome TEXT)'))
        connection.execute(text("INSERT INTO categorias VALUES ('legacy', 'Hambúrgueres')"))
        connection.execute(text('CREATE TABLE categoria_grupo_modificadores (id INTEGER PRIMARY KEY, categoria_id TEXT, grupo_id TEXT)'))
        connection.execute(text("INSERT INTO categoria_grupo_modificadores VALUES (1, 'legacy', 'cheese')"))
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        assert connection.execute(text('SELECT marmitaria_tamanho FROM categorias')).scalar() == 0
        assert connection.execute(text('SELECT min_selecoes,max_selecoes,modo_selecao FROM categoria_grupo_modificadores')).one() == (None, None, None)
        migration.downgrade()
        assert connection.execute(text('SELECT id,nome FROM categorias')).one() == ('legacy', 'Hambúrgueres')
        assert connection.execute(text('SELECT grupo_id FROM categoria_grupo_modificadores')).scalar() == 'cheese'

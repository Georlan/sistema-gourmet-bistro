import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text


def test_linked_complements_migration_is_opt_in_and_preserves_existing_catalog():
    path = Path(__file__).parents[1] / 'alembic/versions/z9f0a1b2c3d4_link_paid_complements.py'
    spec = importlib.util.spec_from_file_location('linked_complements_migration', path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    with create_engine('sqlite://').begin() as connection:
        connection.execute(text('CREATE TABLE grupo_modificadores (id VARCHAR PRIMARY KEY, restaurante_id INTEGER NOT NULL, nome VARCHAR)'))
        connection.execute(text('CREATE TABLE opcao_modificadores (id VARCHAR PRIMARY KEY, restaurante_id INTEGER NOT NULL, grupo_id VARCHAR NOT NULL, nome VARCHAR, preco_adicional NUMERIC(14,2), ativo BOOLEAN)'))
        connection.execute(text("INSERT INTO grupo_modificadores VALUES ('extras', 999, 'Adicionais pagos')"))
        connection.execute(text("INSERT INTO opcao_modificadores VALUES ('old-id', 999, 'extras', 'Ovo frito adicional', 2, 0)"))
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        row = connection.execute(text('SELECT id, preco_adicional, ativo, opcao_origem_id FROM opcao_modificadores')).one()
        assert tuple(row) == ('old-id', 2, 0, None)
        assert connection.execute(text('SELECT grupo_origem_id FROM grupo_modificadores')).scalar() is None
        migration.downgrade()
        assert tuple(connection.execute(text('SELECT id, preco_adicional, ativo FROM opcao_modificadores')).one()) == ('old-id', 2, 0)

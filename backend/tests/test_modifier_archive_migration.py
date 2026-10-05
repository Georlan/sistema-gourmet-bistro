"""Additive archive flag preserves rows and starts existing options unarchived."""
import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text


def test_modifier_archive_upgrade_and_downgrade_preserve_existing_rows():
    path = Path(__file__).parents[1] / 'alembic/versions/a3af4de4e221_archive_modifier_options_preserving_.py'
    spec = importlib.util.spec_from_file_location('modifier_archive_migration', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = create_engine('sqlite://')
    with engine.begin() as connection:
        connection.execute(text('CREATE TABLE opcao_modificadores (id TEXT PRIMARY KEY, ativo BOOLEAN NOT NULL)'))
        connection.execute(text("INSERT INTO opcao_modificadores VALUES ('legacy-active', true), ('legacy-paused', false)"))
        with Operations.context(MigrationContext.configure(connection)):
            module.upgrade()
        assert connection.execute(text('SELECT id, ativo, arquivada FROM opcao_modificadores ORDER BY id')).all() == [('legacy-active', 1, 0), ('legacy-paused', 0, 0)]
        with Operations.context(MigrationContext.configure(connection)):
            module.downgrade()
        assert 'arquivada' not in {column['name'] for column in inspect(connection).get_columns('opcao_modificadores')}
        assert connection.execute(text('SELECT count(*) FROM opcao_modificadores')).scalar() == 2
    engine.dispose()

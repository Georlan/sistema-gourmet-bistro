import importlib.util
import os
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text


def test_delivery_accepted_migration_preserves_orders_and_safe_rollback():
    path = Path(__file__).parents[1] / "alembic/versions/z6c7d8e9f0a1_delivery_accepted_stage.py"
    spec = importlib.util.spec_from_file_location("delivery_accepted_stage", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine(os.getenv("KOMA_STAGE_MIGRATION_DATABASE_URL", "sqlite://"))
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE comandas (id TEXT PRIMARY KEY, delivery_status TEXT, CONSTRAINT ck_comandas_delivery_status CHECK (delivery_status IS NULL OR delivery_status IN ('analise','pendente','producao','pronto','transito','finalizado','recusado')))"))
        connection.execute(text("CREATE TABLE lancamentos (id TEXT PRIMARY KEY, status TEXT)"))
        connection.execute(text("INSERT INTO comandas VALUES ('legacy', 'producao')"))
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        connection.execute(text("INSERT INTO comandas VALUES ('accepted', 'aceito')"))
        connection.execute(text("INSERT INTO lancamentos VALUES ('launch', 'aceito')"))
        assert connection.execute(text("SELECT delivery_status FROM comandas WHERE id = 'legacy'")).scalar() == "producao"
        migration.downgrade()
        assert connection.execute(text("SELECT delivery_status FROM comandas WHERE id = 'accepted'")).scalar() == "producao"
        assert connection.execute(text("SELECT status FROM lancamentos WHERE id = 'launch'")).scalar() == "producao"

import sys
import os
from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

# Add backend directory to sys.path to resolve app imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import Base
from app.config import settings
from app import models
from app import session_models  # noqa: F401
from app import financial_cash_constraints  # noqa: F401
from app.migration_runtime import (
    prepare_migration_connection,
    release_migration_lock,
)

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Metadata already includes the Stage 3C split between physical and digital
# closing constraints via financial_cash_constraints.
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = settings.MIGRATION_DATABASE_URL
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = settings.MIGRATION_DATABASE_URL

    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    try:
        with connectable.connect() as connection:
            lock_acquired = False
            try:
                lock_acquired = prepare_migration_connection(connection)
                context.configure(
                    connection=connection,
                    target_metadata=target_metadata,
                    render_as_batch=True,
                )

                with context.begin_transaction():
                    context.run_migrations()
            finally:
                release_migration_lock(
                    connection,
                    lock_acquired=lock_acquired,
                )
    finally:
        connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

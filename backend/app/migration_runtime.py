"""Proteções operacionais para migrações PostgreSQL em pre-deploy."""

from __future__ import annotations

import os

from sqlalchemy import text


MIGRATION_LOCK_NAME = "koma_alembic_migrations"
DEFAULT_LOCK_TIMEOUT_MS = 15_000
DEFAULT_STATEMENT_TIMEOUT_MS = 600_000


def _timeout_ms(name: str, default: int, *, minimum: int, maximum: int) -> int:
    raw_value = os.getenv(name, str(default)).strip()
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise RuntimeError(f"{name} deve ser um número inteiro em milissegundos.") from exc

    if not minimum <= value <= maximum:
        raise RuntimeError(
            f"{name} deve estar entre {minimum} e {maximum} milissegundos."
        )
    return value


def prepare_migration_connection(connection) -> bool:
    """Configura limites e adquire um lock exclusivo para o Alembic.

    O lock é de sessão e evita dois processos alterando o esquema ao mesmo
    tempo. ``lock_timeout`` limita esperas por tabelas bloqueadas e
    ``statement_timeout`` impede um pre-deploy de permanecer preso para sempre.
    Retorna ``False`` em bancos que não sejam PostgreSQL.
    """
    if connection.dialect.name != "postgresql":
        return False

    lock_timeout_ms = _timeout_ms(
        "MIGRATION_LOCK_TIMEOUT_MS",
        DEFAULT_LOCK_TIMEOUT_MS,
        minimum=1_000,
        maximum=300_000,
    )
    statement_timeout_ms = _timeout_ms(
        "MIGRATION_STATEMENT_TIMEOUT_MS",
        DEFAULT_STATEMENT_TIMEOUT_MS,
        minimum=30_000,
        maximum=3_600_000,
    )

    acquired = bool(
        connection.execute(
            text("SELECT pg_try_advisory_lock(hashtext(:lock_name))"),
            {"lock_name": MIGRATION_LOCK_NAME},
        ).scalar()
    )
    if not acquired:
        connection.rollback()
        raise RuntimeError(
            "Outra migração do Kôma já está em execução; tente o deploy novamente."
        )

    try:
        connection.execute(
            text("SELECT set_config('lock_timeout', :value, false)"),
            {"value": f"{lock_timeout_ms}ms"},
        )
        connection.execute(
            text("SELECT set_config('statement_timeout', :value, false)"),
            {"value": f"{statement_timeout_ms}ms"},
        )
        connection.commit()
    except Exception:
        release_migration_lock(connection, lock_acquired=True)
        raise

    return True


def release_migration_lock(connection, *, lock_acquired: bool) -> None:
    """Libera com segurança o lock de sessão adquirido no pre-deploy."""
    if not lock_acquired or connection.dialect.name != "postgresql":
        return

    try:
        connection.execute(
            text("SELECT pg_advisory_unlock(hashtext(:lock_name))"),
            {"lock_name": MIGRATION_LOCK_NAME},
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise

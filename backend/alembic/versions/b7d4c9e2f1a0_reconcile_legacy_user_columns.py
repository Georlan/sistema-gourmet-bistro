"""reconcile legacy user columns with the current ORM

Revision ID: b7d4c9e2f1a0
Revises: a6c2e9f4b8d1
Create Date: 2026-08-18

The original schema required ``usuarios.usuario`` and ``usuarios.role``.
The current ORM stores the same concepts in ``email``/``telefone`` and
``cargo`` and no longer writes the legacy columns. Existing databases may
still carry those legacy columns, so keeping them NOT NULL makes valid ORM
inserts fail.

This migration deliberately keeps the legacy columns for compatibility with
older SQL/functions while removing only the obsolete NOT NULL requirement.
It is conditional so databases where the legacy columns are already absent
are left untouched.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b7d4c9e2f1a0"
down_revision: Union[str, Sequence[str], None] = "a6c2e9f4b8d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(bind) -> set[str]:
    return {
        column["name"]
        for column in sa.inspect(bind).get_columns("usuarios")
    }


def upgrade() -> None:
    bind = op.get_bind()
    columns = _columns(bind)

    if "usuario" in columns:
        op.alter_column(
            "usuarios",
            "usuario",
            existing_type=sa.String(),
            nullable=True,
        )

    if "role" in columns:
        op.alter_column(
            "usuarios",
            "role",
            existing_type=sa.String(),
            nullable=True,
        )


def downgrade() -> None:
    bind = op.get_bind()
    columns = _columns(bind)

    # A volta ao contrato legado precisa ser reversível mesmo para usuários
    # criados pelo ORM atual, que não preenche usuario/role.
    if "usuario" in columns:
        email_expr = "email" if "email" in columns else "NULL"
        telefone_expr = "telefone" if "telefone" in columns else "NULL"
        bind.execute(sa.text(f"""
            UPDATE usuarios
            SET usuario = COALESCE(usuario, {email_expr}, {telefone_expr}, id)
            WHERE usuario IS NULL
        """))
        op.alter_column(
            "usuarios",
            "usuario",
            existing_type=sa.String(),
            nullable=False,
        )

    if "role" in columns:
        cargo_expr = "cargo" if "cargo" in columns else "NULL"
        bind.execute(sa.text(f"""
            UPDATE usuarios
            SET role = COALESCE(role, {cargo_expr}, 'garcom')
            WHERE role IS NULL
        """))
        op.alter_column(
            "usuarios",
            "role",
            existing_type=sa.String(),
            nullable=False,
        )

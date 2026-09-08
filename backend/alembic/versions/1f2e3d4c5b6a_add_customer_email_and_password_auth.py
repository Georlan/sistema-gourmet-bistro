"""add customer email and password auth

Revision ID: 1f2e3d4c5b6a
Revises: 0e1f2a3b4c5d
Create Date: 2026-09-08 01:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


# revision identifiers, used by Alembic.
revision: str = '1f2e3d4c5b6a'
down_revision: Union[str, Sequence[str], None] = '0e1f2a3b4c5d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    existing_cols = {col["name"] for col in inspector.get_columns("clientes")}

    with op.batch_alter_table("clientes") as batch_op:
        if "email" not in existing_cols:
            batch_op.add_column(sa.Column("email", sa.String(), nullable=True))
        if "senha_hash" not in existing_cols:
            batch_op.add_column(sa.Column("senha_hash", sa.String(), nullable=True))

    existing_indexes = {idx["name"] for idx in inspector.get_indexes("clientes")}
    if "ix_clientes_email" not in existing_indexes:
        op.create_index("ix_clientes_email", "clientes", ["email"], unique=False)

    existing_constraints = {
        uc["name"] for uc in inspector.get_unique_constraints("clientes")
    }
    if "uq_restaurante_cliente_email" not in existing_constraints:
        with op.batch_alter_table("clientes") as batch_op:
            batch_op.create_unique_constraint(
                "uq_restaurante_cliente_email",
                ["restaurante_id", "email"],
            )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)

    existing_constraints = {
        uc["name"] for uc in inspector.get_unique_constraints("clientes")
    }
    with op.batch_alter_table("clientes") as batch_op:
        if "uq_restaurante_cliente_email" in existing_constraints:
            batch_op.drop_constraint("uq_restaurante_cliente_email", type_="unique")

    existing_indexes = {idx["name"] for idx in inspector.get_indexes("clientes")}
    if "ix_clientes_email" in existing_indexes:
        op.drop_index("ix_clientes_email", table_name="clientes")

    with op.batch_alter_table("clientes") as batch_op:
        batch_op.drop_column("senha_hash")
        batch_op.drop_column("email")

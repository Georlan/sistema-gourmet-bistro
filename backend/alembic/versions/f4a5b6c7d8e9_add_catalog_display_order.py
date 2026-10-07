"""add ordem_exibicao to categorias and produtos

Revision ID: f4a5b6c7d8e9
Revises: e3f4a5b6c7d8
Create Date: 2026-10-07 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


revision = "f4a5b6c7d8e9"
down_revision = "e3f4a5b6c7d8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    if inspector.has_table("categorias"):
        columns = [c["name"] for c in inspector.get_columns("categorias")]
        if "ordem_exibicao" not in columns:
            with op.batch_alter_table("categorias") as batch_op:
                batch_op.add_column(sa.Column("ordem_exibicao", sa.Integer(), nullable=True))
    if inspector.has_table("produtos"):
        columns = [c["name"] for c in inspector.get_columns("produtos")]
        if "ordem_exibicao" not in columns:
            with op.batch_alter_table("produtos") as batch_op:
                batch_op.add_column(sa.Column("ordem_exibicao", sa.Integer(), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    if inspector.has_table("produtos"):
        columns = [c["name"] for c in inspector.get_columns("produtos")]
        if "ordem_exibicao" in columns:
            with op.batch_alter_table("produtos") as batch_op:
                batch_op.drop_column("ordem_exibicao")
    if inspector.has_table("categorias"):
        columns = [c["name"] for c in inspector.get_columns("categorias")]
        if "ordem_exibicao" in columns:
            with op.batch_alter_table("categorias") as batch_op:
                batch_op.drop_column("ordem_exibicao")

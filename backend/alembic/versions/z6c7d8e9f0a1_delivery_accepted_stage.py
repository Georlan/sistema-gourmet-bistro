"""Persist acceptance separately from preparation for delivery orders."""
from alembic import op

revision = "z6c7d8e9f0a1"
down_revision = "y5c6d7e8f9a0"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("comandas") as batch:
        batch.drop_constraint("ck_comandas_delivery_status", type_="check")
        batch.create_check_constraint(
            "ck_comandas_delivery_status",
            "delivery_status IS NULL OR delivery_status IN "
            "('analise', 'pendente', 'aceito', 'producao', 'pronto', 'transito', 'finalizado', 'recusado')",
        )


def downgrade():
    op.execute("UPDATE comandas SET delivery_status = 'producao' WHERE delivery_status = 'aceito'")
    op.execute("UPDATE lancamentos SET status = 'producao' WHERE status = 'aceito'")
    with op.batch_alter_table("comandas") as batch:
        batch.drop_constraint("ck_comandas_delivery_status", type_="check")
        batch.create_check_constraint(
            "ck_comandas_delivery_status",
            "delivery_status IS NULL OR delivery_status IN "
            "('analise', 'pendente', 'producao', 'pronto', 'transito', 'finalizado', 'recusado')",
        )

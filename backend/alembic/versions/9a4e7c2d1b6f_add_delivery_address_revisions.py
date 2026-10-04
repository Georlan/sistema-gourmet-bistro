"""add append-only delivery address revisions

Revision ID: 9a4e7c2d1b6f
Revises: 82c7a941d5ef
"""

from alembic import op
import sqlalchemy as sa


revision = "9a4e7c2d1b6f"
down_revision = "82c7a941d5ef"
branch_labels = None
depends_on = None


TABLE = "comanda_delivery_address_revisions"


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("comanda_id", sa.String(), nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("payload_encrypted", sa.Text(), nullable=False),
        sa.Column("operator_id", sa.String(), nullable=False),
        sa.Column("reason", sa.String(length=500), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["comanda_id"],
            ["comandas.id"],
            name="fk_delivery_address_revision_comanda",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["restaurante_id"],
            ["restaurantes.id"],
            name="fk_delivery_address_revision_restaurante",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_comanda_delivery_address_revisions_comanda_id",
        TABLE,
        ["comanda_id"],
        unique=False,
    )
    op.create_index(
        "ix_comanda_delivery_address_revisions_restaurante_id",
        TABLE,
        ["restaurante_id"],
        unique=False,
    )
    op.create_index(
        "ix_comanda_delivery_address_revisions_tenant_order_created",
        TABLE,
        ["restaurante_id", "comanda_id", "created_at"],
        unique=False,
    )

    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    tenant_expression = """
        NULLIF(
            (
                SELECT current_setting(
                    'app.current_restaurante_id',
                    true
                )
            ),
            ''
        )::integer
    """
    op.execute(f"ALTER TABLE public.{TABLE} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE public.{TABLE} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON public.{TABLE}
        AS PERMISSIVE
        FOR ALL
        TO koma_app
        USING (restaurante_id = {tenant_expression})
        WITH CHECK (restaurante_id = {tenant_expression})
        """
    )
    # Runtime only needs to append and read revisions. Keeping UPDATE/DELETE
    # revoked makes the audit trail fail closed even outside the ORM.
    op.execute(f"GRANT SELECT, INSERT ON TABLE public.{TABLE} TO koma_app")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(f"REVOKE SELECT, INSERT ON TABLE public.{TABLE} FROM koma_app")
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON public.{TABLE}")
        op.execute(f"ALTER TABLE public.{TABLE} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE public.{TABLE} DISABLE ROW LEVEL SECURITY")

    op.drop_index(
        "ix_comanda_delivery_address_revisions_tenant_order_created",
        table_name=TABLE,
    )
    op.drop_index(
        "ix_comanda_delivery_address_revisions_restaurante_id",
        table_name=TABLE,
    )
    op.drop_index(
        "ix_comanda_delivery_address_revisions_comanda_id",
        table_name=TABLE,
    )
    op.drop_table(TABLE)

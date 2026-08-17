"""add restaurant capabilities for SmartPOS stage 3

Revision ID: 9f6e4b2c1a30
Revises: 8d4c21f7a6b9
Create Date: 2026-08-17
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "9f6e4b2c1a30"
down_revision: Union[str, Sequence[str], None] = "8d4c21f7a6b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "restaurante_capabilities",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "restaurante_id",
            sa.Integer(),
            sa.ForeignKey("restaurantes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("capability", sa.String(length=64), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("source", sa.String(length=16), nullable=False, server_default="manual"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "restaurante_id",
            "capability",
            name="uq_restaurante_capability",
        ),
        sa.CheckConstraint(
            "source IN ('plano', 'addon', 'trial', 'beta', 'promo', 'manual')",
            name="ck_restaurante_capability_source",
        ),
    )
    op.create_index(
        "ix_restaurante_capabilities_restaurante_id",
        "restaurante_capabilities",
        ["restaurante_id"],
    )

    # Os restaurantes já existentes entram no beta para permitir validação da
    # interface durante o desenvolvimento. Novos restaurantes continuam
    # fail-closed até receberem entitlement explícito.
    bind = op.get_bind()
    restaurant_ids = [row[0] for row in bind.execute(sa.text("SELECT id FROM restaurantes"))]
    for restaurante_id in restaurant_ids:
        bind.execute(
            sa.text(
                "INSERT INTO restaurante_capabilities "
                "(restaurante_id, capability, enabled, source) "
                "VALUES (:rid, 'smartpos', :enabled, 'beta')"
            ),
            {"rid": restaurante_id, "enabled": True},
        )

    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE restaurante_capabilities ENABLE ROW LEVEL SECURITY")
        op.execute(
            """
            CREATE POLICY tenant_isolation ON restaurante_capabilities
            USING (
                restaurante_id = current_setting('app.current_restaurante_id', true)::int
            )
            WITH CHECK (
                restaurante_id = current_setting('app.current_restaurante_id', true)::int
            )
            """
        )
        op.execute(
            "GRANT SELECT, INSERT, UPDATE, DELETE ON restaurante_capabilities TO koma_app"
        )
        op.execute(
            "GRANT USAGE, SELECT ON SEQUENCE restaurante_capabilities_id_seq TO koma_app"
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP POLICY IF EXISTS tenant_isolation ON restaurante_capabilities")
    op.drop_index(
        "ix_restaurante_capabilities_restaurante_id",
        table_name="restaurante_capabilities",
    )
    op.drop_table("restaurante_capabilities")

"""add minimal encrypted application access logs

Revision ID: w3a4b5c6d7e8
Revises: v2f3a4b5c6d7
Create Date: 2026-09-29
"""

from alembic import op
import sqlalchemy as sa


revision = "w3a4b5c6d7e8"
down_revision = "v2f3a4b5c6d7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "application_access_logs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("ip_address", sa.Text(), nullable=False),
        sa.Column("accessed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_application_access_logs_accessed_at",
        "application_access_logs",
        ["accessed_at"],
        unique=False,
    )

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        # Tabela global: não carrega restaurante_id e portanto não entra no RLS
        # tenant. O runtime recebe INSERT + DELETE e pode ler somente a coluna de
        # tempo necessária ao filtro de retenção. O IP cifrado não recebe SELECT;
        # consulta legal exige credencial administrativa.
        op.execute(
            "GRANT INSERT, DELETE ON TABLE public.application_access_logs TO koma_app"
        )
        op.execute(
            "GRANT SELECT (accessed_at) ON TABLE public.application_access_logs TO koma_app"
        )


def downgrade() -> None:
    op.drop_index(
        "ix_application_access_logs_accessed_at",
        table_name="application_access_logs",
    )
    op.drop_table("application_access_logs")

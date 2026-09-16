"""repair missing WhatsApp notification table after schema drift

Revision ID: d3e4f5a6b7c8
Revises: c2d9f7a1b604
Create Date: 2026-09-16
"""

from alembic import op
import sqlalchemy as sa


revision = "d3e4f5a6b7c8"
down_revision = "c2d9f7a1b604"
branch_labels = None
depends_on = None


TABLE = "notificacoes_whatsapp"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table(TABLE):
        op.create_table(
            TABLE,
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("restaurante_id", sa.Integer(), nullable=True),
            sa.Column("comanda_id", sa.String(length=100), nullable=True),
            sa.Column("telefone", sa.String(length=20), nullable=True),
            sa.Column("tipo", sa.String(length=50), nullable=True, server_default="status_pedido"),
            sa.Column("status_envio", sa.String(length=20), nullable=True, server_default="pendente"),
            sa.Column("wamid", sa.String(length=255), nullable=True),
            sa.Column("recipient_id", sa.String(length=50), nullable=True),
            sa.Column("status", sa.String(length=50), nullable=True),
            sa.Column("error_code", sa.Integer(), nullable=True),
            sa.Column("error_title", sa.Text(), nullable=True),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("conteudo", sa.Text(), nullable=True),
            sa.Column("raw_payload", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(
                ["restaurante_id"],
                ["restaurantes.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
        )

    inspector = sa.inspect(bind)
    existing_indexes = {index["name"] for index in inspector.get_indexes(TABLE)}
    for name, columns in (
        ("ix_notificacoes_whatsapp_restaurante_id", ["restaurante_id"]),
        ("ix_notificacoes_whatsapp_comanda_id", ["comanda_id"]),
        ("ix_notificacoes_whatsapp_wamid", ["wamid"]),
    ):
        if name not in existing_indexes:
            op.create_index(name, TABLE, columns, unique=False)

    if bind.dialect.name == "postgresql":
        role_exists = bind.execute(
            sa.text("SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app')")
        ).scalar()
        if role_exists:
            op.execute(
                f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.{TABLE} TO koma_app"
            )
            op.execute(
                f"GRANT USAGE, SELECT ON SEQUENCE public.{TABLE}_id_seq TO koma_app"
            )


def downgrade() -> None:
    # Repair migrations deliberately avoid deleting a table that may predate this
    # revision. A downgrade must never turn a recovered production schema back
    # into the broken state that motivated this migration.
    pass

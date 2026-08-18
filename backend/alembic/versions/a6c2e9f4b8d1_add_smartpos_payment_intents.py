"""add SmartPOS payment intents

Revision ID: a6c2e9f4b8d1
Revises: 9f6e4b2c1a30
Create Date: 2026-08-17
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a6c2e9f4b8d1"
down_revision: Union[str, Sequence[str], None] = "9f6e4b2c1a30"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "smartpos_payment_intents",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("turno_id", sa.Integer(), nullable=False),
        sa.Column("mesa_id", sa.Integer(), nullable=False),
        sa.Column("operador_id", sa.String(), nullable=False),
        sa.Column("valor", sa.Numeric(14, 2), nullable=False),
        sa.Column("metodo", sa.String(length=24), nullable=False),
        sa.Column("escopo", sa.String(length=16), nullable=False, server_default="valor"),
        sa.Column("item_ids", sa.JSON(), nullable=True),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="criada"),
        sa.Column("origem", sa.String(length=24), nullable=False, server_default="smartpos"),
        sa.Column("criado_em", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("valor > 0", name="ck_smartpos_intent_valor_positive"),
        sa.CheckConstraint("metodo IN ('dinheiro', 'pix', 'cartao')", name="ck_smartpos_intent_metodo"),
        sa.CheckConstraint("escopo IN ('valor', 'itens')", name="ck_smartpos_intent_escopo"),
        sa.CheckConstraint("status IN ('criada', 'cancelada', 'expirada')", name="ck_smartpos_intent_status"),
        sa.ForeignKeyConstraint(["restaurante_id"], ["restaurantes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["turno_id"], ["caixa_turnos.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["operador_id"], ["usuarios.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["restaurante_id", "mesa_id"],
            ["mesas.restaurante_id", "mesas.id"],
            name="fk_smartpos_intent_mesa_tenant",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "restaurante_id",
            "idempotency_key",
            name="uq_smartpos_intent_tenant_idempotency",
        ),
    )
    op.create_index(
        "ix_smartpos_intent_tenant_status",
        "smartpos_payment_intents",
        ["restaurante_id", "status"],
    )
    op.create_index(
        "ix_smartpos_intent_tenant_mesa",
        "smartpos_payment_intents",
        ["restaurante_id", "mesa_id"],
    )

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE smartpos_payment_intents ENABLE ROW LEVEL SECURITY")
        op.execute(
            """
            CREATE POLICY tenant_isolation ON smartpos_payment_intents
            USING (
                restaurante_id = current_setting('app.current_restaurante_id', true)::int
            )
            WITH CHECK (
                restaurante_id = current_setting('app.current_restaurante_id', true)::int
            )
            """
        )
        op.execute(
            "GRANT SELECT, INSERT, UPDATE, DELETE ON smartpos_payment_intents TO koma_app"
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP POLICY IF EXISTS tenant_isolation ON smartpos_payment_intents")
    op.drop_index("ix_smartpos_intent_tenant_mesa", table_name="smartpos_payment_intents")
    op.drop_index("ix_smartpos_intent_tenant_status", table_name="smartpos_payment_intents")
    op.drop_table("smartpos_payment_intents")

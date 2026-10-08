"""Opt-in device notifications for authenticated restaurant operators."""
from alembic import op
import sqlalchemy as sa

revision = "c7d8e9f0a123"
down_revision = "ba8d7c6e5f41"
branch_labels = None
depends_on = None


def upgrade():
    postgres = op.get_bind().dialect.name == "postgresql"
    if postgres:
        op.execute("SET LOCAL lock_timeout = '2s'")
        op.execute("SET LOCAL statement_timeout = '30s'")
    op.create_table(
        "staff_push_subscriptions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("restaurante_id", sa.Integer(), sa.ForeignKey("restaurantes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("usuario_id", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["restaurante_id", "usuario_id"], ["usuarios.restaurante_id", "usuarios.id"], ondelete="CASCADE"),
        sa.Column("endpoint_hash", sa.String(64), nullable=False),
        sa.Column("endpoint_ciphertext", sa.Text(), nullable=False),
        sa.Column("p256dh_ciphertext", sa.Text(), nullable=False),
        sa.Column("auth_ciphertext", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_sent_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("restaurante_id", "endpoint_hash", name="uq_staff_push_tenant_endpoint"),
    )
    op.create_index("ix_staff_push_subscriptions_restaurante_id", "staff_push_subscriptions", ["restaurante_id"])
    if postgres:
        op.execute("ALTER TABLE public.staff_push_subscriptions ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE public.staff_push_subscriptions FORCE ROW LEVEL SECURITY")
        op.execute("REVOKE ALL ON public.staff_push_subscriptions FROM PUBLIC")
        op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_push_subscriptions TO koma_app")
        tenant = "restaurante_id = NULLIF(current_setting('app.current_restaurante_id', true), '')::integer"
        op.execute(f"CREATE POLICY tenant_isolation ON public.staff_push_subscriptions FOR ALL TO koma_app USING ({tenant}) WITH CHECK ({tenant})")


def downgrade():
    op.drop_table("staff_push_subscriptions")

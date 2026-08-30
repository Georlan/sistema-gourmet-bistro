"""add integration outbox and external references

Revision ID: f6a1b2c3d4e5
Revises: e2f3a4b5c6d7
Create Date: 2026-08-30 11:41:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f6a1b2c3d4e5'
down_revision = 'e2f3a4b5c6d7'
branch_labels = None
depends_on = None


def upgrade():
    # 1. Tabela integration_outbox
    op.create_table(
        'integration_outbox',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('restaurante_id', sa.Integer(), nullable=False),
        sa.Column('event_id', sa.String(length=64), nullable=False),
        sa.Column('event_name', sa.String(length=64), nullable=False),
        sa.Column('aggregate_type', sa.String(length=32), nullable=False, server_default='order'),
        sa.Column('aggregate_id', sa.String(length=64), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='pending'),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('max_attempts', sa.Integer(), nullable=False, server_default='5'),
        sa.Column('next_retry_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('processed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('response_status_code', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['restaurante_id'], ['restaurantes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('restaurante_id', 'event_id', name='uq_integration_outbox_tenant_event')
    )
    op.create_index(
        'ix_integration_outbox_dispatch_queue',
        'integration_outbox',
        ['restaurante_id', 'status', 'next_retry_at', 'created_at'],
        unique=False
    )
    op.create_index(
        'ix_integration_outbox_event_id',
        'integration_outbox',
        ['event_id'],
        unique=False
    )
    op.create_index(
        'ix_integration_outbox_status',
        'integration_outbox',
        ['status'],
        unique=False
    )

    # 2. Tabela external_order_references
    op.create_table(
        'external_order_references',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('restaurante_id', sa.Integer(), nullable=False),
        sa.Column('provider', sa.String(length=32), nullable=False),
        sa.Column('external_order_id', sa.String(length=128), nullable=False),
        sa.Column('internal_order_id', sa.String(length=64), nullable=False),
        sa.Column('raw_payload', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['restaurante_id'], ['restaurantes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('restaurante_id', 'provider', 'external_order_id', name='uq_external_order_ref_provider_order')
    )
    op.create_index(
        'ix_external_order_ref_internal_lookup',
        'external_order_references',
        ['restaurante_id', 'internal_order_id'],
        unique=False
    )

    # 3. Colunas de webhook em configuracoes_restaurante
    with op.batch_alter_table('configuracoes_restaurante', schema=None) as batch_op:
        batch_op.add_column(sa.Column('webhook_url', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('webhook_secret', sa.String(length=128), nullable=True))
        batch_op.add_column(sa.Column('webhook_ativo', sa.Boolean(), nullable=False, server_default=sa.text('false')))

    # 4. RLS e Grants para PostgreSQL (koma_app)
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
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
        for table in ["integration_outbox", "external_order_references"]:
            op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")
            op.execute(f"ALTER TABLE public.{table} FORCE ROW LEVEL SECURITY")
            op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON public.{table}")
            op.execute(
                f"""
                CREATE POLICY tenant_isolation ON public.{table}
                AS PERMISSIVE
                FOR ALL
                TO koma_app
                USING (restaurante_id = {tenant_expression})
                WITH CHECK (restaurante_id = {tenant_expression})
                """
            )
            op.execute(
                f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.{table} TO koma_app"
            )


def downgrade():
    with op.batch_alter_table('configuracoes_restaurante', schema=None) as batch_op:
        batch_op.drop_column('webhook_ativo')
        batch_op.drop_column('webhook_secret')
        batch_op.drop_column('webhook_url')

    op.drop_index('ix_external_order_ref_internal_lookup', table_name='external_order_references')
    op.drop_table('external_order_references')

    op.drop_index('ix_integration_outbox_status', table_name='integration_outbox')
    op.drop_index('ix_integration_outbox_event_id', table_name='integration_outbox')
    op.drop_index('ix_integration_outbox_dispatch_queue', table_name='integration_outbox')
    op.drop_table('integration_outbox')

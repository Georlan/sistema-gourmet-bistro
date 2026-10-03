"""Direct Pix: opt-in configuration, manual receipt audit, fee invoices.

Revision ID: d1e2f3a4b5c6
Revises: z9f0a1b2c3d4
"""
from alembic import op
import sqlalchemy as sa

revision = 'd1e2f3a4b5c6'
down_revision = 'z9f0a1b2c3d4'
branch_labels = None
depends_on = None

TABLES = ('restaurant_direct_pix_configs', 'direct_pix_fee_invoices', 'direct_pix_receipts')


def upgrade():
    bind = op.get_bind()
    postgres = bind.dialect.name == 'postgresql'
    if postgres:
        # DDL requires a brief metadata lock, but must never queue indefinitely behind production traffic.
        op.execute("SET LOCAL lock_timeout = '2s'")
        op.execute("SET LOCAL statement_timeout = '30s'")
        op.add_column('online_payment_intents', sa.Column('fee_settlement', sa.String(16), nullable=True))
        op.drop_constraint('ck_online_payment_intents_provider', 'online_payment_intents', type_='check')
        op.execute("ALTER TABLE online_payment_intents ADD CONSTRAINT ck_online_payment_intents_provider CHECK (provider IN ('mercado_pago','direct_pix')) NOT VALID")
    else:
        with op.batch_alter_table('online_payment_intents') as batch:
            batch.add_column(sa.Column('fee_settlement', sa.String(16), nullable=True))
            batch.drop_constraint('ck_online_payment_intents_provider', type_='check')
            batch.create_check_constraint('ck_online_payment_intents_provider', "provider IN ('mercado_pago','direct_pix')")
    op.create_table('restaurant_direct_pix_configs',
        sa.Column('restaurante_id',sa.Integer(),sa.ForeignKey('restaurantes.id',ondelete='CASCADE'),primary_key=True),
        sa.Column('enabled',sa.Boolean(),nullable=False),
        sa.Column('key_type',sa.String(16),nullable=False),
        sa.Column('pix_key',sa.Text(),nullable=False),
        sa.Column('holder_name',sa.String(25),nullable=False),
        sa.Column('city',sa.String(15),nullable=False),
        sa.Column('accepted_by',sa.String(),nullable=False),
        sa.Column('accepted_at',sa.DateTime(timezone=True),nullable=False),
        sa.Column('terms_version',sa.String(32),nullable=False),
        sa.CheckConstraint("key_type IN ('cpf','cnpj','phone','email','random')",name='ck_direct_pix_key_type'))
    op.create_table('direct_pix_fee_invoices',
        sa.Column('id',sa.String(36),primary_key=True),
        sa.Column('restaurante_id',sa.Integer(),sa.ForeignKey('restaurantes.id'),nullable=False),
        sa.Column('period',sa.String(7),nullable=False),
        sa.Column('provider_payment_id',sa.String(128),nullable=True),
        sa.Column('payment_payload',sa.JSON(),nullable=True),
        sa.Column('payment_attempt',sa.Integer(),nullable=False,server_default='0'),
        sa.Column('previous_payment_ids',sa.JSON(),nullable=True),
        sa.Column('paid_at',sa.DateTime(timezone=True),nullable=True),
        sa.Column('subscription_due_at',sa.DateTime(timezone=True),nullable=True),
        sa.Column('fees',sa.Numeric(14,2),nullable=False),
        sa.Column('subscription_amount',sa.Numeric(14,2),nullable=False),
        sa.Column('status',sa.String(16),nullable=False),
        sa.Column('created_at',sa.DateTime(timezone=True),nullable=False),
        sa.UniqueConstraint('restaurante_id','period',name='uq_direct_pix_invoice_period'))
    op.create_table('direct_pix_receipts',
        sa.Column('intent_id',sa.String(36),sa.ForeignKey('online_payment_intents.id'),primary_key=True),
        sa.Column('restaurante_id',sa.Integer(),sa.ForeignKey('restaurantes.id'),nullable=False),
        sa.Column('bank_reference',sa.String(32),nullable=False),
        sa.Column('confirmed_by',sa.String(),nullable=False),
        sa.Column('confirmed_at',sa.DateTime(timezone=True),nullable=False),
        sa.Column('fee',sa.Numeric(14,2),nullable=False),
        sa.Column('invoice_id',sa.String(36),sa.ForeignKey('direct_pix_fee_invoices.id'),nullable=True),
        sa.UniqueConstraint('restaurante_id','bank_reference',name='uq_direct_pix_receipt_reference'))
    op.create_index('ix_direct_pix_receipts_tenant_date','direct_pix_receipts',['restaurante_id','confirmed_at'])
    if postgres:
        tenant = "NULLIF((SELECT current_setting('app.current_restaurante_id', true)), '')::integer"
        for table in TABLES:
            op.execute(f'ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY')
            op.execute(f'ALTER TABLE public.{table} FORCE ROW LEVEL SECURITY')
            op.execute(f'CREATE POLICY tenant_isolation ON public.{table} FOR ALL TO koma_app USING (restaurante_id = {tenant}) WITH CHECK (restaurante_id = {tenant})')
            op.execute(f'GRANT SELECT, INSERT, UPDATE, DELETE ON public.{table} TO koma_app')


def downgrade():
    bind = op.get_bind()
    count = bind.execute(sa.text("SELECT count(*) FROM online_payment_intents WHERE provider = 'direct_pix'")).scalar()
    if count:
        raise RuntimeError('Downgrade recusado: preserve intenções e evidência financeira Pix direto.')
    for table in reversed(TABLES):
        op.drop_table(table)
    with op.batch_alter_table('online_payment_intents') as batch:
        batch.drop_constraint('ck_online_payment_intents_provider',type_='check')
        batch.create_check_constraint('ck_online_payment_intents_provider',"provider IN ('mercado_pago')")
        batch.drop_column('fee_settlement')

"""Allow PagBank in the existing payment ledger; preserve historic providers."""
from alembic import op
import sqlalchemy as sa

revision = '6a7b8c9d0e12'
down_revision = '5f6a7b8c9d01'
branch_labels = None
depends_on = None

TABLES = {
    'restaurant_payment_accounts': ('ck_payment_accounts_provider', "'mercado_pago'"),
    'online_payment_intents': ('ck_online_payment_intents_provider', "'mercado_pago', 'direct_pix'"),
    'online_payment_webhook_events': ('ck_online_payment_webhook_events_provider', "'mercado_pago'"),
}


def _change(add):
    postgres = op.get_bind().dialect.name == 'postgresql'
    if postgres:
        op.execute("SET LOCAL lock_timeout = '2s'")
        op.execute("SET LOCAL statement_timeout = '30s'")
    for table, (name, providers) in TABLES.items():
        allowed = providers + (", 'pagbank'" if add else '')
        if postgres:
            op.drop_constraint(name, table, type_='check')
            op.create_check_constraint(name, table, f'provider IN ({allowed})')
        else:
            with op.batch_alter_table(table) as batch:
                batch.drop_constraint(name, type_='check')
                batch.create_check_constraint(name, f'provider IN ({allowed})')


def upgrade():
    op.add_column('restaurant_payment_accounts', sa.Column('provider_environment', sa.String(16), nullable=True))
    _change(True)


def downgrade():
    for table in TABLES:
        if op.get_bind().execute(sa.text(f"SELECT count(*) FROM {table} WHERE provider = 'pagbank'")).scalar():
            raise RuntimeError('Preserve PagBank payment history before downgrading.')
    _change(False)
    op.drop_column('restaurant_payment_accounts', 'provider_environment')

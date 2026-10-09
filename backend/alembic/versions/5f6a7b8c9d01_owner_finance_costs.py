"""Private owner costs and append-only evidence, separate from tenant accounts."""
from alembic import op
import sqlalchemy as sa

revision = '5f6a7b8c9d01'
down_revision = 'c7d8e9f0a123'
branch_labels = None
depends_on = None


def upgrade():
    pg = op.get_bind().dialect.name == 'postgresql'
    schema = 'koma_internal' if pg else None
    if pg:
        op.execute('CREATE SCHEMA IF NOT EXISTS koma_internal')
    op.create_table('super_admin_finance_months',
        sa.Column('period', sa.String(7), primary_key=True),
        sa.Column('costs', sa.JSON(), nullable=False),
        sa.Column('actor', sa.String(254), nullable=False),
        sa.Column('reason', sa.String(1000), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False), schema=schema)
    op.create_table('super_admin_finance_audit',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('period', sa.String(7), nullable=False),
        sa.Column('before_data', sa.JSON(), nullable=True),
        sa.Column('after_data', sa.JSON(), nullable=False),
        sa.Column('actor', sa.String(254), nullable=False),
        sa.Column('reason', sa.String(1000), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False), schema=schema)
    op.create_index('ix_super_admin_finance_audit_period', 'super_admin_finance_audit', ['period'], schema=schema)
    if pg:
        for table in ('super_admin_finance_months', 'super_admin_finance_audit'):
            full = f'koma_internal.{table}'
            op.execute(f'ALTER TABLE {full} ENABLE ROW LEVEL SECURITY')
            op.execute(f'ALTER TABLE {full} FORCE ROW LEVEL SECURITY')
            op.execute(f'REVOKE ALL ON TABLE {full} FROM PUBLIC')
            op.execute(f"""DO $$ BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE {full} FROM anon; END IF;
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE {full} FROM authenticated; END IF;
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='koma_app') THEN
                    GRANT USAGE ON SCHEMA koma_internal TO koma_app;
                    GRANT SELECT, INSERT ON TABLE {full} TO koma_app;
                    CREATE POLICY owner_finance_backend ON {full} FOR ALL TO koma_app USING (true) WITH CHECK (true);
                END IF;
            END $$""")
        op.execute("DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='koma_app') THEN GRANT UPDATE ON TABLE koma_internal.super_admin_finance_months TO koma_app; END IF; END $$")


def downgrade():
    schema = 'koma_internal' if op.get_bind().dialect.name == 'postgresql' else None
    op.drop_table('super_admin_finance_audit', schema=schema)
    op.drop_table('super_admin_finance_months', schema=schema)

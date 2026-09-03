"""add saas_status and super_admin_audit_logs

Revision ID: 2b3c4d5e6f7a
Revises: 1c2d3e4f5a6b
Create Date: 2026-09-03 06:40:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '2b3c4d5e6f7a'
down_revision = '1c2d3e4f5a6b'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Adicionar coluna saas_status à tabela restaurantes
    op.add_column(
        'restaurantes',
        sa.Column(
            'saas_status',
            sa.String(length=20),
            server_default='active',
            nullable=False,
        )
    )

    # Adicionar CheckConstraint para saas_status ('active', 'suspended')
    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        op.create_check_constraint(
            'ck_restaurantes_saas_status',
            'restaurantes',
            "saas_status IN ('active', 'suspended')"
        )

    # 2. Criar tabela super_admin_audit_logs
    op.create_table(
        'super_admin_audit_logs',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column('restaurante_id', sa.Integer(), nullable=False),
        sa.Column('actor', sa.String(length=255), nullable=False),
        sa.Column('action', sa.String(length=64), nullable=False),
        sa.Column('reason', sa.Text(), nullable=False),
        sa.Column('before_data', postgresql.JSON(astext_type=sa.Text()) if bind.dialect.name == 'postgresql' else sa.JSON(), nullable=True),
        sa.Column('after_data', postgresql.JSON(astext_type=sa.Text()) if bind.dialect.name == 'postgresql' else sa.JSON(), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()') if bind.dialect.name == 'postgresql' else sa.text('CURRENT_TIMESTAMP'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ['restaurante_id'],
            ['restaurantes.id'],
            name='fk_super_admin_audit_logs_restaurante_id',
            ondelete='CASCADE',
        ),
    )

    op.create_index(
        'ix_super_admin_audit_logs_restaurante_id',
        'super_admin_audit_logs',
        ['restaurante_id'],
        unique=False,
    )

    if bind.dialect.name == 'postgresql':
        op.create_index(
            'ix_super_admin_audit_logs_created_at',
            'super_admin_audit_logs',
            ['created_at'],
            unique=False,
        )

        # 3. Aplicar Row Level Security e isolamento à tabela de auditoria
        op.execute("ALTER TABLE super_admin_audit_logs ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE super_admin_audit_logs FORCE ROW LEVEL SECURITY")
        op.execute("""
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                    GRANT SELECT, INSERT ON super_admin_audit_logs TO koma_app;
                    REVOKE UPDATE, DELETE, TRUNCATE ON super_admin_audit_logs FROM koma_app;
                END IF;
            END
            $$;
        """)
        op.execute("""
            CREATE POLICY super_admin_audit_logs_tenant_isolation ON super_admin_audit_logs
            AS RESTRICTIVE
            FOR ALL
            TO koma_app
            USING (
                restaurante_id = NULLIF(current_setting('koma.current_restaurante_id', true), '')::integer
                OR NULLIF(current_setting('koma.current_restaurante_id', true), '')::integer = 0
            )
            WITH CHECK (
                restaurante_id = NULLIF(current_setting('koma.current_restaurante_id', true), '')::integer
                OR NULLIF(current_setting('koma.current_restaurante_id', true), '')::integer = 0
            );
        """)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        op.execute("DROP POLICY IF EXISTS super_admin_audit_logs_tenant_isolation ON super_admin_audit_logs")
        op.drop_index('ix_super_admin_audit_logs_created_at', table_name='super_admin_audit_logs')

    op.drop_index('ix_super_admin_audit_logs_restaurante_id', table_name='super_admin_audit_logs')
    op.drop_table('super_admin_audit_logs')

    if bind.dialect.name == 'postgresql':
        op.drop_constraint('ck_restaurantes_saas_status', 'restaurantes', type_='check')

    op.drop_column('restaurantes', 'saas_status')

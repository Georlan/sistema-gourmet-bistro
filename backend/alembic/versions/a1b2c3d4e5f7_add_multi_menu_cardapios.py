"""add multi menu cardapios

Revision ID: a1b2c3d4e5f7
Revises: f7b8c9d0e1f2
Create Date: 2026-10-28 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'a1b2c3d4e5f7'
down_revision = 'f7b8c9d0e1f2'
branch_labels = None
depends_on = None


def upgrade():
    # 1. Create table cardapios
    op.create_table(
        'cardapios',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('restaurante_id', sa.Integer(), nullable=False),
        sa.Column('nome', sa.String(length=64), nullable=False),
        sa.Column('identificador', sa.String(length=32), nullable=False),
        sa.Column('descricao', sa.String(length=255), nullable=True, server_default=''),
        sa.Column('ordem_exibicao', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('criado_em', sa.DateTime(), nullable=False),
        sa.Column('atualizado_em', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['restaurante_id'], ['restaurantes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('restaurante_id', 'identificador', name='uq_cardapios_restaurante_identificador'),
        sa.UniqueConstraint('restaurante_id', 'id', name='uq_cardapios_restaurante_id'),
    )
    op.create_index('ix_cardapios_tenant', 'cardapios', ['restaurante_id'], unique=False)

    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        op.add_column('produtos', sa.Column('cardapio_id', sa.String(length=36), nullable=True))
        op.create_foreign_key(
            'fk_produtos_cardapio_tenant',
            'produtos',
            'cardapios',
            ['restaurante_id', 'cardapio_id'],
            ['restaurante_id', 'id'],
            ondelete='SET NULL',
        )
        op.add_column('configuracoes_restaurante', sa.Column('cardapio_ativo_id', sa.String(length=36), nullable=True))
        op.create_foreign_key(
            'fk_config_cardapio_ativo_tenant',
            'configuracoes_restaurante',
            'cardapios',
            ['restaurante_id', 'cardapio_ativo_id'],
            ['restaurante_id', 'id'],
            ondelete='SET NULL',
        )
        op.create_index('ix_produtos_tenant_cardapio_fk', 'produtos', ['restaurante_id', 'cardapio_id'], unique=False)
        op.execute('ALTER TABLE public.cardapios ENABLE ROW LEVEL SECURITY')
        op.execute('ALTER TABLE public.cardapios FORCE ROW LEVEL SECURITY')
        op.execute("""
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cardapios TO koma_app';
                    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON public.cardapios';
                    EXECUTE 'CREATE POLICY tenant_isolation ON public.cardapios AS PERMISSIVE FOR ALL TO koma_app USING (restaurante_id = NULLIF(current_setting(''app.current_restaurante_id'', true), '''')::integer) WITH CHECK (restaurante_id = NULLIF(current_setting(''app.current_restaurante_id'', true), '''')::integer)';
                ELSE
                    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON public.cardapios';
                    EXECUTE 'CREATE POLICY tenant_isolation ON public.cardapios AS PERMISSIVE FOR ALL USING (restaurante_id = NULLIF(current_setting(''app.current_restaurante_id'', true), '''')::integer) WITH CHECK (restaurante_id = NULLIF(current_setting(''app.current_restaurante_id'', true), '''')::integer)';
                END IF;
            END $$;
        """)
        op.execute('REVOKE ALL ON TABLE public.cardapios FROM PUBLIC')
        for role in ('anon', 'authenticated'):
            op.execute(f"""DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
                REVOKE ALL ON TABLE public.cardapios FROM {role}; END IF; END $$""")
    else:
        # SQLite
        op.add_column('produtos', sa.Column('cardapio_id', sa.String(length=36), nullable=True))
        op.add_column('configuracoes_restaurante', sa.Column('cardapio_ativo_id', sa.String(length=36), nullable=True))


def downgrade():
    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        op.drop_index('ix_produtos_tenant_cardapio_fk', table_name='produtos')
        op.drop_constraint('fk_config_cardapio_ativo_tenant', 'configuracoes_restaurante', type_='foreignkey')
        op.drop_column('configuracoes_restaurante', 'cardapio_ativo_id')
        op.drop_constraint('fk_produtos_cardapio_tenant', 'produtos', type_='foreignkey')
        op.drop_column('produtos', 'cardapio_id')
    else:
        with op.batch_alter_table('configuracoes_restaurante') as batch_op:
            batch_op.drop_column('cardapio_ativo_id')
        with op.batch_alter_table('produtos') as batch_op:
            batch_op.drop_column('cardapio_id')

    op.drop_index('ix_cardapios_tenant', table_name='cardapios')
    op.drop_table('cardapios')

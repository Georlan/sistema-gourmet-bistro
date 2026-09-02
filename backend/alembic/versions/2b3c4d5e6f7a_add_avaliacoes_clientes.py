"""add avaliacoes clientes table

Revision ID: 2b3c4d5e6f7a
Revises: 1c2d3e4f5a6b
Create Date: 2026-09-02 20:20:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '2b3c4d5e6f7a'
down_revision = '1c2d3e4f5a6b'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'avaliacoes_clientes',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('restaurante_id', sa.Integer(), nullable=False),
        sa.Column('cliente_id', sa.String(), nullable=False),
        sa.Column('comanda_id', sa.String(), nullable=True),
        sa.Column('nota', sa.Integer(), nullable=False),
        sa.Column('comentario', sa.String(length=1000), nullable=True),
        sa.Column('criado_em', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['restaurante_id'], ['restaurantes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(
            ['restaurante_id', 'cliente_id'],
            ['clientes.restaurante_id', 'clientes.id'],
            name='fk_avaliacoes_clientes_cliente_tenant',
            ondelete='CASCADE'
        ),
        sa.ForeignKeyConstraint(['comanda_id'], ['comandas.id'], name='fk_avaliacoes_clientes_comanda', ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint('nota >= 1 AND nota <= 5', name='ck_avaliacoes_clientes_nota_range'),
        sa.UniqueConstraint('restaurante_id', 'comanda_id', name='uq_avaliacoes_clientes_tenant_comanda')
    )
    op.create_index(
        'ix_avaliacoes_clientes_tenant_criado',
        'avaliacoes_clientes',
        ['restaurante_id', 'criado_em'],
        unique=False
    )
    op.create_index(
        'ix_avaliacoes_clientes_restaurante_id',
        'avaliacoes_clientes',
        ['restaurante_id'],
        unique=False
    )
    op.create_index(
        'ix_avaliacoes_clientes_cliente_id',
        'avaliacoes_clientes',
        ['cliente_id'],
        unique=False
    )
    op.create_index(
        'ix_avaliacoes_clientes_comanda_id',
        'avaliacoes_clientes',
        ['comanda_id'],
        unique=False
    )

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
        table = "avaliacoes_clientes"
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
    op.drop_index('ix_avaliacoes_clientes_comanda_id', table_name='avaliacoes_clientes')
    op.drop_index('ix_avaliacoes_clientes_cliente_id', table_name='avaliacoes_clientes')
    op.drop_index('ix_avaliacoes_clientes_restaurante_id', table_name='avaliacoes_clientes')
    op.drop_index('ix_avaliacoes_clientes_tenant_criado', table_name='avaliacoes_clientes')
    op.drop_table('avaliacoes_clientes')

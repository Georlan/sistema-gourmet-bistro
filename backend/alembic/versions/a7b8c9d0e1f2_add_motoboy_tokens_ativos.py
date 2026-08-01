"""add_motoboy_tokens_ativos

Revision ID: a7b8c9d0e1f2
Revises: ef42c523ab7e
Create Date: 2026-08-01 01:45:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7b8c9d0e1f2'
down_revision: Union[str, Sequence[str], None] = 'ef42c523ab7e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()
    
    if 'motoboy_tokens_ativos' not in tables:
        op.create_table(
            'motoboy_tokens_ativos',
            sa.Column('jti', sa.String(length=64), nullable=False),
            sa.Column('motoboy_id', sa.Integer(), nullable=False),
            sa.Column('restaurante_id', sa.Integer(), nullable=False),
            sa.Column('criado_em', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
            sa.Column('revogado', sa.Boolean(), server_default=sa.text('false'), nullable=False),
            sa.ForeignKeyConstraint(['motoboy_id'], ['motoboys.id'], ),
            sa.ForeignKeyConstraint(['restaurante_id'], ['restaurantes.id'], ),
            sa.PrimaryKeyConstraint('jti')
        )
        op.create_index(op.f('ix_motoboy_tokens_ativos_jti'), 'motoboy_tokens_ativos', ['jti'], unique=False)
        op.create_index(op.f('ix_motoboy_tokens_ativos_motoboy_id'), 'motoboy_tokens_ativos', ['motoboy_id'], unique=False)
        op.create_index(op.f('ix_motoboy_tokens_ativos_restaurante_id'), 'motoboy_tokens_ativos', ['restaurante_id'], unique=False)

    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE motoboy_tokens_ativos ENABLE ROW LEVEL SECURITY")
        op.execute("DROP POLICY IF EXISTS tenant_isolation ON motoboy_tokens_ativos")
        op.execute("""
            CREATE POLICY tenant_isolation ON motoboy_tokens_ativos
            USING (restaurante_id = current_setting('app.current_restaurante_id', true)::int)
            WITH CHECK (restaurante_id = current_setting('app.current_restaurante_id', true)::int)
        """)


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()
    if 'motoboy_tokens_ativos' in tables:
        op.drop_index(op.f('ix_motoboy_tokens_ativos_restaurante_id'), table_name='motoboy_tokens_ativos')
        op.drop_index(op.f('ix_motoboy_tokens_ativos_motoboy_id'), table_name='motoboy_tokens_ativos')
        op.drop_index(op.f('ix_motoboy_tokens_ativos_jti'), table_name='motoboy_tokens_ativos')
        op.drop_table('motoboy_tokens_ativos')

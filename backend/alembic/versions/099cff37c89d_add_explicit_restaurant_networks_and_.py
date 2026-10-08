"""add explicit restaurant networks and operator unit access

Revision ID: 099cff37c89d
Revises: 47a6b7c8d9e0
Create Date: 2026-10-07 20:28:45.599993

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '099cff37c89d'
down_revision: Union[str, Sequence[str], None] = '47a6b7c8d9e0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('restaurant_networks',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('restaurante_id', sa.Integer(), sa.ForeignKey('restaurantes.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('nome', sa.String(120), nullable=False),
        sa.UniqueConstraint('restaurante_id', 'id', name='uq_network_owner_id'))
    op.create_table('restaurant_network_units',
        sa.Column('restaurante_id', sa.Integer(), sa.ForeignKey('restaurantes.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('network_id', sa.String(36), nullable=False),
        sa.Column('network_owner_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['network_owner_id', 'network_id'], ['restaurant_networks.restaurante_id', 'restaurant_networks.id'], ondelete='RESTRICT'))
    op.create_index('ix_restaurant_network_units_network_id', 'restaurant_network_units', ['network_id'])
    op.create_table('restaurant_network_access',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('restaurante_id', sa.Integer(), nullable=False),
        sa.Column('usuario_id', sa.String(), nullable=False),
        sa.Column('destino_restaurante_id', sa.Integer(), nullable=False),
        sa.Column('destino_usuario_id', sa.String(), nullable=False),
        sa.Column('network_id', sa.String(36), sa.ForeignKey('restaurant_networks.id', ondelete='RESTRICT'), nullable=False),
        sa.ForeignKeyConstraint(['restaurante_id', 'usuario_id'], ['usuarios.restaurante_id', 'usuarios.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['destino_restaurante_id', 'destino_usuario_id'], ['usuarios.restaurante_id', 'usuarios.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('restaurante_id', 'usuario_id', 'destino_restaurante_id', name='uq_network_operator_destination'),
        sa.CheckConstraint('restaurante_id != destino_restaurante_id', name='ck_network_access_different_unit'))
    op.create_index('ix_network_access_operator', 'restaurant_network_access', ['restaurante_id', 'usuario_id'])
    if op.get_bind().dialect.name != 'postgresql':
        return
    for table in ('restaurant_networks', 'restaurant_network_units', 'restaurant_network_access'):
        op.execute(f'ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE public.{table} FORCE ROW LEVEL SECURITY')
        op.execute(f'REVOKE ALL ON TABLE public.{table} FROM PUBLIC, anon, authenticated')
        op.execute(f"CREATE POLICY tenant_isolation ON public.{table} TO koma_app USING (restaurante_id = NULLIF(current_setting('app.current_restaurante_id', true), '')::integer) WITH CHECK (restaurante_id = NULLIF(current_setting('app.current_restaurante_id', true), '')::integer)")
        op.execute(f'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.{table} TO koma_app')


def downgrade() -> None:
    op.drop_table('restaurant_network_access')
    op.drop_table('restaurant_network_units')
    op.drop_table('restaurant_networks')

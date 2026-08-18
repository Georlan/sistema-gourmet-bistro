"""add cardapio digital asset paths and configure secure storage bucket

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-07-22 00:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_supabase_storage(inspector) -> bool:
    """Supabase fornece `storage`; PostgreSQL puro legitimamente não fornece."""
    return (
        inspector.has_table('buckets', schema='storage')
        and inspector.has_table('objects', schema='storage')
    )


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    # 1. Schema do Kôma: sempre independente do provedor de storage.
    if inspector.has_table('restaurantes'):
        restaurantes_cols = [c['name'] for c in inspector.get_columns('restaurantes')]
        if 'cardapio_logo_path' not in restaurantes_cols:
            op.add_column('restaurantes', sa.Column('cardapio_logo_path', sa.String(), nullable=True))
        if 'cardapio_banner_path' not in restaurantes_cols:
            op.add_column('restaurantes', sa.Column('cardapio_banner_path', sa.String(), nullable=True))

    if inspector.has_table('configuracoes_restaurante'):
        config_cols = [c['name'] for c in inspector.get_columns('configuracoes_restaurante')]
        if 'cardapio_logo_path' not in config_cols:
            op.add_column('configuracoes_restaurante', sa.Column('cardapio_logo_path', sa.String(), nullable=True))
        if 'cardapio_banner_path' not in config_cols:
            op.add_column('configuracoes_restaurante', sa.Column('cardapio_banner_path', sa.String(), nullable=True))

    # 2. Infraestrutura Supabase: executar somente quando o schema `storage`
    # realmente estiver instalado. Isso mantém a cadeia Alembic reproduzível
    # também em PostgreSQL padrão, Railway local e CI.
    if conn.dialect.name == "postgresql" and _has_supabase_storage(inspector):
        op.execute("""
            INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
            VALUES ('cardapio-assets', 'cardapio-assets', true, 5242880, ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])
            ON CONFLICT (id) DO UPDATE SET
                public = true,
                file_size_limit = 5242880,
                allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
        """)

        op.execute("DROP POLICY IF EXISTS cardapio_assets_public_select ON storage.objects;")
        op.execute("""
            CREATE POLICY cardapio_assets_public_select ON storage.objects
            FOR SELECT
            USING (bucket_id = 'cardapio-assets');
        """)

        op.execute("DROP POLICY IF EXISTS cardapio_assets_tenant_insert ON storage.objects;")
        op.execute("DROP POLICY IF EXISTS cardapio_assets_tenant_update ON storage.objects;")
        op.execute("DROP POLICY IF EXISTS cardapio_assets_tenant_delete ON storage.objects;")


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if inspector.has_table('restaurantes'):
        restaurantes_cols = [c['name'] for c in inspector.get_columns('restaurantes')]
        if 'cardapio_logo_path' in restaurantes_cols:
            op.drop_column('restaurantes', 'cardapio_logo_path')
        if 'cardapio_banner_path' in restaurantes_cols:
            op.drop_column('restaurantes', 'cardapio_banner_path')

    if inspector.has_table('configuracoes_restaurante'):
        config_cols = [c['name'] for c in inspector.get_columns('configuracoes_restaurante')]
        if 'cardapio_logo_path' in config_cols:
            op.drop_column('configuracoes_restaurante', 'cardapio_logo_path')
        if 'cardapio_banner_path' in config_cols:
            op.drop_column('configuracoes_restaurante', 'cardapio_banner_path')

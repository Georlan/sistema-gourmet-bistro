"""remove broad select policy on cardapio-assets storage to prevent bucket listing while keeping public object URLs accessible

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-07-22 01:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name == "postgresql":
        # Remove broad SELECT policy to prevent bucket listing via API
        op.execute("DROP POLICY IF EXISTS cardapio_assets_public_select ON storage.objects;")
        op.execute("DROP POLICY IF EXISTS cardapio_assets_tenant_select ON storage.objects;")
        op.execute("DROP POLICY IF EXISTS cardapio_assets_tenant_insert ON storage.objects;")
        op.execute("DROP POLICY IF EXISTS cardapio_assets_tenant_update ON storage.objects;")
        op.execute("DROP POLICY IF EXISTS cardapio_assets_tenant_delete ON storage.objects;")


def downgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name == "postgresql":
        # Re-create public select if downgraded
        op.execute("""
            CREATE POLICY cardapio_assets_public_select ON storage.objects
            FOR SELECT
            USING (bucket_id = 'cardapio-assets');
        """)

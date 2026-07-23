"""add rls tenant isolation

Revision ID: 997233f4ca30
Revises: e7f8a9b0c1d2
Create Date: 2026-07-21 01:04:19.312985

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '997233f4ca30'
down_revision: Union[str, Sequence[str], None] = 'e7f8a9b0c1d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    # NOTA DE SEGURANÇA (P0.1): Migrations do Alembic não devem conter credenciais ou senhas hardcoded.
    # A role koma_app é mantida apenas como role de agrupamento de privilégios com NOLOGIN.
    # Contas de login do PostgreSQL usadas pela aplicação em produção devem ser provisionadas
    # externamente via infraestrutura/DevOps com credenciais injetadas por variáveis de ambiente.
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'koma_app') THEN
                CREATE ROLE koma_app NOLOGIN;
            END IF;
        END
        $$;
    """)
    op.execute("GRANT USAGE ON SCHEMA public TO koma_app")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO koma_app")
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO koma_app")
    op.execute("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO koma_app")

    op.execute("ALTER TABLE restaurantes ENABLE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation ON restaurantes
        USING (id = current_setting('app.current_restaurante_id', true)::int)
        WITH CHECK (id = current_setting('app.current_restaurante_id', true)::int)
    """)

    tenant_tables = [
        "activity_logs", "caixa_turnos", "categorias", "clientes",
        "comandas", "configuracoes_restaurante", "distribuidores",
        "insumos", "itens", "itens_nota_entrada", "mesas",
        "notas_entrada", "pagamentos", "produtos", "usuarios",
    ]
    for table in tenant_tables:
        columns = {column["name"] for column in sa.inspect(bind).get_columns(table)}
        if "restaurante_id" not in columns:
            op.add_column(
                table,
                sa.Column("restaurante_id", sa.Integer(), nullable=True),
            )
            op.create_foreign_key(
                f"fk_{table}_restaurante_id",
                table,
                "restaurantes",
                ["restaurante_id"],
                ["id"],
            )
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"""
            CREATE POLICY tenant_isolation ON {table}
            USING (restaurante_id = current_setting('app.current_restaurante_id', true)::int)
            WITH CHECK (restaurante_id = current_setting('app.current_restaurante_id', true)::int)
        """)


def downgrade() -> None:
    tenant_tables = [
        "activity_logs", "caixa_turnos", "categorias", "clientes",
        "comandas", "configuracoes_restaurante", "distribuidores",
        "insumos", "itens", "itens_nota_entrada", "mesas",
        "notas_entrada", "pagamentos", "produtos", "usuarios",
    ]
    for table in tenant_tables:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    op.execute("DROP POLICY IF EXISTS tenant_isolation ON restaurantes")
    op.execute("ALTER TABLE restaurantes DISABLE ROW LEVEL SECURITY")

    op.execute("REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM koma_app")
    op.execute("DROP ROLE IF EXISTS koma_app")

"""category inherited addons

Revision ID: 6e7f8091a2b3
Revises: 5d6e7f8091a2
Create Date: 2026-09-09 19:40:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "6e7f8091a2b3"
down_revision = "5d6e7f8091a2"
branch_labels = None
depends_on = None


def _enable_tenant_rls(table_name: str) -> None:
    tenant_expr = (
        "restaurante_id = NULLIF("
        "current_setting('app.current_restaurante_id', true), ''"
        ")::integer"
    )
    op.execute(f"ALTER TABLE public.{table_name} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE public.{table_name} FORCE ROW LEVEL SECURITY")
    op.execute(f"""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                REVOKE ALL ON TABLE public.{table_name} FROM PUBLIC;
                REVOKE ALL ON TABLE public.{table_name} FROM koma_app;
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.{table_name} TO koma_app;
            END IF;
        END
        $$;
    """)
    op.execute(f"""
        CREATE POLICY {table_name}_select ON public.{table_name}
        FOR SELECT TO koma_app USING ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY {table_name}_insert ON public.{table_name}
        FOR INSERT TO koma_app WITH CHECK ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY {table_name}_update ON public.{table_name}
        FOR UPDATE TO koma_app USING ({tenant_expr}) WITH CHECK ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY {table_name}_delete ON public.{table_name}
        FOR DELETE TO koma_app USING ({tenant_expr})
    """)


def upgrade() -> None:
    bind = op.get_bind()

    op.create_table(
        "categoria_relacoes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("categoria_id", sa.String(), nullable=False),
        sa.Column("categoria_pai_id", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(
            ["restaurante_id"],
            ["restaurantes.id"],
            name="fk_categoria_relacoes_restaurante_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["restaurante_id", "categoria_id"],
            ["categorias.restaurante_id", "categorias.id"],
            name="fk_categoria_relacoes_child_tenant",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["restaurante_id", "categoria_pai_id"],
            ["categorias.restaurante_id", "categorias.id"],
            name="fk_categoria_relacoes_parent_tenant",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "restaurante_id",
            "categoria_id",
            name="uq_categoria_relacoes_tenant_child",
        ),
        sa.CheckConstraint(
            "categoria_id <> categoria_pai_id",
            name="ck_categoria_relacoes_not_self",
        ),
    )
    op.create_index(
        "ix_categoria_relacoes_restaurante_id",
        "categoria_relacoes",
        ["restaurante_id"],
    )
    op.create_index(
        "ix_categoria_relacoes_tenant_parent",
        "categoria_relacoes",
        ["restaurante_id", "categoria_pai_id"],
    )

    op.create_table(
        "categoria_grupo_modificadores",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("categoria_id", sa.String(), nullable=False),
        sa.Column("grupo_id", sa.String(), nullable=False),
        sa.Column(
            "incluir_subcategorias",
            sa.Boolean(),
            server_default=sa.true(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["restaurante_id"],
            ["restaurantes.id"],
            name="fk_categoria_grupo_restaurante_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["restaurante_id", "categoria_id"],
            ["categorias.restaurante_id", "categorias.id"],
            name="fk_categoria_grupo_categoria_tenant",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["grupo_id"],
            ["grupo_modificadores.id"],
            name="fk_categoria_grupo_grupo_id",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "restaurante_id",
            "categoria_id",
            "grupo_id",
            name="uq_categoria_grupo_modificadores_tenant",
        ),
    )
    op.create_index(
        "ix_categoria_grupo_modificadores_restaurante_id",
        "categoria_grupo_modificadores",
        ["restaurante_id"],
    )
    op.create_index(
        "ix_categoria_grupo_tenant_categoria",
        "categoria_grupo_modificadores",
        ["restaurante_id", "categoria_id"],
    )
    op.create_index(
        "ix_categoria_grupo_tenant_grupo",
        "categoria_grupo_modificadores",
        ["restaurante_id", "grupo_id"],
    )

    if bind.dialect.name == "postgresql":
        _enable_tenant_rls("categoria_relacoes")
        _enable_tenant_rls("categoria_grupo_modificadores")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for table_name in ("categoria_grupo_modificadores", "categoria_relacoes"):
            for action in ("delete", "update", "insert", "select"):
                op.execute(
                    f"DROP POLICY IF EXISTS {table_name}_{action} ON public.{table_name}"
                )
    op.drop_table("categoria_grupo_modificadores")
    op.drop_table("categoria_relacoes")

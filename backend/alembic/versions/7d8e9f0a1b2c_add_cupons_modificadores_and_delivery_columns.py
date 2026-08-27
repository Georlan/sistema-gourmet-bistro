"""add cupons modificadores and delivery columns

Revision ID: 7d8e9f0a1b2c
Revises: 6c7d8e9f0a1b
Create Date: 2026-08-27 16:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "7d8e9f0a1b2c"
down_revision: Union[str, Sequence[str], None] = "6c7d8e9f0a1b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    # 1. Tabela cupons
    if "cupons" not in tables:
        op.create_table(
            "cupons",
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("restaurante_id", sa.Integer(), sa.ForeignKey("restaurantes.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("codigo", sa.String(50), nullable=False),
            sa.Column("tipo_desconto", sa.String(20), nullable=False, server_default="porcentagem"),
            sa.Column("valor_desconto", sa.Float(), nullable=False, server_default="0.0"),
            sa.Column("valor_minimo_pedido", sa.Float(), nullable=False, server_default="0.0"),
            sa.Column("limite_usos", sa.Integer(), nullable=True),
            sa.Column("usos_atuais", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("valido_ate", sa.DateTime(timezone=True), nullable=True),
            sa.Column("apenas_primeira_compra", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("ativo", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("cliente_id", sa.String(64), nullable=True),
            sa.Column("criado_em", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("restaurante_id", "codigo", name="uq_cupons_restaurante_codigo"),
        )

    # 2. Tabela grupos_modificadores
    if "grupos_modificadores" not in tables:
        op.create_table(
            "grupos_modificadores",
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("restaurante_id", sa.Integer(), sa.ForeignKey("restaurantes.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("nome", sa.String(100), nullable=False),
            sa.Column("min_selecoes", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("max_selecoes", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("tipo", sa.String(20), nullable=False, server_default="opcional"),
            sa.Column("criado_em", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    # 3. Tabela opcoes_modificadores
    if "opcoes_modificadores" not in tables:
        op.create_table(
            "opcoes_modificadores",
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("restaurante_id", sa.Integer(), sa.ForeignKey("restaurantes.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("grupo_id", sa.String(64), sa.ForeignKey("grupos_modificadores.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("nome", sa.String(100), nullable=False),
            sa.Column("preco_adicional", sa.Float(), nullable=False, server_default="0.0"),
            sa.Column("ativo", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("criado_em", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    # 4. Tabela produto_grupo_modificadores
    if "produto_grupo_modificadores" not in tables:
        op.create_table(
            "produto_grupo_modificadores",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("restaurante_id", sa.Integer(), sa.ForeignKey("restaurantes.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("produto_id", sa.String(64), nullable=False, index=True),
            sa.Column("grupo_id", sa.String(64), sa.ForeignKey("grupos_modificadores.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.UniqueConstraint("restaurante_id", "produto_id", "grupo_id", name="uq_produto_grupo_modificador"),
        )

    # 5. Colunas em comandas
    comandas_cols = [c["name"] for c in inspector.get_columns("comandas")]
    if "cupom_id" not in comandas_cols:
        op.add_column("comandas", sa.Column("cupom_id", sa.String(64), nullable=True))
    if "valor_desconto_cupom" not in comandas_cols:
        op.add_column("comandas", sa.Column("valor_desconto_cupom", sa.Float(), nullable=True, server_default="0.0"))
    if "valor_desconto_cashback" not in comandas_cols:
        op.add_column("comandas", sa.Column("valor_desconto_cashback", sa.Float(), nullable=True, server_default="0.0"))
    if "delivery_forma_pagamento" not in comandas_cols:
        op.add_column("comandas", sa.Column("delivery_forma_pagamento", sa.String(50), nullable=True))
    if "delivery_troco_para" not in comandas_cols:
        op.add_column("comandas", sa.Column("delivery_troco_para", sa.Float(), nullable=True))
    if "delivery_bairro" not in comandas_cols:
        op.add_column("comandas", sa.Column("delivery_bairro", sa.String(100), nullable=True))

    # 6. Colunas em configuracoes_restaurante
    config_cols = [c["name"] for c in inspector.get_columns("configuracoes_restaurante")]
    if "pedido_minimo" not in config_cols:
        op.add_column("configuracoes_restaurante", sa.Column("pedido_minimo", sa.Float(), nullable=True, server_default="0.0"))
    if "frete_gratis_valor" not in config_cols:
        op.add_column("configuracoes_restaurante", sa.Column("frete_gratis_valor", sa.Float(), nullable=True, server_default="0.0"))
    if "tipo_taxa_entrega" not in config_cols:
        op.add_column("configuracoes_restaurante", sa.Column("tipo_taxa_entrega", sa.String(30), nullable=True, server_default="fixa"))
    if "tabela_taxas_bairros" not in config_cols:
        op.add_column("configuracoes_restaurante", sa.Column("tabela_taxas_bairros", sa.JSON(), nullable=True))
    if "tabela_taxas_km" not in config_cols:
        op.add_column("configuracoes_restaurante", sa.Column("tabela_taxas_km", sa.JSON(), nullable=True))

    # RLS para PostgreSQL
    if conn.dialect.name == "postgresql":
        for table_name in ("cupons", "grupos_modificadores", "opcoes_modificadores", "produto_grupo_modificadores"):
            op.execute(f"ALTER TABLE public.{table_name} ENABLE ROW LEVEL SECURITY")
            op.execute(f"ALTER TABLE public.{table_name} FORCE ROW LEVEL SECURITY")
            op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON public.{table_name}")
            op.execute(
                f"""
                CREATE POLICY tenant_isolation ON public.{table_name}
                AS PERMISSIVE
                FOR ALL
                TO koma_app
                USING (
                    restaurante_id = NULLIF(
                        (SELECT current_setting('app.current_restaurante_id', true)),
                        ''
                    )::integer
                )
                WITH CHECK (
                    restaurante_id = NULLIF(
                        (SELECT current_setting('app.current_restaurante_id', true)),
                        ''
                    )::integer
                )
                """
            )
            op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.{table_name} TO koma_app")


def downgrade() -> None:
    pass

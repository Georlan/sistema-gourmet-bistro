"""add saas_status and super_admin_audit_logs

Revision ID: 2b3c4d5e6f7a
Revises: 1c2d3e4f5a6b
Create Date: 2026-09-03 06:40:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "2b3c4d5e6f7a"
down_revision = "1c2d3e4f5a6b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    # Estado comercial do SaaS é separado do status operacional/horário do restaurante.
    op.add_column(
        "restaurantes",
        sa.Column(
            "saas_status",
            sa.String(length=20),
            server_default="active",
            nullable=False,
        ),
    )

    if bind.dialect.name == "postgresql":
        op.create_check_constraint(
            "ck_restaurantes_saas_status",
            "restaurantes",
            "saas_status IN ('active', 'suspended')",
        )

    op.create_table(
        "super_admin_audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("actor", sa.String(length=255), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("before_data", sa.JSON(), nullable=True),
        sa.Column("after_data", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["restaurante_id"],
            ["restaurantes.id"],
            name="fk_super_admin_audit_logs_restaurante_id",
            ondelete="CASCADE",
        ),
    )

    op.create_index(
        "ix_super_admin_audit_logs_restaurante_id",
        "super_admin_audit_logs",
        ["restaurante_id"],
        unique=False,
    )

    if bind.dialect.name != "postgresql":
        return

    op.create_index(
        "ix_super_admin_audit_logs_created_at",
        "super_admin_audit_logs",
        ["created_at"],
        unique=False,
    )

    # O runtime injeta o tenant nesta GUC em TenantSession.after_begin.
    # Não existe bypass global por tenant 0: o Super Admin também entra no
    # tenant_session_scope de cada restaurante antes de ler/escrever auditoria.
    tenant_expr = (
        "restaurante_id = NULLIF("
        "current_setting('app.current_restaurante_id', true), ''"
        ")::integer"
    )

    op.execute("ALTER TABLE public.super_admin_audit_logs ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.super_admin_audit_logs FORCE ROW LEVEL SECURITY")

    # Append-only também no banco: a role da aplicação recebe somente leitura e
    # inserção. A sequence precisa de privilégio explícito para o PK autoincremental.
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                REVOKE ALL ON TABLE public.super_admin_audit_logs FROM koma_app;
                GRANT SELECT, INSERT ON TABLE public.super_admin_audit_logs TO koma_app;
                GRANT USAGE, SELECT ON SEQUENCE public.super_admin_audit_logs_id_seq TO koma_app;
            END IF;
        END
        $$;
    """)

    # Policies permissivas separadas por operação. Sem policy de UPDATE/DELETE,
    # mesmo uma concessão acidental futura não autoriza mutação via RLS.
    op.execute(f"""
        CREATE POLICY super_admin_audit_logs_select
        ON public.super_admin_audit_logs
        FOR SELECT
        TO koma_app
        USING ({tenant_expr})
    """)
    op.execute(f"""
        CREATE POLICY super_admin_audit_logs_insert
        ON public.super_admin_audit_logs
        FOR INSERT
        TO koma_app
        WITH CHECK ({tenant_expr})
    """)


def downgrade() -> None:
    bind = op.get_bind()

    if bind.dialect.name == "postgresql":
        op.execute(
            "DROP POLICY IF EXISTS super_admin_audit_logs_insert "
            "ON public.super_admin_audit_logs"
        )
        op.execute(
            "DROP POLICY IF EXISTS super_admin_audit_logs_select "
            "ON public.super_admin_audit_logs"
        )
        op.drop_index(
            "ix_super_admin_audit_logs_created_at",
            table_name="super_admin_audit_logs",
        )

    op.drop_index(
        "ix_super_admin_audit_logs_restaurante_id",
        table_name="super_admin_audit_logs",
    )
    op.drop_table("super_admin_audit_logs")

    if bind.dialect.name == "postgresql":
        op.drop_constraint(
            "ck_restaurantes_saas_status",
            "restaurantes",
            type_="check",
        )

    op.drop_column("restaurantes", "saas_status")

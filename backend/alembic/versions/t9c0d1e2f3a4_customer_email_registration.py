"""Customer e-mail registration challenges and verified e-mail marker.

Revision ID: t9c0d1e2f3a4
Revises: r7a8b9c0d1e2
"""
from alembic import op
import sqlalchemy as sa

revision = "t9c0d1e2f3a4"
down_revision = "s8b9c0d1e2f3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "clientes",
        sa.Column("email_verificado_em", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "customer_registration_challenges",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("nome", sa.String(length=100), nullable=False),
        sa.Column("email", sa.String(length=150), nullable=False),
        sa.Column("telefone", sa.String(length=20), nullable=False),
        sa.Column("endereco", sa.String(length=300), nullable=True),
        sa.Column("senha_hash", sa.String(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expira_em", sa.DateTime(timezone=True), nullable=False),
        sa.Column("email_verificado_em", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ultimo_envio_em", sa.DateTime(timezone=True), nullable=True),
        sa.Column("janela_iniciada_em", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "envios_na_janela",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "criado_em",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["restaurante_id"],
            ["restaurantes.id"],
            name="fk_customer_registration_challenges_restaurante_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "restaurante_id",
            "email",
            name="uq_customer_registration_challenges_tenant_email",
        ),
        sa.UniqueConstraint(
            "restaurante_id",
            "token_hash",
            name="uq_customer_registration_challenges_tenant_token",
        ),
    )
    op.create_index(
        "ix_customer_registration_challenges_restaurante_id",
        "customer_registration_challenges",
        ["restaurante_id"],
        unique=False,
    )
    op.create_index(
        "ix_customer_registration_challenges_tenant_expiry",
        "customer_registration_challenges",
        ["restaurante_id", "expira_em"],
        unique=False,
    )

    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    tenant = (
        "restaurante_id = NULLIF("
        "current_setting('app.current_restaurante_id', true), ''"
        ")::integer"
    )
    op.execute(
        "ALTER TABLE public.customer_registration_challenges "
        "ENABLE ROW LEVEL SECURITY"
    )
    op.execute(
        "ALTER TABLE public.customer_registration_challenges "
        "FORCE ROW LEVEL SECURITY"
    )
    op.execute(
        "REVOKE ALL ON TABLE public.customer_registration_challenges FROM PUBLIC"
    )
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                GRANT SELECT, INSERT, UPDATE, DELETE
                ON TABLE public.customer_registration_challenges TO koma_app;
            END IF;
        END
        $$;
    """)
    op.execute(
        f"CREATE POLICY customer_registration_challenges_tenant "
        f"ON public.customer_registration_challenges TO koma_app "
        f"USING ({tenant}) WITH CHECK ({tenant})"
    )


def downgrade() -> None:
    bind = op.get_bind()
    unsafe_accounts = bind.execute(sa.text("""
        SELECT COUNT(*)
        FROM clientes
        WHERE email_verificado_em IS NOT NULL
          AND telefone_verificado_em IS NULL
          AND senha_hash IS NOT NULL
    """)).scalar()
    if int(unsafe_accounts or 0) > 0:
        raise RuntimeError(
            "Downgrade bloqueado: existem contas verificadas por e-mail "
            "sem telefone comprovado."
        )

    if bind.dialect.name == "postgresql":
        op.execute(
            "DROP POLICY IF EXISTS customer_registration_challenges_tenant "
            "ON public.customer_registration_challenges"
        )
    op.drop_index(
        "ix_customer_registration_challenges_tenant_expiry",
        table_name="customer_registration_challenges",
    )
    op.drop_index(
        "ix_customer_registration_challenges_restaurante_id",
        table_name="customer_registration_challenges",
    )
    op.drop_table("customer_registration_challenges")
    op.drop_column("clientes", "email_verificado_em")

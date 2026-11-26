"""add super_admin_company_receipts ledger in koma_internal

Revision ID: 20261126c105
Revises: 20261126c104
Create Date: 2026-11-26 12:25:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261126c105"
down_revision: Union[str, Sequence[str], None] = "20261126c104"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    pg = bind.dialect.name == "postgresql"
    schema = "koma_internal" if pg else None
    if pg:
        op.execute("CREATE SCHEMA IF NOT EXISTS koma_internal")

    op.create_table(
        "super_admin_company_receipts",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("restaurante_id", sa.Integer(), nullable=False),
        sa.Column("source_type", sa.String(length=32), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("external_reference", sa.String(length=128), nullable=False),
        sa.Column("plan_code", sa.String(length=20), nullable=True),
        sa.Column("payment_method", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="paid"),
        sa.Column("competence_period", sa.String(length=7), nullable=False),
        sa.Column("gross_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("provider", "external_reference", name="uq_company_receipts_provider_ref"),
        schema=schema,
    )
    op.create_index(
        "ix_super_admin_company_receipts_restaurante_id",
        "super_admin_company_receipts",
        ["restaurante_id"],
        schema=schema,
    )
    op.create_index(
        "ix_super_admin_company_receipts_competence_period",
        "super_admin_company_receipts",
        ["competence_period"],
        schema=schema,
    )

    if pg:
        full = "koma_internal.super_admin_company_receipts"
        op.execute(f"ALTER TABLE {full} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {full} FORCE ROW LEVEL SECURITY")
        op.execute(f"REVOKE ALL ON TABLE {full} FROM PUBLIC")
        op.execute(
            f"""DO $$ BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE {full} FROM anon; END IF;
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE {full} FROM authenticated; END IF;
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='koma_app') THEN
                    GRANT USAGE ON SCHEMA koma_internal TO koma_app;
                    GRANT SELECT, INSERT, UPDATE ON TABLE {full} TO koma_app;
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_policies
                        WHERE schemaname='koma_internal' AND tablename='super_admin_company_receipts'
                          AND policyname='company_receipts_backend'
                    ) THEN
                        CREATE POLICY company_receipts_backend ON {full} FOR ALL TO koma_app USING (true) WITH CHECK (true);
                    END IF;
                END IF;
            END $$"""
        )


def downgrade() -> None:
    schema = "koma_internal" if op.get_bind().dialect.name == "postgresql" else None
    op.drop_index("ix_super_admin_company_receipts_competence_period", table_name="super_admin_company_receipts", schema=schema)
    op.drop_index("ix_super_admin_company_receipts_restaurante_id", table_name="super_admin_company_receipts", schema=schema)
    op.drop_table("super_admin_company_receipts", schema=schema)

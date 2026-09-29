"""encrypt legacy payment customer snapshots

Revision ID: v2f3a4b5c6d7
Revises: u1e2f3a4b5c6
Create Date: 2026-09-29

Pagamento.cliente_id is the canonical relationship key. The legacy
cpf_cliente/nome_cliente snapshots remain readable to the application but are
encrypted at rest and are no longer indexed as plaintext.
"""

from alembic import op
import sqlalchemy as sa

from app.crypt import decrypt_field, encrypt_field


revision = "v2f3a4b5c6d7"
down_revision = "u1e2f3a4b5c6"
branch_labels = None
depends_on = None


def _backfill(bind, *, encrypt: bool) -> None:
    rows = bind.execute(
        sa.text("SELECT id, cpf_cliente, nome_cliente FROM pagamentos")
    ).mappings().all()
    transform = encrypt_field if encrypt else decrypt_field
    for row in rows:
        bind.execute(
            sa.text(
                """
                UPDATE pagamentos
                SET cpf_cliente = :cpf_cliente,
                    nome_cliente = :nome_cliente
                WHERE id = :id
                """
            ),
            {
                "id": row["id"],
                "cpf_cliente": transform(row["cpf_cliente"]),
                "nome_cliente": transform(row["nome_cliente"]),
            },
        )


def upgrade() -> None:
    bind = op.get_bind()
    indexes = {item["name"] for item in sa.inspect(bind).get_indexes("pagamentos")}
    if "ix_pagamentos_cpf_cliente" in indexes:
        op.drop_index("ix_pagamentos_cpf_cliente", table_name="pagamentos")

    if bind.dialect.name == "postgresql":
        op.alter_column(
            "pagamentos",
            "cpf_cliente",
            type_=sa.Text(),
            existing_nullable=True,
        )
        op.alter_column(
            "pagamentos",
            "nome_cliente",
            type_=sa.Text(),
            existing_nullable=True,
        )

    _backfill(bind, encrypt=True)


def downgrade() -> None:
    bind = op.get_bind()
    _backfill(bind, encrypt=False)

    if bind.dialect.name == "postgresql":
        op.alter_column(
            "pagamentos",
            "cpf_cliente",
            type_=sa.String(),
            existing_nullable=True,
        )
        op.alter_column(
            "pagamentos",
            "nome_cliente",
            type_=sa.String(),
            existing_nullable=True,
        )

    if "ix_pagamentos_cpf_cliente" not in {
        item["name"] for item in sa.inspect(bind).get_indexes("pagamentos")
    }:
        op.create_index(
            "ix_pagamentos_cpf_cliente",
            "pagamentos",
            ["cpf_cliente"],
            unique=False,
        )

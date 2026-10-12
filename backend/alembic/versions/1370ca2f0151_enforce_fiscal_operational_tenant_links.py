"""enforce fiscal operational tenant links

Revision ID: 1370ca2f0151
Revises: 7b8c9d0e1f23
Create Date: 2026-10-12 14:43:10.451589

The fiscal discriminator must agree with the linked operational row. RLS alone
does not enforce this: a foreign-key check can see the referenced row even when
it belongs to another tenant. Existing violations are rejected, never repaired
automatically or reassigned. Deployment requires reviewing lock duration on the
operational parent tables; this migration does not enable fiscal issuance.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1370ca2f0151'
down_revision: Union[str, Sequence[str], None] = '7b8c9d0e1f23'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


COMANDA_UNIQUE = "uq_comandas_restaurante_id_id"
PAGAMENTO_UNIQUE = "uq_pagamentos_restaurante_id_id"
DOCUMENT_COMANDA_FK = "fk_fiscal_document_comanda_tenant"
PAYMENT_PAGAMENTO_FK = "fk_fiscal_payment_pagamento_tenant"


def _bound_postgres_work(bind) -> None:
    if bind.dialect.name == "postgresql":
        # Refuse a busy deployment rather than hold a restaurant's writes in a
        # lock queue indefinitely. Review table size/window before release.
        bind.execute(sa.text("SET LOCAL lock_timeout = '5s'"))
        bind.execute(sa.text("SET LOCAL statement_timeout = '60s'"))


def _assert_no_invalid_fiscal_links(bind) -> None:
    checks = (
        ("fiscal_documents.comanda_id", "fiscal_documents", "comandas", "comanda_id"),
        ("fiscal_payments.pagamento_id", "fiscal_payments", "pagamentos", "pagamento_id"),
    )
    violations = []
    for label, child_table, parent_table, local_key in checks:
        count = int(bind.execute(sa.text(f"""
            SELECT COUNT(*)
            FROM {child_table} AS child
            LEFT JOIN {parent_table} AS parent ON parent.id = child.{local_key}
            WHERE child.{local_key} IS NOT NULL
              AND (parent.id IS NULL OR child.restaurante_id <> parent.restaurante_id)
        """)).scalar_one())
        if count:
            violations.append(f"{label}={count}")
    if violations:
        raise RuntimeError(
            "Fiscal recusou referências operacionais inválidas/cross-tenant existentes: "
            + ", ".join(violations)
        )


def upgrade() -> None:
    bind = op.get_bind()
    _bound_postgres_work(bind)
    _assert_no_invalid_fiscal_links(bind)
    with op.batch_alter_table("comandas") as batch_op:
        batch_op.create_unique_constraint(COMANDA_UNIQUE, ["restaurante_id", "id"])
    with op.batch_alter_table("pagamentos") as batch_op:
        batch_op.create_unique_constraint(PAGAMENTO_UNIQUE, ["restaurante_id", "id"])

    for table, name, parent, local_key in (
        ("fiscal_documents", DOCUMENT_COMANDA_FK, "comandas", "comanda_id"),
        ("fiscal_payments", PAYMENT_PAGAMENTO_FK, "pagamentos", "pagamento_id"),
    ):
        if bind.dialect.name == "postgresql":
            op.execute(sa.text(f"""
                ALTER TABLE {table} ADD CONSTRAINT {name}
                FOREIGN KEY (restaurante_id, {local_key})
                REFERENCES {parent} (restaurante_id, id) ON DELETE RESTRICT NOT VALID
            """))
            op.execute(sa.text(f"ALTER TABLE {table} VALIDATE CONSTRAINT {name}"))
        else:
            with op.batch_alter_table(table) as batch_op:
                batch_op.create_foreign_key(
                    name, parent, ["restaurante_id", local_key],
                    ["restaurante_id", "id"], ondelete="RESTRICT",
                )


def downgrade() -> None:
    _bound_postgres_work(op.get_bind())
    with op.batch_alter_table("fiscal_payments") as batch_op:
        batch_op.drop_constraint(PAYMENT_PAGAMENTO_FK, type_="foreignkey")
    with op.batch_alter_table("fiscal_documents") as batch_op:
        batch_op.drop_constraint(DOCUMENT_COMANDA_FK, type_="foreignkey")
    with op.batch_alter_table("pagamentos") as batch_op:
        batch_op.drop_constraint(PAGAMENTO_UNIQUE, type_="unique")
    with op.batch_alter_table("comandas") as batch_op:
        batch_op.drop_constraint(COMANDA_UNIQUE, type_="unique")

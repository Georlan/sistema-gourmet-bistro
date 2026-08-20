"""security B: enforce tenant-safe user foreign keys

Revision ID: d5b9f3a7c024
Revises: c4a8e2f6b913
Create Date: 2026-08-19

The adversarial audit proved that two tenant-owned rows could reference a user
from another restaurant because the database only validated ``usuarios.id``.
Application guards and RLS are not enough for this relationship: raw SQL that
is otherwise valid inside tenant 5101 could still point at a tenant-5102 user.

This migration adds a redundant-but-intentional unique key on
``usuarios(restaurante_id, id)`` and composite foreign keys for the two proven
attack paths. Existing simple foreign keys are kept as defense in depth.

The migration fails instead of silently rewriting historical data if an
existing cross-tenant reference is found.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d5b9f3a7c024"
down_revision: Union[str, Sequence[str], None] = "c4a8e2f6b913"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


USER_PAIR_UNIQUE = "uq_usuarios_restaurante_id_id"
ACTIVITY_FK = "fk_activity_logs_garcom_tenant"
SMARTPOS_FK = "fk_smartpos_intent_operador_tenant"
ACTIVITY_INDEX = "ix_activity_logs_tenant_garcom"
SMARTPOS_INDEX = "ix_smartpos_intent_tenant_operador"


def _assert_no_cross_tenant_user_refs(bind) -> None:
    checks = (
        (
            "activity_logs.garcom_id",
            """
            SELECT COUNT(*)
            FROM activity_logs AS child
            JOIN usuarios AS usuario ON usuario.id = child.garcom_id
            WHERE child.restaurante_id <> usuario.restaurante_id
            """,
        ),
        (
            "smartpos_payment_intents.operador_id",
            """
            SELECT COUNT(*)
            FROM smartpos_payment_intents AS child
            JOIN usuarios AS usuario ON usuario.id = child.operador_id
            WHERE child.restaurante_id <> usuario.restaurante_id
            """,
        ),
    )
    violations: list[str] = []
    for label, sql in checks:
        count = int(bind.execute(sa.text(sql)).scalar_one())
        if count:
            violations.append(f"{label}={count}")

    if violations:
        raise RuntimeError(
            "Security B recusou aplicar constraints sobre referências cross-tenant "
            "já existentes: " + ", ".join(violations)
        )


def upgrade() -> None:
    bind = op.get_bind()
    _assert_no_cross_tenant_user_refs(bind)

    with op.batch_alter_table("usuarios") as batch_op:
        batch_op.create_unique_constraint(
            USER_PAIR_UNIQUE,
            ["restaurante_id", "id"],
        )

    with op.batch_alter_table("activity_logs") as batch_op:
        batch_op.create_foreign_key(
            ACTIVITY_FK,
            "usuarios",
            ["restaurante_id", "garcom_id"],
            ["restaurante_id", "id"],
            ondelete="RESTRICT",
        )
        batch_op.create_index(
            ACTIVITY_INDEX,
            ["restaurante_id", "garcom_id"],
            unique=False,
        )

    with op.batch_alter_table("smartpos_payment_intents") as batch_op:
        batch_op.create_foreign_key(
            SMARTPOS_FK,
            "usuarios",
            ["restaurante_id", "operador_id"],
            ["restaurante_id", "id"],
            ondelete="RESTRICT",
        )
        batch_op.create_index(
            SMARTPOS_INDEX,
            ["restaurante_id", "operador_id"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("smartpos_payment_intents") as batch_op:
        batch_op.drop_index(SMARTPOS_INDEX)
        batch_op.drop_constraint(SMARTPOS_FK, type_="foreignkey")

    with op.batch_alter_table("activity_logs") as batch_op:
        batch_op.drop_index(ACTIVITY_INDEX)
        batch_op.drop_constraint(ACTIVITY_FK, type_="foreignkey")

    with op.batch_alter_table("usuarios") as batch_op:
        batch_op.drop_constraint(USER_PAIR_UNIQUE, type_="unique")

"""evaluate remaining RLS context once

Revision ID: dc8dcc280fff
Revises: 910241c0a2ab
Create Date: 2026-09-05 01:17:39.984605

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'dc8dcc280fff'
down_revision: Union[str, Sequence[str], None] = '910241c0a2ab'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Keep roles/commands/predicates; only hoist the stable context lookup."""
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    quote = bind.dialect.identifier_preparer.quote
    policies = bind.execute(sa.text("""
        SELECT tablename, policyname, qual, with_check
        FROM pg_policies WHERE schemaname = 'public'
          AND tablename IN ('super_admin_audit_logs', 'restaurant_trials',
                            'scheduled_orders', 'user_session_versions', 'support_sessions')
    """)).mappings().all()
    lookup = "current_setting('app.current_restaurante_id'::text, true)"
    for policy in policies:
        clauses = []
        for field, clause in (("qual", "USING"), ("with_check", "WITH CHECK")):
            expr = policy[field]
            if expr and lookup in expr and "select current_setting" not in expr.lower():
                clauses.append(f"{clause} ({expr.replace(lookup, '(SELECT ' + lookup + ')')})")
        if clauses:
            bind.execute(sa.text(f"ALTER POLICY {quote(policy['policyname'])} ON public.{quote(policy['tablename'])} " + " ".join(clauses)))


def downgrade() -> None:
    """Equivalent access policy is safe for the preceding application version."""
    pass

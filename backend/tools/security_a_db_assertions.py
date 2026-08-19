from __future__ import annotations

import os

from sqlalchemy import create_engine, text


ADMIN_URL = os.environ["AUDIT_ADMIN_DATABASE_URL"]
RUNTIME_URL = os.environ["DATABASE_URL"]


def main() -> None:
    admin = create_engine(ADMIN_URL, pool_pre_ping=True)
    runtime = create_engine(RUNTIME_URL, pool_pre_ping=True)

    try:
        with admin.connect() as conn:
            tenant_tables = conn.execute(
                text(
                    """
                    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
                    FROM pg_class AS c
                    JOIN pg_namespace AS n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public'
                      AND c.relkind = 'r'
                      AND EXISTS (
                          SELECT 1
                          FROM information_schema.columns AS col
                          WHERE col.table_schema = 'public'
                            AND col.table_name = c.relname
                            AND col.column_name = 'restaurante_id'
                      )
                    ORDER BY c.relname
                    """
                )
            ).all()
            assert tenant_tables, "no tenant tables discovered"

            not_hardened = [
                name
                for name, enabled, forced in tenant_tables
                if not enabled or not forced
            ]
            assert not not_hardened, (
                "tenant tables without ENABLE+FORCE RLS: "
                f"{not_hardened}"
            )

            policy_rows = conn.execute(
                text(
                    """
                    SELECT tablename, roles::text, lower(coalesce(qual, '')),
                           lower(coalesce(with_check, ''))
                    FROM pg_policies
                    WHERE schemaname = 'public'
                      AND policyname = 'tenant_isolation'
                    ORDER BY tablename
                    """
                )
            ).all()
            by_table = {
                table: (roles, qual, with_check)
                for table, roles, qual, with_check in policy_rows
            }

            policy_errors: list[str] = []
            for table, *_ in tenant_tables:
                policy = by_table.get(table)
                if policy is None:
                    policy_errors.append(f"{table}: missing tenant_isolation")
                    continue
                roles, qual, with_check = policy
                if roles != "{koma_app}":
                    policy_errors.append(f"{table}: roles={roles}")
                if "nullif" not in qual or "current_setting" not in qual:
                    policy_errors.append(f"{table}: unsafe USING={qual}")
                if "nullif" not in with_check or "current_setting" not in with_check:
                    policy_errors.append(f"{table}: unsafe WITH CHECK={with_check}")
            assert not policy_errors, "; ".join(policy_errors)

            public_grants = conn.execute(
                text(
                    """
                    SELECT table_name, privilege_type
                    FROM information_schema.role_table_grants
                    WHERE table_schema = 'public'
                      AND grantee = 'PUBLIC'
                      AND table_name IN ('clientes', 'comandas')
                    ORDER BY table_name, privilege_type
                    """
                )
            ).all()
            assert not public_grants, (
                "legacy PUBLIC grants still present: "
                f"{[(table, privilege) for table, privilege in public_grants]}"
            )

        with runtime.connect() as conn:
            runtime_role = conn.execute(text("SELECT current_user")).scalar_one()
            for table in ("clientes", "comandas"):
                can_truncate = conn.execute(
                    text(
                        "SELECT has_table_privilege(current_user, :table, 'TRUNCATE')"
                    ),
                    {"table": f"public.{table}"},
                ).scalar_one()
                assert not can_truncate, (
                    f"runtime role {runtime_role} can TRUNCATE public.{table}"
                )

            tx = conn.begin()
            try:
                conn.execute(
                    text(
                        "SELECT set_config('app.current_restaurante_id', '5101', true)"
                    )
                )
                seen = conn.execute(
                    text(
                        """
                        SELECT DISTINCT restaurante_id
                        FROM public.smartpos_payment_intent_events
                        ORDER BY restaurante_id
                        """
                    )
                ).scalars().all()
                assert [int(value) for value in seen] == [5101], seen
            finally:
                tx.rollback()

            tx = conn.begin()
            try:
                conn.execute(
                    text(
                        "SELECT set_config('app.current_restaurante_id', '', true)"
                    )
                )
                count = conn.execute(
                    text("SELECT count(*) FROM public.smartpos_payment_intent_events")
                ).scalar_one()
                assert count == 0, (
                    "empty tenant GUC did not fail closed for SmartPOS events: "
                    f"count={count}"
                )
            finally:
                tx.rollback()

        print(
            "Security A OK: tenant RLS normalized, SmartPOS events isolated, "
            "empty tenant fails closed, PUBLIC tenant grants removed."
        )
    finally:
        admin.dispose()
        runtime.dispose()


if __name__ == "__main__":
    main()

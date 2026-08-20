from __future__ import annotations

import json
import os
from pathlib import Path

from sqlalchemy import create_engine, inspect


ADMIN_URL = os.environ["AUDIT_ADMIN_DATABASE_URL"]
REPORT_PATH = Path(
    os.getenv("KOMA_SECURITY_AUDIT_REPORT", "security-audit-report.json")
)

EXPECTED_USER_UNIQUE = ("restaurante_id", "id")
EXPECTED_ACTIVITY_FK = (
    ("restaurante_id", "garcom_id"),
    "usuarios",
    ("restaurante_id", "id"),
)
EXPECTED_SMARTPOS_FK = (
    ("restaurante_id", "operador_id"),
    "usuarios",
    ("restaurante_id", "id"),
)
BLOCKED_FINDING_CODES = {
    "CROSS_TENANT_FK_ACTIVITY_LOG",
    "CROSS_TENANT_FK_SMARTPOS_OPERATOR",
}


def _has_unique(inspector, table: str, columns: tuple[str, ...]) -> bool:
    return any(
        tuple(constraint.get("column_names") or ()) == columns
        for constraint in inspector.get_unique_constraints(table)
    )


def _has_fk(inspector, table: str, expected) -> bool:
    local_columns, referred_table, referred_columns = expected
    for constraint in inspector.get_foreign_keys(table):
        if (
            tuple(constraint.get("constrained_columns") or ()) == local_columns
            and constraint.get("referred_table") == referred_table
            and tuple(constraint.get("referred_columns") or ()) == referred_columns
        ):
            return True
    return False


def main() -> None:
    if not REPORT_PATH.exists():
        raise AssertionError(f"security audit report not found: {REPORT_PATH}")

    report = json.loads(REPORT_PATH.read_text())
    finding_codes = {
        str(item.get("code"))
        for item in report.get("findings", [])
        if item.get("code")
    }
    still_exploitable = sorted(BLOCKED_FINDING_CODES & finding_codes)
    assert not still_exploitable, (
        "cross-tenant user FK probes are still exploitable: "
        f"{still_exploitable}"
    )

    engine = create_engine(ADMIN_URL, pool_pre_ping=True)
    try:
        inspector = inspect(engine)
        assert _has_unique(inspector, "usuarios", EXPECTED_USER_UNIQUE), (
            "usuarios is missing composite tenant/user unique key"
        )
        assert _has_fk(inspector, "activity_logs", EXPECTED_ACTIVITY_FK), (
            "activity_logs is missing tenant-safe garcom FK"
        )
        assert _has_fk(
            inspector,
            "smartpos_payment_intents",
            EXPECTED_SMARTPOS_FK,
        ), "smartpos_payment_intents is missing tenant-safe operador FK"
    finally:
        engine.dispose()

    print(
        "Security B OK: cross-tenant user references are blocked by "
        "composite PostgreSQL foreign keys."
    )


if __name__ == "__main__":
    main()

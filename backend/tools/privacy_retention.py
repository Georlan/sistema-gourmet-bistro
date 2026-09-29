"""Dry-run/apply da minimização de PII redundante.

Exemplo dry-run:
  python backend/tools/privacy_retention.py --restaurant-id 1 --cutoff 2025-01-01T00:00:00+00:00

Apply exige fingerprint, banco, backup e confirmação explícita.
"""

from __future__ import annotations

import argparse
from datetime import datetime
import json
import os
import sys
from pathlib import Path

from sqlalchemy import create_engine

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.privacy_retention import (  # noqa: E402
    CONFIRMATION_PHRASE,
    apply_retention,
    build_retention_plan,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--restaurant-id", type=int, required=True)
    parser.add_argument("--cutoff", required=True, help="ISO-8601 com timezone recomendado")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-database")
    parser.add_argument("--expected-fingerprint")
    parser.add_argument("--confirm")
    parser.add_argument("--backup-reference")
    parser.add_argument("--report-json", type=Path)
    return parser.parse_args()


def _engine():
    url = (
        os.getenv("PRIVACY_RETENTION_DATABASE_URL", "").strip()
        or os.getenv("MIGRATION_DATABASE_URL", "").strip()
    )
    if not url:
        raise SystemExit(
            "Defina PRIVACY_RETENTION_DATABASE_URL ou MIGRATION_DATABASE_URL."
        )
    return create_engine(url, pool_pre_ping=True)


def main() -> int:
    args = parse_args()
    cutoff = datetime.fromisoformat(args.cutoff)
    engine = _engine()
    try:
        if args.apply:
            missing = [
                flag
                for flag, value in (
                    ("--expected-database", args.expected_database),
                    ("--expected-fingerprint", args.expected_fingerprint),
                    ("--confirm", args.confirm),
                    ("--backup-reference", args.backup_reference),
                )
                if not value
            ]
            if missing:
                raise SystemExit("Aplicação bloqueada; flags obrigatórias: " + ", ".join(missing))
            result = apply_retention(
                engine,
                restaurante_id=args.restaurant_id,
                cutoff=cutoff,
                expected_database=args.expected_database,
                expected_fingerprint=args.expected_fingerprint,
                confirmation=args.confirm,
                backup_reference=args.backup_reference,
            )
        else:
            with engine.connect() as connection:
                plan = build_retention_plan(
                    connection,
                    restaurante_id=args.restaurant_id,
                    cutoff=cutoff,
                )
                result = plan.to_dict()
                connection.rollback()
            result["apply_command_template"] = (
                "python backend/tools/privacy_retention.py --apply "
                f"--restaurant-id {args.restaurant_id} "
                f"--cutoff {args.cutoff} "
                f"--expected-database {result['database']} "
                f"--expected-fingerprint {result['fingerprint']} "
                f"--confirm {CONFIRMATION_PHRASE} "
                "--backup-reference <snapshot-id>"
            )

        rendered = json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True)
        print(rendered)
        if args.report_json:
            args.report_json.write_text(rendered + "\n", encoding="utf-8")
        return 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())

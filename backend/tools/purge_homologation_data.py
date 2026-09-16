"""CLI segura para limpar dados históricos mantendo o restaurante 1."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from sqlalchemy import create_engine

from app.services.safe_data_purge import (
    CONFIRMATION_PHRASE,
    apply_purge,
    build_purge_plan,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Executa; sem a flag é somente dry-run.")
    parser.add_argument("--expected-fingerprint")
    parser.add_argument("--expected-database")
    parser.add_argument("--confirm")
    parser.add_argument("--backup-reference")
    parser.add_argument("--report-json", type=Path)
    return parser.parse_args()


def _engine():
    url = os.getenv("PURGE_DATABASE_URL", "").strip() or os.getenv("MIGRATION_DATABASE_URL", "").strip()
    if not url:
        raise SystemExit("Defina PURGE_DATABASE_URL ou MIGRATION_DATABASE_URL com credencial administrativa.")
    return create_engine(url, pool_pre_ping=True)


def main() -> int:
    args = parse_args()
    engine = _engine()
    try:
        if args.apply:
            missing = [
                flag
                for flag, value in (
                    ("--expected-fingerprint", args.expected_fingerprint),
                    ("--expected-database", args.expected_database),
                    ("--confirm", args.confirm),
                    ("--backup-reference", args.backup_reference),
                )
                if not value
            ]
            if missing:
                raise SystemExit("Aplicação bloqueada; flags obrigatórias: " + ", ".join(missing))
            result = apply_purge(
                engine,
                expected_fingerprint=args.expected_fingerprint,
                expected_database=args.expected_database,
                confirmation=args.confirm,
                backup_reference=args.backup_reference,
            )
        else:
            with engine.connect() as connection:
                result = build_purge_plan(connection).to_dict()
                connection.rollback()
            result["apply_command_template"] = (
                "python backend/tools/purge_homologation_data.py --apply "
                f"--expected-database {result['database']} "
                f"--expected-fingerprint {result['fingerprint']} "
                f"--confirm {CONFIRMATION_PHRASE} --backup-reference <SNAPSHOT_ID>"
            )

        rendered = json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True, default=str)
        print(rendered)
        if args.report_json:
            args.report_json.write_text(rendered + "\n", encoding="utf-8")
        return 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())

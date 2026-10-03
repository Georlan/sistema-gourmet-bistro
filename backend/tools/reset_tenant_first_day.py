"""CLI segura para reset operacional tenant-scoped de primeiro dia."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from sqlalchemy import create_engine

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.tenant_first_day_reset import (  # noqa: E402
    CONFIRMATION_PHRASE,
    apply_tenant_first_day_reset,
    build_tenant_first_day_plan,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tenant-id", type=int, required=True)
    parser.add_argument("--expected-name", required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm")
    return parser.parse_args()


def _engine():
    url = (
        os.getenv("MIGRATION_DATABASE_URL", "").strip()
        or os.getenv("DATABASE_URL", "").strip()
    )
    if not url:
        raise SystemExit("Defina MIGRATION_DATABASE_URL ou DATABASE_URL.")
    return create_engine(url, pool_pre_ping=True)


def main() -> int:
    args = parse_args()
    if args.apply:
        raise SystemExit("Reset legado desativado. Clientes reais não podem ser resetados.")
    engine = _engine()
    try:
        if args.apply:
            if args.confirm != CONFIRMATION_PHRASE:
                raise SystemExit(
                    f"Aplicacao bloqueada; use --confirm {CONFIRMATION_PHRASE}"
                )
            result = apply_tenant_first_day_reset(
                engine,
                tenant_id=args.tenant_id,
                expected_name=args.expected_name,
                confirmation=args.confirm,
            )
        else:
            with engine.connect() as connection:
                result = build_tenant_first_day_plan(
                    connection,
                    tenant_id=args.tenant_id,
                    expected_name=args.expected_name,
                ).to_dict()
                connection.rollback()

        print(
            "KOMA_TENANT_FIRST_DAY_RESET="
            + json.dumps(result, ensure_ascii=False, sort_keys=True)
        )
        return 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())

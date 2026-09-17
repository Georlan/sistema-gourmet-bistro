"""CLI segura para limpar dados históricos mantendo o restaurante 1."""

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


def _load_safe_data_purge():
    try:
        from app.services import safe_data_purge as module

        return module
    except RuntimeError:
        # Quando executado em containers/ambientes dedicados de manutenção ou CLI sem segredos
        # de web server (como SECRET_KEY/ENCRYPTION_KEY exigidos por app.config ao carregar o
        # pacote app.services), importa safe_data_purge diretamente pois o serviço depende apenas
        # de SQLAlchemy e reflexão de schema.
        import importlib.util

        target = BACKEND_ROOT / "app" / "services" / "safe_data_purge.py"
        spec = importlib.util.spec_from_file_location("app.services.safe_data_purge", target)
        if spec is None or spec.loader is None:
            raise
        module = importlib.util.module_from_spec(spec)
        sys.modules["app.services.safe_data_purge"] = module
        spec.loader.exec_module(module)
        return module


_safe_data_purge = _load_safe_data_purge()
CONFIRMATION_PHRASE = _safe_data_purge.CONFIRMATION_PHRASE
WAIVE_BACKUP_PHRASE = _safe_data_purge.WAIVE_BACKUP_PHRASE
apply_purge = _safe_data_purge.apply_purge
build_purge_plan = _safe_data_purge.build_purge_plan


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Executa; sem a flag é somente dry-run.")
    parser.add_argument("--expected-fingerprint")
    parser.add_argument("--expected-database")
    parser.add_argument("--confirm")
    parser.add_argument("--backup-reference")
    parser.add_argument("--waive-backup")
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
                )
                if not value
            ]
            if missing:
                raise SystemExit("Aplicação bloqueada; flags obrigatórias: " + ", ".join(missing))
            if not args.backup_reference and not args.waive_backup:
                raise SystemExit(
                    "Aplicação bloqueada; informe --backup-reference ou --waive-backup com confirmação explícita."
                )
            result = apply_purge(
                engine,
                expected_fingerprint=args.expected_fingerprint,
                expected_database=args.expected_database,
                confirmation=args.confirm,
                backup_reference=args.backup_reference or "",
                backup_waiver=args.waive_backup or "",
            )
        else:
            with engine.connect() as connection:
                result = build_purge_plan(connection).to_dict()
                connection.rollback()
            result["apply_command_template"] = (
                "python backend/tools/purge_homologation_data.py --apply "
                f"--expected-database {result['database']} "
                f"--expected-fingerprint {result['fingerprint']} "
                f"--confirm {CONFIRMATION_PHRASE} "
                f"--waive-backup {WAIVE_BACKUP_PHRASE}"
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

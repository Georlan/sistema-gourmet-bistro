"""Rotaciona somente as senhas dos usuários do tenant KÔMA Demo (id=2).

Dry-run por padrão. A escrita exige ``--apply`` e o nome exato do banco.
As senhas são lidas das variáveis KOMA_DEMO_*_PASSWORD e nunca são impressas.
"""

from __future__ import annotations

import argparse
import json
import os

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from tools.provision_demo_restaurant import DEMO_RESTAURANT_ID, DEMO_USERS


MIN_PASSWORD_BYTES = 8
MAX_PASSWORD_BYTES = 72


def _database_url() -> str:
    value = os.getenv("DEMO_DATABASE_URL", "").strip() or os.getenv("MIGRATION_DATABASE_URL", "").strip()
    if not value:
        raise SystemExit("Defina DEMO_DATABASE_URL ou MIGRATION_DATABASE_URL com credencial administrativa.")
    return value


def _database_name(engine) -> str:
    with engine.connect() as connection:
        if connection.dialect.name == "postgresql":
            return str(connection.execute(text("SELECT current_database()")).scalar_one()).strip()
        return str(engine.url.database or ":memory:")


def _passwords() -> dict[str, str]:
    result: dict[str, str] = {}
    invalid: list[str] = []
    for spec in DEMO_USERS:
        env_name = str(spec["password_env"])
        value = os.getenv(env_name, "")
        size = len(value.encode("utf-8"))
        if size < MIN_PASSWORD_BYTES or size > MAX_PASSWORD_BYTES:
            invalid.append(env_name)
        else:
            result[env_name] = value
    if invalid:
        raise RuntimeError(
            f"Senhas da demo ausentes ou fora do intervalo de {MIN_PASSWORD_BYTES} a {MAX_PASSWORD_BYTES} bytes: "
            + ", ".join(invalid)
        )
    return result


def _imports():
    os.environ.setdefault("DATABASE_URL", _database_url())
    from app.models import Usuario
    from app.security import get_password_hash, verify_password

    return Usuario, get_password_hash, verify_password


def build_plan(engine) -> dict[str, object]:
    Usuario, _, _ = _imports()
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    with Session() as db:
        users = db.query(Usuario).filter(Usuario.restaurante_id == DEMO_RESTAURANT_ID).all()
        found_ids = sorted(str(user.id) for user in users)
    return {
        "mode": "dry-run",
        "database": _database_name(engine),
        "restaurant_id": DEMO_RESTAURANT_ID,
        "expected_user_ids": sorted(str(spec["id"]) for spec in DEMO_USERS),
        "found_user_ids": found_ids,
    }


def apply_passwords(engine, *, expected_database: str, passwords: dict[str, str]) -> dict[str, object]:
    Usuario, get_password_hash, verify_password = _imports()
    database = _database_name(engine)
    if database != expected_database:
        raise RuntimeError(f"Banco atual {database!r} diverge do banco confirmado {expected_database!r}.")

    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    with Session.begin() as db:
        users = []
        for spec in DEMO_USERS:
            user = db.query(Usuario).filter(Usuario.id == spec["id"]).one_or_none()
            if user is None:
                raise RuntimeError(f"Usuário demo ausente: {spec['id']}")
            if int(user.restaurante_id) != DEMO_RESTAURANT_ID or user.email != spec["email"]:
                raise RuntimeError(f"Trava de segurança: identidade divergente para {spec['id']}")
            env_name = str(spec["password_env"])
            user.senha_hash = get_password_hash(passwords[env_name])
            users.append((user, passwords[env_name]))
        db.flush()
        if not all(verify_password(password, user.senha_hash) for user, password in users):
            raise RuntimeError("Validação dos hashes da demo falhou.")

    return {
        "mode": "apply",
        "validation": "passed",
        "database": database,
        "restaurant_id": DEMO_RESTAURANT_ID,
        "updated_users": [str(spec["id"]) for spec in DEMO_USERS],
        "passwords": "stored_only_as_hashes; source values remain only in Railway variables",
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-database")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    url = _database_url()
    os.environ.setdefault("DATABASE_URL", url)
    engine = create_engine(url, pool_pre_ping=True)
    try:
        if args.apply:
            if not args.expected_database:
                raise SystemExit("--expected-database é obrigatório com --apply.")
            result = apply_passwords(engine, expected_database=args.expected_database, passwords=_passwords())
        else:
            result = build_plan(engine)
            result["apply_command_template"] = (
                "python -m tools.set_demo_passwords --apply "
                f"--expected-database {result['database']}"
            )
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())

"""Cria ou atualiza de forma idempotente um login operacional de equipe.

Dry-run por padrão. A escrita exige --apply, o nome exato do banco e a senha
em variável de ambiente. A senha e seu hash nunca são impressos.
"""

from __future__ import annotations

import argparse
import json
import os

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker


MIN_PASSWORD_BYTES = 8
MAX_PASSWORD_BYTES = 72
DEFAULT_PASSWORD_ENV = "KOMA_STAFF_LOGIN_PASSWORD"
ALLOWED_ROLES = ("admin", "gerente", "caixa", "garcom", "motoboy")


def _database_url() -> str:
    value = (
        os.getenv("STAFF_LOGIN_DATABASE_URL", "").strip()
        or os.getenv("MIGRATION_DATABASE_URL", "").strip()
    )
    if not value:
        raise SystemExit(
            "Defina STAFF_LOGIN_DATABASE_URL ou MIGRATION_DATABASE_URL "
            "com credencial administrativa."
        )
    return value


def _database_name(engine) -> str:
    with engine.connect() as connection:
        if connection.dialect.name == "postgresql":
            return str(
                connection.execute(text("SELECT current_database()")).scalar_one()
            ).strip()
        return str(engine.url.database or ":memory:")


def _imports():
    os.environ.setdefault("DATABASE_URL", _database_url())
    from app.models import Restaurante, Usuario
    from app.security import get_password_hash, verify_password

    return Restaurante, Usuario, get_password_hash, verify_password


def _read_password(env_name: str) -> str:
    value = os.getenv(env_name, "")
    size = len(value.encode("utf-8"))
    if size < MIN_PASSWORD_BYTES or size > MAX_PASSWORD_BYTES:
        raise RuntimeError(
            f"A senha em {env_name} deve possuir entre "
            f"{MIN_PASSWORD_BYTES} e {MAX_PASSWORD_BYTES} bytes."
        )
    return value


def _normalize_email(email: str) -> str:
    normalized = email.strip().lower()
    if not normalized or "@" not in normalized:
        raise ValueError("Informe um e-mail válido.")
    return normalized


def build_plan(
    engine,
    *,
    tenant_id: int,
    email: str,
    role: str,
    name: str,
) -> dict[str, object]:
    Restaurante, Usuario, _, _ = _imports()
    email = _normalize_email(email)
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    with Session() as db:
        restaurant = db.query(Restaurante).filter(Restaurante.id == tenant_id).one_or_none()
        user = (
            db.query(Usuario)
            .filter(
                Usuario.restaurante_id == tenant_id,
                Usuario.email == email,
            )
            .one_or_none()
        )

    return {
        "mode": "dry-run",
        "database": _database_name(engine),
        "tenant_id": tenant_id,
        "restaurant_exists": restaurant is not None,
        "restaurant_name": restaurant.nome if restaurant is not None else None,
        "email": email,
        "requested_name": name,
        "requested_role": role,
        "user_exists": user is not None,
        "existing_user_id": str(user.id) if user is not None else None,
        "existing_status": user.status if user is not None else None,
        "existing_role": user.cargo if user is not None else None,
    }


def apply_staff_login(
    engine,
    *,
    expected_database: str,
    tenant_id: int,
    email: str,
    role: str,
    name: str,
    password: str,
) -> dict[str, object]:
    Restaurante, Usuario, get_password_hash, verify_password = _imports()
    email = _normalize_email(email)

    if tenant_id <= 0:
        raise ValueError("tenant_id deve ser positivo.")
    if role not in ALLOWED_ROLES:
        raise ValueError(f"Cargo inválido: {role!r}.")
    password_size = len(password.encode("utf-8"))
    if password_size < MIN_PASSWORD_BYTES or password_size > MAX_PASSWORD_BYTES:
        raise ValueError(
            f"A senha deve possuir entre {MIN_PASSWORD_BYTES} e "
            f"{MAX_PASSWORD_BYTES} bytes."
        )

    database = _database_name(engine)
    if database != expected_database:
        raise RuntimeError(
            f"Banco atual {database!r} diverge do banco confirmado "
            f"{expected_database!r}."
        )

    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    with Session.begin() as db:
        restaurant = (
            db.query(Restaurante)
            .filter(Restaurante.id == tenant_id)
            .one_or_none()
        )
        if restaurant is None:
            raise RuntimeError(
                f"Trava de segurança: restaurante id={tenant_id} não existe."
            )

        user = (
            db.query(Usuario)
            .filter(
                Usuario.restaurante_id == tenant_id,
                Usuario.email == email,
            )
            .one_or_none()
        )
        action = "updated" if user is not None else "created"

        if user is None:
            user = Usuario(
                restaurante_id=tenant_id,
                nome=name.strip() or "Operador",
                email=email,
                cargo=role,
                status="ativo",
            )
            db.add(user)
        else:
            user.nome = name.strip() or user.nome
            user.cargo = role
            user.status = "ativo"

        user.senha_hash = get_password_hash(password)
        user.token_convite = None
        user.token_expira_em = None
        db.flush()

        if not verify_password(password, user.senha_hash):
            raise RuntimeError("Validação do hash recém-gravado falhou.")

        result = {
            "mode": "apply",
            "validation": "passed",
            "action": action,
            "database": database,
            "tenant_id": tenant_id,
            "restaurant_name": restaurant.nome,
            "user_id": str(user.id),
            "email": user.email,
            "role": user.cargo,
            "status": user.status,
            "password_verified": True,
            "passwords": "stored_only_as_hashes; source value remains only in environment",
        }

    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-database")
    parser.add_argument("--tenant-id", type=int, required=True)
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", default="Operador")
    parser.add_argument("--role", choices=ALLOWED_ROLES, required=True)
    parser.add_argument("--password-env", default=DEFAULT_PASSWORD_ENV)
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
            result = apply_staff_login(
                engine,
                expected_database=args.expected_database,
                tenant_id=args.tenant_id,
                email=args.email,
                role=args.role,
                name=args.name,
                password=_read_password(args.password_env),
            )
        else:
            result = build_plan(
                engine,
                tenant_id=args.tenant_id,
                email=args.email,
                role=args.role,
                name=args.name,
            )
            result["apply_command_template"] = (
                "python -m tools.ensure_staff_login --apply "
                f"--expected-database {result['database']} "
                f"--tenant-id {args.tenant_id} --email {args.email} "
                f"--name {json.dumps(args.name, ensure_ascii=False)} "
                f"--role {args.role}"
            )
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())

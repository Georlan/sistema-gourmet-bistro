"""Read-only backup of Kôma-owned schemas; never restores into any database.

Requires PostgreSQL client tools and backend Python dependencies. Supply a
session/direct administrative connection through the hidden prompt or the
KOMA_BACKUP_DATABASE_URL environment variable, never as a command argument.
"""
import argparse
from datetime import datetime, timezone
import getpass
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

import psycopg2
from psycopg2 import sql
from psycopg2.extensions import make_dsn, parse_dsn


SCHEMAS = ("public", "koma_internal")


def backup(output_dir: Path, connection_url: str) -> Path:
    for command in ("pg_dump", "pg_restore"):
        if not shutil.which(command):
            raise RuntimeError(f"Instale os utilitários PostgreSQL: {command} ausente.")
    output_dir.mkdir(parents=True, exist_ok=True)
    folder = output_dir / datetime.now(timezone.utc).strftime("koma-%Y%m%dT%H%M%S.%fZ")
    folder.mkdir(mode=0o700)
    archive = folder / "application.dump"
    connection_url = connection_url.replace("postgresql+psycopg2://", "postgresql://", 1)
    parameters = parse_dsn(connection_url)
    if parameters.get("host", "") not in ("", "localhost", "127.0.0.1", "::1"):
        if parameters.get("sslmode") not in ("require", "verify-ca", "verify-full"):
            parameters["sslmode"] = "require"
    if parameters.get("sslpassword"):
        raise RuntimeError("Use autenticação de backup com senha de banco; senhas de chave SSL não são aceitas neste script.")
    connection_url = make_dsn(**parameters)
    db = psycopg2.connect(connection_url, connect_timeout=10)
    try:
        db.set_session(isolation_level="REPEATABLE READ", readonly=True)
        with db.cursor() as cursor:
            cursor.execute("SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user")
            if not cursor.fetchone()[0]:
                raise RuntimeError("Use a conexão administrativa de backup, não a role limitada da aplicação.")
            cursor.execute("SELECT pg_export_snapshot(), current_setting('server_version')")
            snapshot, version = cursor.fetchone()
            cursor.execute("""SELECT schemaname, tablename FROM pg_tables
                              WHERE schemaname = ANY(%s) ORDER BY 1, 2""", (list(SCHEMAS),))
            tables = cursor.fetchall()
            counts = {}
            for schema, table in tables:
                cursor.execute(sql.SQL("SELECT count(*) FROM {}.{}").format(sql.Identifier(schema), sql.Identifier(table)))
                counts[f"{schema}.{table}"] = cursor.fetchone()[0]
            parameters = parse_dsn(connection_url)
            password = parameters.pop("password", "")
            environment = {key: value for key, value in os.environ.items()
                           if not key.startswith("PG") and key != "KOMA_BACKUP_DATABASE_URL"}
            environment.update(PGPASSWORD=password, PGCONNECT_TIMEOUT="10")
            command = ["pg_dump", "--dbname", make_dsn(**parameters), "--no-password",
                       "--format=custom", "--lock-wait-timeout=5s", "--snapshot", snapshot,
                       "--file", str(archive)]
            for schema in SCHEMAS:
                command += ["--schema", schema]
            result = subprocess.run(command, env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            if result.returncode:
                archive.unlink(missing_ok=True)
                raise RuntimeError("Backup não concluído. Verifique conexão, permissões e versão do pg_dump; nenhum backup foi validado.")
        listing = subprocess.run(["pg_restore", "--list", str(archive)], capture_output=True)
        if listing.returncode or not archive.stat().st_size:
            raise RuntimeError("O arquivo gerado não passou na verificação de leitura.")
        archive.chmod(0o600)
        with archive.open("rb") as content:
            digest = hashlib.file_digest(content, "sha256").hexdigest()
        manifest = {"created_at_utc": datetime.now(timezone.utc).isoformat(), "postgres_version": version,
                    "schemas": list(SCHEMAS), "table_counts": counts, "archive": archive.name,
                    "sha256": digest, "restore_tested": False,
                    "excludes": ["Supabase managed schemas", "Storage image files", "Railway environment secrets", "local print journals"]}
        (folder / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        (folder / "manifest.json").chmod(0o600)
        return folder
    finally:
        db.rollback()
        db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    connection_url = os.environ.get("KOMA_BACKUP_DATABASE_URL") or getpass.getpass("Conexão administrativa do banco (oculta): ")
    try:
        folder = backup(args.output_dir, connection_url)
    except Exception as exc:
        # Database exceptions can carry host/account details. Never echo DSNs.
        print(str(exc) if isinstance(exc, RuntimeError) else "Backup não concluído; confira conexão, acesso à pasta e PostgreSQL instalado.")
        return 1
    print(f"Cópia criada em {folder}. A restauração ainda precisa ser testada em banco separado.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

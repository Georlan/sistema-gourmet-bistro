import importlib.util
from pathlib import Path
from subprocess import CompletedProcess
from unittest.mock import MagicMock

import pytest
from psycopg2.extensions import parse_dsn

spec = importlib.util.spec_from_file_location("manual_backup", Path(__file__).parents[2] / "scripts/manual_database_backup.py")
backup_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup_module)


def setup_backup(monkeypatch, *, privileged=True, dump_fails=False):
    db, cursor = MagicMock(), MagicMock()
    db.cursor.return_value.__enter__.return_value = cursor
    cursor.fetchone.side_effect = [(privileged,), ("snapshot", "17"), (2,)]
    cursor.fetchall.return_value = [("public", "orders")]
    connect = MagicMock(return_value=db)
    monkeypatch.setattr(backup_module.psycopg2, "connect", connect)
    monkeypatch.setattr(backup_module.shutil, "which", lambda name: "/tools/" + name)
    calls = []

    def execute(command, **kwargs):
        calls.append((command, kwargs))
        if command[0] == "pg_dump":
            Path(command[command.index("--file") + 1]).write_bytes(b"test archive")
            return CompletedProcess(command, int(dump_fails))
        return CompletedProcess(command, 0, stdout=b"archive listing")

    monkeypatch.setattr(backup_module.subprocess, "run", execute)
    return connect, calls


def test_remote_backup_requires_tls_and_keeps_password_out_of_arguments(tmp_path, monkeypatch):
    connect, calls = setup_backup(monkeypatch)
    folder = backup_module.backup(tmp_path, "postgresql://admin:private-test-password@db.example.test/postgres?sslmode=disable")
    assert parse_dsn(connect.call_args.args[0])["sslmode"] == "require"
    assert "private-test-password" not in str(calls[0][0])
    assert calls[0][1]["env"]["PGPASSWORD"] == "private-test-password"
    assert "--snapshot" in calls[0][0]
    assert "private-test-password" not in (folder / "manifest.json").read_text()


def test_failed_dump_is_not_reported_as_a_valid_backup(tmp_path, monkeypatch):
    setup_backup(monkeypatch, dump_fails=True)
    with pytest.raises(RuntimeError, match="Backup não concluído"):
        backup_module.backup(tmp_path, "postgresql://admin:local-test@localhost/test")
    assert not list(tmp_path.rglob("manifest.json"))
    assert not list(tmp_path.rglob("*.dump"))


def test_restricted_role_cannot_make_a_partial_backup(tmp_path, monkeypatch):
    _, calls = setup_backup(monkeypatch, privileged=False)
    with pytest.raises(RuntimeError, match="conexão administrativa"):
        backup_module.backup(tmp_path, "postgresql://runtime:local-test@localhost/test")
    assert calls == []

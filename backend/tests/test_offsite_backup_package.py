import hashlib
import importlib.util
import io
import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest


spec = importlib.util.spec_from_file_location(
    "offsite_backup_package",
    Path(__file__).parents[2] / "scripts/offsite_backup_package.py",
)
package_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package_module)


class CapturingStdin(io.BytesIO):
    snapshot = b""

    def close(self):
        self.snapshot = self.getvalue()
        super().close()


class BrokenPipeStdin(CapturingStdin):
    def write(self, data):
        raise BrokenPipeError("age rejected stream")


class FakeAgeProcess:
    def __init__(self, command, *, returncode=0, stdin=None):
        self.command = command
        self.returncode = returncode
        self.stdin = stdin or CapturingStdin()
        self.stderr = io.BytesIO(b"age test error" if returncode else b"")
        self._polled = None

    def wait(self):
        if self.returncode == 0:
            output = Path(self.command[self.command.index("--output") + 1])
            output.write_bytes(b"encrypted-age-test-payload")
        self._polled = self.returncode
        return self.returncode

    def poll(self):
        return self._polled

    def terminate(self):
        self.returncode = 143
        self._polled = 143


def make_backup(tmp_path: Path) -> Path:
    backup_dir = tmp_path / "koma-20260906T220000Z"
    backup_dir.mkdir()
    archive = backup_dir / "application.dump"
    archive.write_bytes(b"validated database dump")
    manifest = {
        "archive": archive.name,
        "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
        "restore_tested": True,
    }
    (backup_dir / "manifest.json").write_text(
        json.dumps(manifest),
        encoding="utf-8",
    )
    return backup_dir


def test_package_validates_source_streams_to_age_and_emits_verifiable_sidecars(
    tmp_path,
    monkeypatch,
):
    backup_dir = make_backup(tmp_path)
    processes = []

    def fake_popen(command, **kwargs):
        process = FakeAgeProcess(command)
        processes.append((process, kwargs))
        return process

    monkeypatch.setattr(package_module.shutil, "which", lambda name: "/tools/age")
    monkeypatch.setattr(package_module.subprocess, "Popen", fake_popen)

    package, checksum, metadata = package_module.package_backup(
        backup_dir,
        tmp_path / "offsite",
        "age1public-recipient-for-test",
    )

    assert package.read_bytes() == b"encrypted-age-test-payload"
    package_module.verify_package(package, checksum)

    process, kwargs = processes[0]
    assert process.command[:4] == [
        "/tools/age",
        "--encrypt",
        "--recipient",
        "age1public-recipient-for-test",
    ]
    assert kwargs["stdin"] == package_module.subprocess.PIPE
    assert kwargs["stdout"] == package_module.subprocess.DEVNULL

    import tarfile

    with tarfile.open(fileobj=io.BytesIO(process.stdin.snapshot), mode="r:gz") as bundle:
        assert sorted(bundle.getnames()) == [
            "koma-20260906T220000Z/application.dump",
            "koma-20260906T220000Z/manifest.json",
        ]

    payload = json.loads(metadata.read_text(encoding="utf-8"))
    assert payload["encryption"] == "age-recipient"
    assert payload["source_restore_tested"] is True
    assert payload["age_recipient"] == "age1public-recipient-for-test"
    assert payload["encrypted_package_sha256"] == package_module.sha256_file(package)
    assert not list((tmp_path / "offsite").glob(".*.tmp"))


def test_package_refuses_tampered_database_dump_before_starting_age(tmp_path, monkeypatch):
    backup_dir = make_backup(tmp_path)
    (backup_dir / "application.dump").write_bytes(b"tampered")
    popen = MagicMock()
    monkeypatch.setattr(package_module.shutil, "which", lambda name: "/tools/age")
    monkeypatch.setattr(package_module.subprocess, "Popen", popen)

    with pytest.raises(RuntimeError, match="não confere"):
        package_module.package_backup(
            backup_dir,
            tmp_path / "offsite",
            "age1public-recipient-for-test",
        )

    popen.assert_not_called()


def test_age_failure_leaves_no_package_that_looks_valid(tmp_path, monkeypatch):
    backup_dir = make_backup(tmp_path)
    processes = []

    def fake_popen(command, **kwargs):
        process = FakeAgeProcess(command, returncode=1)
        processes.append(process)
        return process

    monkeypatch.setattr(package_module.shutil, "which", lambda name: "/tools/age")
    monkeypatch.setattr(package_module.subprocess, "Popen", fake_popen)

    output_dir = tmp_path / "offsite"
    with pytest.raises(RuntimeError, match="Falha ao criptografar"):
        package_module.package_backup(
            backup_dir,
            output_dir,
            "age1public-recipient-for-test",
        )

    assert processes
    assert not list(output_dir.glob("*.age"))
    assert not list(output_dir.glob("*.sha256"))
    assert not list(output_dir.glob("*.metadata.json"))
    assert not list(output_dir.glob(".*.tmp"))


def test_age_early_rejection_is_wrapped_and_leaves_no_partial_output(tmp_path, monkeypatch):
    backup_dir = make_backup(tmp_path)

    def fake_popen(command, **kwargs):
        process = FakeAgeProcess(command, returncode=2, stdin=BrokenPipeStdin())
        process._polled = 2
        return process

    monkeypatch.setattr(package_module.shutil, "which", lambda name: "/tools/age")
    monkeypatch.setattr(package_module.subprocess, "Popen", fake_popen)

    output_dir = tmp_path / "offsite"
    with pytest.raises(RuntimeError, match="Falha ao preparar pacote criptografado"):
        package_module.package_backup(
            backup_dir,
            output_dir,
            "recipient-invalido",
        )

    assert not list(output_dir.glob("*.age"))
    assert not list(output_dir.glob("*.sha256"))
    assert not list(output_dir.glob("*.metadata.json"))
    assert not list(output_dir.glob(".*.tmp"))


def test_package_never_silently_overwrites_existing_offsite_copy(tmp_path, monkeypatch):
    backup_dir = make_backup(tmp_path)
    output_dir = tmp_path / "offsite"
    output_dir.mkdir()
    (output_dir / f"{backup_dir.name}.tar.gz.age").write_bytes(b"existing")
    monkeypatch.setattr(package_module.shutil, "which", lambda name: "/tools/age")

    with pytest.raises(RuntimeError, match="Não sobrescreva"):
        package_module.package_backup(
            backup_dir,
            output_dir,
            "age1public-recipient-for-test",
        )


def test_verify_detects_corruption_after_external_copy(tmp_path):
    package = tmp_path / "backup.tar.gz.age"
    package.write_bytes(b"original encrypted bytes")
    checksum = tmp_path / "backup.tar.gz.age.sha256"
    checksum.write_text(
        f"{package_module.sha256_file(package)}  {package.name}\n",
        encoding="utf-8",
    )

    copied = tmp_path / "external"
    copied.mkdir()
    copied_package = copied / package.name
    copied_checksum = copied / checksum.name
    copied_package.write_bytes(package.read_bytes() + b"corruption")
    copied_checksum.write_text(checksum.read_text(encoding="utf-8"), encoding="utf-8")

    with pytest.raises(RuntimeError, match="não confere"):
        package_module.verify_package(copied_package, copied_checksum)

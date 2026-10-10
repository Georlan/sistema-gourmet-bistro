"""O pacote privado nao deve incluir codigo do backend, testes ou credenciais."""
from pathlib import Path
import subprocess
import sys
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]


def test_print_distribution_allowlist(tmp_path):
    output = tmp_path / "KOMA-print-agent.zip"
    subprocess.run(
        [sys.executable, str(ROOT / "scripts/package_print_agent.py"), "--output", str(output)],
        check=True,
        capture_output=True,
        text=True,
    )
    with ZipFile(output) as archive:
        names = set(archive.namelist())
        assert len(names) == len(archive.namelist())
        assert archive.testzip() is None

    expected = {
        "LICENSE",
        "INSTALAR-KOMA-WINDOWS.cmd",
        "ATUALIZAR-KOMA-WINDOWS.cmd",
        "DESINSTALAR-KOMA-WINDOWS.cmd",
        "VERIFICAR-KOMA-WINDOWS.cmd",
        "print-agent/main.py",
        "print-agent/install-windows.ps1",
        "print-agent/install-linux.sh",
        "print-agent/check-windows.ps1",
        "print-agent/koma-print-launcher.sh",
        "print-agent/hardware_preflight.py",
        "print-agent/requirements.txt",
        "print-agent/requirements.lock",
        "print-agent/adapters/windows.py",
        "print-agent/adapters/linux.py",
    }
    assert expected <= names
    assert all(
        name in expected
        or name.startswith("print-agent/")
        and not name.startswith("print-agent/tests/")
        and (name.endswith((".py", ".ps1", ".sh")) or name in {
            "print-agent/README.md", "print-agent/requirements.txt",
            "print-agent/requirements.lock",
        })
        for name in names
    )
    assert not any(
        name.startswith(("backend/", "src/", ".github/", "scripts/"))
        or name.endswith((".env", ".key", ".pem", ".pfx", "credentials.json", "config.json"))
        for name in names
    )


def test_installers_do_not_require_public_repository():
    for installer in ("print-agent/install-windows.ps1", "print-agent/install-linux.sh"):
        text = (ROOT / installer).read_text(encoding="utf-8")
        assert "github.com/Georlan/sistema-gourmet-bistro" not in text
        assert "raw.githubusercontent.com" not in text
        assert "Pacote local do KOMA Print Agent" in text


def test_manifest_is_explicit_and_zip_deterministic(tmp_path):
    """Novos .py, .sh ou .ps1 nunca podem entrar automaticamente numa release."""
    import runpy

    manifest = runpy.run_path(str(ROOT / "scripts/package_print_agent.py"))
    approved = {
        *manifest["ROOT_FILES"],
        *(f"print-agent/{name}" for name in manifest["AGENT_FILES"]),
        *(f"print-agent/adapters/{name}" for name in manifest["ADAPTER_FILES"]),
    }
    files = manifest["package_files"]()
    assert {path.relative_to(ROOT).as_posix() for path in files} == approved

    outputs = [tmp_path / "a.zip", tmp_path / "b.zip"]
    for path in outputs:
        manifest["build_bundle"](path)
    assert outputs[0].read_bytes() == outputs[1].read_bytes()
    with ZipFile(outputs[0]) as archive:
        assert set(archive.namelist()) == approved


def test_public_publisher_is_manual_and_never_pushes_private_source():
    publish = (ROOT / ".github/workflows/print-agent-public-release.yml").read_text(encoding="utf-8")
    assert "workflow_dispatch:" in publish
    assert "if: github.ref == 'refs/heads/main'" in publish
    assert "environment: print-agent-public-release" in publish
    assert "KOMA_PRINT_AGENT_DISTRIBUTION_TOKEN" in publish
    assert "KOMA_PRINT_AGENT_DISTRIBUTION_REPO" in publish
    assert "gh release create" in publish
    assert "dist/KOMA-print-agent.zip" in publish
    assert "dist/KOMA-print-agent.zip.sha256" in publish
    assert "gh api" in publish
    assert "github.com/Georlan/sistema-gourmet-bistro" not in publish
    assert "git push" not in publish

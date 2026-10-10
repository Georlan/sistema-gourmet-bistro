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

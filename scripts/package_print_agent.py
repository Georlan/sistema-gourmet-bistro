#!/usr/bin/env python3
"""Empacota somente arquivos aprovados do Print Agent, nunca a arvore do KOMA."""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
AGENT = ROOT / "print-agent"

# Manifesto fechado: arquivos novos NAO entram automaticamente no pacote publico.
ROOT_FILES = (
    "INSTALAR-KOMA-WINDOWS.cmd",
    "ATUALIZAR-KOMA-WINDOWS.cmd",
    "DESINSTALAR-KOMA-WINDOWS.cmd",
    "VERIFICAR-KOMA-WINDOWS.cmd",
    "LICENSE",
)
AGENT_FILES = (
    "README.md",
    "agent.py",
    "agent_runtime.py",
    "api_client.py",
    "check-windows.ps1",
    "config.py",
    "dispatcher.py",
    "endpoints.py",
    "hardware_preflight.py",
    "install-linux.sh",
    "install-windows.ps1",
    "journal.py",
    "koma-print-launcher.ps1",
    "koma-print-launcher.sh",
    "main.py",
    "pairing.py",
    "printer_profiles.py",
    "requirements.lock",
    "requirements.txt",
    "retry_budget.py",
    "simulator.py",
    "wake_listener.py",
    "worker.py",
)
ADAPTER_FILES = (
    "__init__.py",
    "base.py",
    "escpos.py",
    "file.py",
    "linux.py",
    "transports.py",
    "windows.py",
)


def package_files() -> list[Path]:
    files = [ROOT / name for name in ROOT_FILES]
    files.extend(AGENT / name for name in AGENT_FILES)
    files.extend(AGENT / "adapters" / name for name in ADAPTER_FILES)
    for path in files:
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"Entrada ausente ou invalida: {path.relative_to(ROOT)}")
    return sorted(files, key=lambda path: path.relative_to(ROOT).as_posix())


def build_bundle(output: Path) -> str:
    files = package_files()
    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            name = path.relative_to(ROOT).as_posix()
            info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = (0o100644 << 16)
            archive.writestr(info, path.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)
    return hashlib.sha256(output.read_bytes()).hexdigest()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Empacotar o KOMA Print Agent para distribuicao")
    parser.add_argument("--output", type=Path, default=ROOT / "dist/KOMA-print-agent.zip")
    args = parser.parse_args()
    digest = build_bundle(args.output)
    print(f"Pacote: {args.output}")
    print(f"SHA256: {digest}")

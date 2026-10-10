#!/usr/bin/env python3
"""Gera distribuicao controlada do Print Agent sem publicar o backend.

A lista de entradas e deliberadamente restrita; nao use zip recursivo do repo.
"""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
AGENT = ROOT / "print-agent"
ROOT_FILES = (
    "INSTALAR-KOMA-WINDOWS.cmd",
    "ATUALIZAR-KOMA-WINDOWS.cmd",
    "DESINSTALAR-KOMA-WINDOWS.cmd",
    "VERIFICAR-KOMA-WINDOWS.cmd",
    "LICENSE",
)
AGENT_FILES = {"README.md", "requirements.txt", "requirements.lock"}
ALLOWED_SUFFIXES = {".py", ".ps1", ".sh"}


def package_files() -> list[Path]:
    files = [ROOT / name for name in ROOT_FILES]
    files.extend(
        path for path in AGENT.iterdir()
        if path.is_file()
        and (path.suffix in ALLOWED_SUFFIXES or path.name in AGENT_FILES)
    )
    files.extend(path for path in (AGENT / "adapters").glob("*.py") if path.is_file())
    files = sorted(files, key=lambda path: path.relative_to(ROOT).as_posix())
    for path in files:
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"Entrada invalida no pacote: {path.relative_to(ROOT)}")
    return files


def build_bundle(output: Path) -> str:
    files = package_files()
    if not (AGENT / "main.py") in files or not (AGENT / "install-windows.ps1") in files:
        raise RuntimeError("Print Agent incompleto; distribuicao cancelada.")
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
    parser = argparse.ArgumentParser(description="Empacotar Print Agent para distribuicao privada")
    parser.add_argument("--output", type=Path, default=ROOT / "dist/KOMA-print-agent.zip")
    args = parser.parse_args()
    digest = build_bundle(args.output)
    print(f"Pacote: {args.output}")
    print(f"SHA256: {digest}")

#!/usr/bin/env python3
"""Fail-closed preflight for first-client thermal-printer acceptance."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path
from typing import Any

from adapters import get_adapter


def _is_ready(printer: dict[str, Any]) -> bool:
    return bool(
        printer.get("available")
        and printer.get("present")
        and printer.get("configured")
    )


def build_preflight_report(
    diagnostics: dict[str, Any],
    requested_printer: str = "",
) -> dict[str, Any]:
    printers = diagnostics.get("printers") or []
    requested = requested_printer.strip()
    ready_printers = [printer for printer in printers if _is_ready(printer)]
    if requested:
        ready_printers = [
            printer
            for printer in ready_printers
            if requested in {
                str(printer.get("name") or ""),
                str(printer.get("uri") or ""),
            }
        ]

    configured_but_absent = [
        str(printer.get("name") or printer.get("uri") or "desconhecida")
        for printer in printers
        if printer.get("configured") and not printer.get("present")
    ]
    passed = bool(ready_printers)
    if passed:
        reason = "Há impressora física presente, configurada e disponível."
    elif configured_but_absent:
        reason = (
            "Há fila configurada, mas o equipamento físico não está presente: "
            + ", ".join(configured_but_absent)
        )
    elif requested:
        reason = f"A impressora solicitada não está pronta: {requested}"
    else:
        reason = "Nenhuma impressora física presente, configurada e disponível."

    return {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": "PASSED" if passed else "BLOCKED",
        "reason": reason,
        "requested_printer": requested or None,
        "ready_printers": [
            {
                "name": printer.get("name"),
                "uri": printer.get("uri"),
                "connection": printer.get("connection"),
                "is_default": bool(printer.get("is_default")),
            }
            for printer in ready_printers
        ],
        "configured_but_absent": configured_but_absent,
        "diagnostics": diagnostics,
        "scope": (
            "Este preflight valida presença local. O aceite final exige criar o "
            "PrintJob pelo Kôma, confirmar o status no monitor e conferir o papel."
        ),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Valida se existe impressora física pronta sem confundir uma fila "
            "CUPS/Spooler antiga com hardware conectado."
        )
    )
    parser.add_argument(
        "--adapter",
        default="auto",
        choices=("auto", "linux", "windows"),
    )
    parser.add_argument("--printer", default="")
    parser.add_argument("--report", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    adapter = get_adapter(args.adapter)
    report = build_preflight_report(adapter.get_diagnostics(), args.printer)
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    print(rendered)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(rendered + "\n", encoding="utf-8")
    return 0 if report["status"] == "PASSED" else 2


if __name__ == "__main__":
    sys.exit(main())

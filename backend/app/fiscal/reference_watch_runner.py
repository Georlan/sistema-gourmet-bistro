from __future__ import annotations

import json
import logging
import os

from ..database import SessionLocal
from .reference_watch import (
    NCM_JSON_URL,
    RTC_LOCAL_BASE_URL,
    FiscalReferenceWatchError,
    probe_local_rtc_calculator,
    probe_official_ncm,
    record_probe,
    record_probe_error,
)


logger = logging.getLogger("koma.fiscal.reference_watch")


def run_reference_watch() -> dict[str, object]:
    """Executa uma rodada do watcher oficial.

    NCM é sempre observado. A Calculadora RTC local é observada quando o
    componente estiver habilitado no ambiente, evitando tratar uma dependência
    ainda não implantada como incidente.
    """

    db = SessionLocal()
    results: list[dict[str, object]] = []
    errors: list[dict[str, str]] = []
    try:
        try:
            probe = probe_official_ncm()
            synced = record_probe(db, probe)
            results.append(
                {
                    "sourceKey": synced.source_key,
                    "status": synced.status,
                    "changed": synced.changed,
                    "version": synced.source_version,
                    "sha256": synced.content_sha256,
                    "metadata": synced.metadata,
                }
            )
        except FiscalReferenceWatchError as exc:
            record_probe_error(db, "rfb-ncm-json", NCM_JSON_URL, exc)
            errors.append({"sourceKey": "rfb-ncm-json", "error": str(exc)})

        rtc_enabled = os.getenv("KOMA_RTC_CALCULATOR_WATCH_ENABLED", "false").lower() == "true"
        if rtc_enabled:
            try:
                probe = probe_local_rtc_calculator()
                synced = record_probe(db, probe)
                results.append(
                    {
                        "sourceKey": synced.source_key,
                        "status": synced.status,
                        "changed": synced.changed,
                        "version": synced.source_version,
                        "sha256": synced.content_sha256,
                        "metadata": synced.metadata,
                    }
                )
            except FiscalReferenceWatchError as exc:
                record_probe_error(
                    db,
                    "rfb-rtc-calculator-local",
                    f"{RTC_LOCAL_BASE_URL}/dados-abertos/versao",
                    exc,
                )
                errors.append(
                    {"sourceKey": "rfb-rtc-calculator-local", "error": str(exc)}
                )

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    return {
        "ok": not errors,
        "changed": any(bool(item.get("changed")) for item in results),
        "results": results,
        "errors": errors,
    }


def main() -> int:
    outcome = run_reference_watch()
    print(json.dumps(outcome, ensure_ascii=False, sort_keys=True))
    if outcome["errors"]:
        return 1
    if outcome["changed"]:
        # Mudança oficial precisa aparecer como sinal operacional, nunca passar
        # despercebida. O estado já foi persistido como `changed`.
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

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


def _sync_payload(synced) -> dict[str, object]:
    return {
        "sourceKey": synced.source_key,
        "status": synced.status,
        "changed": synced.changed,
        "observedVersion": synced.observed_version,
        "observedSha256": synced.observed_sha256,
        "activeVersion": synced.active_version,
        "activeSha256": synced.active_sha256,
        "metadata": synced.metadata,
    }


def run_reference_watch() -> dict[str, object]:
    """Executa uma rodada do watcher oficial fora do caminho crítico da venda."""

    db = SessionLocal()
    results: list[dict[str, object]] = []
    errors: list[dict[str, str]] = []
    try:
        try:
            results.append(_sync_payload(record_probe(db, probe_official_ncm())))
        except FiscalReferenceWatchError as exc:
            record_probe_error(db, "rfb-ncm-json", NCM_JSON_URL, exc)
            errors.append({"sourceKey": "rfb-ncm-json", "error": str(exc)})

        rtc_enabled = os.getenv("KOMA_RTC_CALCULATOR_WATCH_ENABLED", "false").lower() == "true"
        if rtc_enabled:
            try:
                results.append(_sync_payload(record_probe(db, probe_local_rtc_calculator())))
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

    requires_attention = bool(errors) or any(
        item.get("status") != "current" for item in results
    )
    return {
        "ok": not requires_attention,
        "requiresAttention": requires_attention,
        "results": results,
        "errors": errors,
    }


def main() -> int:
    outcome = run_reference_watch()
    print(json.dumps(outcome, ensure_ascii=False, sort_keys=True))
    if outcome["errors"]:
        return 1
    if outcome["requiresAttention"]:
        # Enquanto a versão observada não for validada/promovida, toda execução
        # permanece sinalizando atenção. Isso evita um alerta único ser ignorado.
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

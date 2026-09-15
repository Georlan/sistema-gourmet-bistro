from __future__ import annotations

import json
import logging
import os

from sqlalchemy import text

from ..database import SessionLocal
from .reference_watch import (
    NCM_JSON_URL,
    NFE_TECHNICAL_REPORTS_URL,
    RTC_LOCAL_BASE_URL,
    FiscalReferenceWatchError,
    probe_local_rtc_calculator,
    probe_nfe_technical_reports,
    probe_official_ncm,
    record_probe,
    record_probe_error,
)


logger = logging.getLogger("koma.fiscal.reference_watch")

FISCAL_REFERENCE_WATCH_LOCK_KEY = 876_240_915


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


def _try_acquire_watch_lock(db) -> bool:
    bind = db.get_bind()
    if bind.dialect.name != "postgresql":
        return True
    acquired = db.execute(
        text("SELECT pg_try_advisory_xact_lock(:lock_key)"),
        {"lock_key": FISCAL_REFERENCE_WATCH_LOCK_KEY},
    ).scalar()
    return bool(acquired)


def _collect_probe(db, results, errors, probe_fn, *, source_key: str, source_url: str) -> None:
    try:
        results.append(_sync_payload(record_probe(db, probe_fn())))
    except FiscalReferenceWatchError as exc:
        record_probe_error(db, source_key, source_url, exc)
        errors.append({"sourceKey": source_key, "error": str(exc)})


def run_reference_watch() -> dict[str, object]:
    """Executa uma rodada do watcher oficial fora do caminho crítico da venda."""

    db = SessionLocal()
    results: list[dict[str, object]] = []
    errors: list[dict[str, str]] = []
    try:
        if not _try_acquire_watch_lock(db):
            db.rollback()
            return {
                "ok": True,
                "requiresAttention": False,
                "skipped": True,
                "reason": "another-replica-holds-lock",
                "results": [],
                "errors": [],
            }

        _collect_probe(
            db,
            results,
            errors,
            probe_official_ncm,
            source_key="rfb-ncm-json",
            source_url=NCM_JSON_URL,
        )
        _collect_probe(
            db,
            results,
            errors,
            probe_nfe_technical_reports,
            source_key="nfe-informes-tecnicos",
            source_url=NFE_TECHNICAL_REPORTS_URL,
        )

        rtc_enabled = os.getenv("KOMA_RTC_CALCULATOR_WATCH_ENABLED", "false").lower() == "true"
        if rtc_enabled:
            _collect_probe(
                db,
                results,
                errors,
                probe_local_rtc_calculator,
                source_key="rfb-rtc-calculator-local",
                source_url=f"{RTC_LOCAL_BASE_URL}/dados-abertos/versao",
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
        "skipped": False,
        "results": results,
        "errors": errors,
    }


def main() -> int:
    outcome = run_reference_watch()
    print(json.dumps(outcome, ensure_ascii=False, sort_keys=True))
    if outcome["errors"]:
        return 1
    if outcome["requiresAttention"]:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

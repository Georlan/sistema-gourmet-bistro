from __future__ import annotations

import datetime
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import func

from ..database import SessionLocal
from ..fiscal.reference_watch import stale_reference_keys
from ..fiscal_reference_models import (
    FiscalOfficialReferenceSnapshot,
    FiscalOfficialReferenceState,
)
from .super_admin import get_current_admin


router = APIRouter(prefix="/fiscal/compliance", tags=["SuperAdmin"])


def _iso(value: datetime.datetime | None) -> str | None:
    return value.isoformat() if value else None


@router.get("")
def get_fiscal_compliance_health(
    admin: dict[str, Any] = Depends(get_current_admin),
) -> dict[str, object]:
    del admin
    db = SessionLocal()
    try:
        states = (
            db.query(FiscalOfficialReferenceState)
            .order_by(FiscalOfficialReferenceState.source_key.asc())
            .all()
        )
        snapshot_counts = dict(
            db.query(
                FiscalOfficialReferenceSnapshot.source_key,
                func.count(FiscalOfficialReferenceSnapshot.id),
            )
            .group_by(FiscalOfficialReferenceSnapshot.source_key)
            .all()
        )
        stale = set(stale_reference_keys(states))
        items = [
            {
                "sourceKey": state.source_key,
                "sourceUrl": state.source_url,
                "observedVersion": state.observed_version,
                "observedSha256": state.observed_sha256,
                "observedSnapshotId": state.observed_snapshot_id,
                "activeVersion": state.active_version,
                "activeSha256": state.active_sha256,
                "activeSnapshotId": state.active_snapshot_id,
                "snapshotCount": int(snapshot_counts.get(state.source_key, 0)),
                "status": state.status,
                "stale": state.source_key in stale,
                "checkedAt": _iso(state.checked_at),
                "changedAt": _iso(state.changed_at),
                "promotedAt": _iso(state.promoted_at),
                "metadata": state.metadata_json or {},
                "lastError": state.last_error,
            }
            for state in states
        ]
        return {
            "healthy": bool(states)
            and not stale
            and all(state.status == "current" for state in states),
            "requiresAttention": bool(stale)
            or any(state.status in {"changed", "error"} for state in states),
            "staleSources": sorted(stale),
            "sources": items,
        }
    finally:
        db.close()

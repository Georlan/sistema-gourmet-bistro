from __future__ import annotations

import copy
import datetime
from typing import Any

from sqlalchemy.orm import Session

from ..fiscal_models import RestaurantFiscalProfile
from .fiscal_documents import (
    FiscalDocumentCreationResult,
    FiscalDocumentPersistenceError,
    create_numbered_fiscal_document,
)
from .fiscal_preflight import FiscalPreflightResult, evaluate_fiscal_preflight


class FiscalPreflightBlocked(FiscalDocumentPersistenceError):
    def __init__(self, result: FiscalPreflightResult):
        self.result = result
        codes = ", ".join(issue.code for issue in result.issues) or "unknown"
        super().__init__(f"Fiscal Preflight bloqueou a emissão: {codes}")


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _preflight_lineage(result: FiscalPreflightResult) -> dict[str, Any]:
    return {
        "evaluatedAt": _utcnow().isoformat(),
        "mode": result.mode,
        "jurisdictionKey": result.jurisdiction_key,
        "activeReferences": {
            check.source_key: check.active_snapshot_id
            for check in result.references
            if check.active_snapshot_id
        },
        "complianceBaseline": [
            {
                "key": source["key"],
                "version": source["version"],
                "adoptionStatus": source["adoptionStatus"],
            }
            for source in result.compliance_baseline
        ],
    }


def create_preflighted_fiscal_document(
    db: Session,
    *,
    restaurante_id: int,
    idempotency_key: str,
    sale_snapshot: dict[str, Any],
    total_amount: object,
    comanda_id: str | None = None,
) -> FiscalDocumentCreationResult:
    """Entry point seguro para numerar documento fiscal.

    O perfil é travado na transação antes do preflight. Se qualquer requisito de
    emissão falhar, nenhuma sequência é reservada e nenhum documento é criado.
    O snapshot da venda recebe a linhagem das referências oficiais ativas para
    permitir auditoria/reprodução posterior.
    """

    profile = (
        db.query(RestaurantFiscalProfile)
        .filter(RestaurantFiscalProfile.restaurante_id == restaurante_id)
        .with_for_update()
        .one_or_none()
    )
    if profile is None:
        raise FiscalDocumentPersistenceError(
            "Perfil fiscal do restaurante não foi configurado."
        )

    preflight = evaluate_fiscal_preflight(db, profile, mode="issuance")
    if not preflight.ready:
        db.rollback()
        raise FiscalPreflightBlocked(preflight)

    versioned_snapshot = copy.deepcopy(sale_snapshot)
    versioned_snapshot["fiscalPreflight"] = _preflight_lineage(preflight)

    return create_numbered_fiscal_document(
        db,
        restaurante_id=restaurante_id,
        idempotency_key=idempotency_key,
        sale_snapshot=versioned_snapshot,
        total_amount=total_amount,
        comanda_id=comanda_id,
        environment=profile.environment,
        model=profile.document_model,
        series=profile.series,
        provider=profile.provider,
    )

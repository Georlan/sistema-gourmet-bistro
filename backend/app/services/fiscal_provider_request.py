"""Build integration requests from KÔMA persisted documents, not provider/client totals."""
from __future__ import annotations

import json

from ..fiscal.providers import FiscalProviderContext, FiscalProviderRequest
from ..fiscal_models import FiscalDocument


def request_from_document(document: FiscalDocument, *, restaurante_id: int) -> FiscalProviderRequest:
    if document.restaurante_id != restaurante_id:
        raise ValueError("Documento fiscal não pertence ao restaurante solicitado.")
    if document.status not in {"ready", "submitting", "unknown", "reconciling", "authorized", "cancel_pending", "cancelled", "pending_transmission"}:
        raise ValueError("Documento fiscal ainda não está pronto para integração.")
    if not document.calculation_snapshot or not document.rule_set_version:
        raise ValueError("Cálculo e versão tributária precisam estar congelados antes da integração.")
    return FiscalProviderRequest(
        context=FiscalProviderContext(document.restaurante_id, document.environment, document.model),
        document_id=document.id,
        operation_key=document.provider_operation_key or document.idempotency_key,
        series=document.series,
        number=document.number or 0,
        sale_json=json.dumps(document.sale_snapshot, sort_keys=True, allow_nan=False),
        calculation_json=json.dumps(document.calculation_snapshot, sort_keys=True, allow_nan=False),
        rule_set_version=document.rule_set_version,
        source_status=document.status,
    )

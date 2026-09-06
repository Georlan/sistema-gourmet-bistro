from __future__ import annotations

from fastapi import APIRouter

from ..legal_config import (
    LEGAL_SOURCE_BLOB_SHA,
    LEGAL_SOURCE_COMMIT,
    LEGAL_VERSION,
    get_legal_provider_identity,
)


router = APIRouter(prefix="/api/contracts", tags=["Contratos eletrônicos"])


@router.get("/readiness")
def get_contract_readiness() -> dict[str, object]:
    """Expose only non-sensitive readiness metadata for safe production smoke checks."""
    try:
        get_legal_provider_identity()
    except RuntimeError:
        provider_identity_configured = False
    else:
        provider_identity_configured = True

    return {
        "ready": provider_identity_configured,
        "providerIdentityConfigured": provider_identity_configured,
        "legalVersion": LEGAL_VERSION,
        "legalSourceCommit": LEGAL_SOURCE_COMMIT,
        "legalSourceBlobSha": LEGAL_SOURCE_BLOB_SHA,
    }

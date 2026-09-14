from __future__ import annotations

import os
from dataclasses import dataclass

from .contract_validation import is_valid_cpf, normalize_tax_id


DEFAULT_PROVIDER_NAME = "Georlan Gomes e Silva Júnior"
LEGAL_VERSION = "2.2"
LEGAL_SOURCE_COMMIT = "9cea04e26a4c80a4e51868d7e23dbb7139d81167"
LEGAL_SOURCE_BLOB_SHA = "41e18218432e43a3298ceb3084613782db623135"


@dataclass(frozen=True)
class LegalProviderIdentity:
    name: str
    tax_id: str
    address: str
    location: str


def get_legal_provider_identity() -> LegalProviderIdentity:
    name = os.getenv("KOMA_LEGAL_PROVIDER_NAME", DEFAULT_PROVIDER_NAME).strip()
    tax_id = normalize_tax_id(os.getenv("KOMA_LEGAL_PROVIDER_TAX_ID", ""))
    address = os.getenv("KOMA_LEGAL_PROVIDER_ADDRESS", "").strip()
    location = os.getenv("KOMA_LEGAL_PROVIDER_LOCATION", "Limoeiro do Norte/CE").strip()

    if not name or not is_valid_cpf(tax_id) or not address or not location:
        raise RuntimeError(
            "Identificação jurídica do prestador incompleta. Configure "
            "KOMA_LEGAL_PROVIDER_NAME, KOMA_LEGAL_PROVIDER_TAX_ID, "
            "KOMA_LEGAL_PROVIDER_ADDRESS e KOMA_LEGAL_PROVIDER_LOCATION."
        )

    return LegalProviderIdentity(
        name=name,
        tax_id=tax_id,
        address=address,
        location=location,
    )

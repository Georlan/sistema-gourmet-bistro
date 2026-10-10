from __future__ import annotations

import os
from dataclasses import dataclass

from .contract_validation import is_valid_cpf, normalize_tax_id


DEFAULT_PROVIDER_NAME = "Georlan Gomes e Silva Júnior"
LEGAL_VERSION = "3.5"
LEGAL_SOURCE_COMMIT = "59f1024523c66c814c403425aac993e0fab9cd15"
LEGAL_SOURCE_BLOB_SHA = "5abbaf4325c2c4531c31b9e6f910dc6c97b045bb"


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

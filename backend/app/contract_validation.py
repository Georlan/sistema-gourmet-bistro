from __future__ import annotations

# Compatibilidade pública: os chamadores históricos continuam importando estes
# helpers deste módulo, mas a implementação canônica vive em tax_ids.
from .tax_ids import (
    is_valid_cnpj,
    is_valid_cpf,
    normalize_tax_id,
    tax_id_kind,
)

__all__ = [
    "is_valid_cnpj",
    "is_valid_cpf",
    "normalize_tax_id",
    "tax_id_kind",
]

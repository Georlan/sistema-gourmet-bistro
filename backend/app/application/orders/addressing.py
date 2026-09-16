"""Mapeamento canônico de endereço estruturado nas bordas de pedido.

Cardápio Online e Caixa/PDV aceitam o mesmo contrato público em português e
convertem para ``DeliveryAddressInput`` antes de entrar no núcleo de pedidos.
A regra de validação continua pertencendo ao domínio, evitando duas semânticas
de endereço entre os canais.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .commands import DeliveryAddressInput


def delivery_address_from_payload(value: object | None) -> DeliveryAddressInput | None:
    """Converte schema/dict de borda no value object canônico do domínio."""
    if value is None:
        return None

    if hasattr(value, "model_dump"):
        raw = value.model_dump()  # type: ignore[attr-defined]
    elif isinstance(value, Mapping):
        raw = dict(value)
    else:
        raise TypeError("address_snapshot deve ser um objeto estruturado")

    data: dict[str, Any] = dict(raw)
    return DeliveryAddressInput(
        street=data.get("logradouro", ""),
        number=data.get("numero", ""),
        complement=data.get("complemento"),
        neighborhood=data.get("bairro", ""),
        city=data.get("cidade", ""),
        state=data.get("uf", ""),
        postal_code=data.get("cep", ""),
        reference=data.get("referencia"),
        latitude=data.get("latitude"),
        longitude=data.get("longitude"),
    )

from __future__ import annotations

from copy import deepcopy

from app.application.orders.addressing import delivery_address_from_payload
from app.application.orders.idempotency import (
    build_order_intent_canonical_dict,
    compute_fingerprint_for_public_payload,
)
from app.schemas import CardapioPedidoCreate, VendaDiretaCreate


def _snapshot(**overrides):
    values = {
        "logradouro": " Rua das Flores ",
        "numero": " 123 ",
        "complemento": " Apto 10 ",
        "bairro": " Centro ",
        "cidade": " Fortaleza ",
        "uf": "ce",
        "cep": "60.000-000",
        "referencia": " Portaria lateral ",
        "latitude": -3.7319,
        "longitude": -38.5267,
    }
    values.update(overrides)
    return values


def _cardapio_payload(snapshot=None) -> CardapioPedidoCreate:
    return CardapioPedidoCreate(
        restaurante_id=7,
        itens=[{"produto_id": "produto-1", "quantidade": 1}],
        cliente_nome="Maria Silva",
        cliente_telefone="85999999999",
        endereco_entrega="endereco legado",
        address_snapshot=snapshot,
        bairro="Centro",
        forma_pagamento="na_entrega",
        forma_pagamento_detalhe="dinheiro",
        tipo_pedido="delivery",
    )


def test_cardapio_and_pos_share_the_same_structured_address_contract():
    snapshot = _snapshot()
    cardapio = _cardapio_payload(snapshot)
    pos = VendaDiretaCreate(
        tipo="Entrega",
        identificador="Maria Silva",
        delivery_telefone="85999999999",
        delivery_endereco="endereco legado",
        address_snapshot=snapshot,
        itens=[{"produto_id": "produto-1"}],
    )

    assert cardapio.address_snapshot is not None
    assert pos.address_snapshot is not None
    assert cardapio.address_snapshot.model_dump() == pos.address_snapshot.model_dump()
    assert cardapio.address_snapshot.uf == "CE"
    assert cardapio.address_snapshot.cep == "60000000"

    from_cardapio = delivery_address_from_payload(cardapio.address_snapshot)
    from_pos = delivery_address_from_payload(pos.address_snapshot)

    assert from_cardapio == from_pos
    assert from_cardapio is not None
    assert from_cardapio.neighborhood == "Centro"
    assert from_cardapio.to_legacy_address() == (
        "Rua das Flores, 123, Apto 10, Centro, Fortaleza - CE, "
        "CEP 60000-000, Ref.: Portaria lateral"
    )


def test_structured_address_participates_in_public_idempotency_fingerprint():
    first = _cardapio_payload(_snapshot(numero="123"))
    second = _cardapio_payload(_snapshot(numero="124"))

    fingerprint_a = compute_fingerprint_for_public_payload(first)
    fingerprint_b = compute_fingerprint_for_public_payload(second)

    assert fingerprint_a.fingerprint != fingerprint_b.fingerprint
    assert fingerprint_a.canonical_payload["address_snapshot"]["numero"] == "123"
    assert fingerprint_a.canonical_payload["address_snapshot"]["cep"] == "60000000"
    assert fingerprint_a.canonical_payload["address_snapshot"]["uf"] == "CE"


def test_legacy_public_order_keeps_previous_fingerprint_shape_without_snapshot():
    canonical = build_order_intent_canonical_dict(
        restaurante_id=7,
        tipo_pedido="delivery",
        itens=[{"produto_id": "produto-1", "quantidade": 1}],
        cliente_nome="Maria Silva",
        cliente_telefone="85999999999",
        endereco_entrega="Rua antiga, 123",
        bairro="Centro",
        forma_pagamento="na_entrega",
        forma_pagamento_detalhe="dinheiro",
    )

    assert "address_snapshot" not in canonical
    assert canonical["endereco_entrega"] == "Rua antiga, 123"


def test_snapshot_normalization_is_stable_for_semantically_equal_payloads():
    left = _cardapio_payload(_snapshot())
    equivalent = deepcopy(_snapshot())
    equivalent.update(
        {
            "logradouro": "Rua   das   Flores",
            "uf": "CE",
            "cep": "60000000",
        }
    )
    right = _cardapio_payload(equivalent)

    assert compute_fingerprint_for_public_payload(left).fingerprint == compute_fingerprint_for_public_payload(right).fingerprint

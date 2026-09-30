"""Publicar taxa padrão sem bairros e usá-la no cálculo canônico da entrega."""

from decimal import Decimal

import pytest

from app.application.orders.service import OrderApplicationService
from app.database import SessionLocal
from app.domain.orders.types import FulfillmentType
from tests.characterization.orders.fixtures import (
    CHAR_RESTAURANT_ID,
    char_client,
    char_setup,
)


@pytest.mark.parametrize("fee", [0, 2, 7.5])
def test_publish_default_fee_without_neighborhoods(char_client, char_setup, fee):
    response = char_client.put(
        "/caixa/configuracoes",
        headers=char_setup["headers"],
        json={
            "tipo_taxa_entrega": "bairro",
            "taxa_entrega_fixa": fee,
            "tabela_taxas_bairros": [],
            "frete_gratis_valor": 0,
        },
    )
    assert response.status_code == 200, response.text

    public = char_client.get(
        f"/api/cardapio-digital/public?restaurante_id={CHAR_RESTAURANT_ID}"
    )
    assert public.status_code == 200, public.text
    restaurant = public.json()["restaurante"]
    assert restaurant["taxa_entrega_fixa"] == fee
    assert restaurant["tabela_taxas_bairros"] == []

    db = SessionLocal()
    try:
        for neighborhood in (None, "", "Centro", "Bairro não cadastrado"):
            actual = OrderApplicationService.resolve_server_delivery_fee(
                db=db,
                restaurante_id=CHAR_RESTAURANT_ID,
                fulfillment=FulfillmentType.DELIVERY,
                items_subtotal=Decimal("40.00"),
                neighborhood=neighborhood,
            )
            assert actual == Decimal(str(fee))
    finally:
        db.close()

"""Regressões focais do modo de entrega por distância sem API paga."""

from decimal import Decimal

from sqlalchemy.orm import Session

from app.application.orders.commands import DeliveryAddressInput
from app.application.orders.service import OrderApplicationService
from app.database import SessionLocal
from app.domain.orders.types import FulfillmentType
from app.models import ConfiguracaoRestaurante, Restaurante
from tests.characterization.orders.fixtures import (
    CHAR_RESTAURANT_ID,
    char_client,
    char_setup,
)


def _config(db: Session) -> ConfiguracaoRestaurante:
    config = (
        db.query(ConfiguracaoRestaurante)
        .filter(ConfiguracaoRestaurante.restaurante_id == CHAR_RESTAURANT_ID)
        .first()
    )
    assert config is not None
    return config


def _distance_policy() -> list[dict]:
    return [{
        "taxa_minima": 5,
        "km_inclusos": 3,
        "incremento_valor": 1,
        "incremento_km": 3,
        "taxa_maxima": 7,
        "distancia_maxima_km": 0,
    }]


def test_distance_mode_is_server_authoritative_and_uses_structured_coordinates(char_setup):
    db: Session = SessionLocal()
    try:
        config = _config(db)
        restaurante = db.query(Restaurante).filter(Restaurante.id == CHAR_RESTAURANT_ID).first()
        assert restaurante is not None
        restaurante.latitude = -3.7319
        restaurante.longitude = -38.5267
        config.tipo_taxa_entrega = "distancia"
        config.tabela_taxas_km = _distance_policy()
        config.frete_gratis_valor = 0
        db.commit()

        address = DeliveryAddressInput(
            street="Rua Teste",
            number="10",
            neighborhood="Centro",
            city="Fortaleza",
            state="CE",
            postal_code="",
            latitude=-3.7319,
            longitude=-38.4816,
        )
        fee = OrderApplicationService.resolve_server_delivery_fee(
            db=db,
            restaurante_id=CHAR_RESTAURANT_ID,
            fulfillment=FulfillmentType.DELIVERY,
            items_subtotal=Decimal("30.00"),
            delivery_address=address,
        )
        assert fee == Decimal("6.00")
    finally:
        restaurante = db.query(Restaurante).filter(Restaurante.id == CHAR_RESTAURANT_ID).first()
        config = _config(db)
        if restaurante is not None:
            restaurante.latitude = None
            restaurante.longitude = None
        config.tipo_taxa_entrega = "fixa"
        config.tabela_taxas_km = []
        config.frete_gratis_valor = 0
        db.commit()
        db.close()


def test_public_distance_quote_uses_same_policy(char_client, char_setup):
    db: Session = SessionLocal()
    try:
        config = _config(db)
        restaurante = db.query(Restaurante).filter(Restaurante.id == CHAR_RESTAURANT_ID).first()
        assert restaurante is not None
        restaurante.latitude = -3.7319
        restaurante.longitude = -38.5267
        config.tipo_taxa_entrega = "distancia"
        config.tabela_taxas_km = _distance_policy()
        config.frete_gratis_valor = 0
        db.commit()

        response = char_client.post(
            f"/api/cardapio-digital/delivery/quote?restaurante_id={CHAR_RESTAURANT_ID}",
            json={"latitude": -3.7319, "longitude": -38.4816, "subtotal": 30},
        )
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["fee"] == 6.0
        assert 4 < payload["distance_km"] < 6
        assert payload["used_fallback"] is False
    finally:
        restaurante = db.query(Restaurante).filter(Restaurante.id == CHAR_RESTAURANT_ID).first()
        config = _config(db)
        if restaurante is not None:
            restaurante.latitude = None
            restaurante.longitude = None
        config.tipo_taxa_entrega = "fixa"
        config.tabela_taxas_km = []
        db.commit()
        db.close()


def test_admin_can_set_restaurant_delivery_origin_without_external_geocoder(char_client, char_setup):
    headers = char_setup["headers"]
    response = char_client.put(
        "/caixa/configuracoes/delivery-origin",
        headers=headers,
        json={"latitude": -3.7319, "longitude": -38.5267},
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"configured": True}

    get_response = char_client.get("/caixa/configuracoes", headers=headers)
    assert get_response.status_code == 200
    assert get_response.json()["delivery_origin_configured"] is True

    db: Session = SessionLocal()
    try:
        restaurante = db.query(Restaurante).filter(Restaurante.id == CHAR_RESTAURANT_ID).first()
        assert restaurante is not None
        restaurante.latitude = None
        restaurante.longitude = None
        db.commit()
    finally:
        db.close()

from unittest.mock import AsyncMock

from app.routes import caixa as caixa_routes
from tests.characterization.orders.fixtures import (
    CHAR_RESTAURANT_ID,
    char_client,
    char_setup,
)


def test_delivery_config_update_notifies_public_menu_and_exposes_active_distance_policy(
    monkeypatch,
    char_client,
    char_setup,
):
    broadcast = AsyncMock()
    monkeypatch.setattr(caixa_routes.manager, "broadcast", broadcast)
    headers = char_setup["headers"]

    response = char_client.put(
        "/caixa/configuracoes",
        headers=headers,
        json={
            "tipo_taxa_entrega": "distancia",
            "taxa_entrega_fixa": 7,
            "tabela_taxas_km": [{
                "taxa_minima": 5,
                "valor_por_km": 1,
            }],
        },
    )
    assert response.status_code == 200, response.text

    broadcast.assert_any_await(
        {"event": "config_updated"},
        CHAR_RESTAURANT_ID,
    )

    public_response = char_client.get(
        f"/api/cardapio-digital/public?restaurante_id={CHAR_RESTAURANT_ID}",
    )
    assert public_response.status_code == 200, public_response.text
    restaurant = public_response.json()["restaurante"]
    assert restaurant["tipo_taxa_entrega"] == "distancia"
    assert restaurant["taxa_entrega_fixa"] == 7.0
    assert restaurant["tabela_taxas_km"][0] == {
        "taxa_minima": 5.0,
        "valor_por_km": 1.0,
        "fallback_sem_localizacao": "minima",
    }

    reset = char_client.put(
        "/caixa/configuracoes",
        headers=headers,
        json={
            "tipo_taxa_entrega": "fixa",
            "taxa_entrega_fixa": 7,
            "tabela_taxas_km": [],
        },
    )
    assert reset.status_code == 200, reset.text

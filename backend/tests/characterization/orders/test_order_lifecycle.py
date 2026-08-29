"""Testes de caracterização: Congelamento dos ciclos de vida e transições de status."""

import pytest
from unittest.mock import patch
from app.database import SessionLocal
from .fixtures import char_client, char_setup, capture_order_snapshot, CHAR_RESTAURANT_ID


@patch("app.routes.cardapio._enforce_public_order_rate_limits", lambda *args, **kwargs: None)
@patch("app.services.whatsapp.enviar_notificacao_whatsapp_task", lambda *args, **kwargs: None)
class TestLegacyOrderLifecycle:
    def test_delivery_order_full_happy_path(self, char_client, char_setup):
        """[OBSERVADO] Ciclo feliz completo do delivery:
        pendente -> producao -> pronto -> transito (via despacho com motoboy) -> finalizado.
        """
        headers = char_setup["headers"]
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Life User 1",
            "cliente_telefone": "11988881111",
            "tipo_pedido": "delivery",
            "endereco_entrega": "Rua 1",
            "taxa_entrega": 5.0,
            "itens": [{"produto_id": "prod-char-simples", "quantidade": 1, "modificador_ids": []}],
        }
        res = char_client.post("/cardapio/pedidos", json=payload)
        comanda_id = res.json()["comanda_id"]

        # 1. Pendente -> Producao
        r1 = char_client.put(
            f"/comandas/{comanda_id}/delivery/status",
            params={"status_novo": "producao"},
            headers=headers,
        )
        assert r1.status_code == 200
        assert r1.json()["delivery_status"] == "producao"

        # 2. Producao -> Pronto
        r2 = char_client.put(
            f"/comandas/{comanda_id}/delivery/status",
            params={"status_novo": "pronto"},
            headers=headers,
        )
        assert r2.status_code == 200
        assert r2.json()["delivery_status"] == "pronto"

        # 3. Pronto -> Transito (Despachar com motoboy vinculado)
        r3 = char_client.post(
            f"/comandas/{comanda_id}/delivery/despachar",
            json={"motoboy_id": 1},
            headers=headers,
        )
        assert r3.status_code == 200
        assert r3.json()["delivery_status"] == "transito"
        assert r3.json()["motoboy_id"] == 1

        # 4. Transito -> Finalizado
        r4 = char_client.put(
            f"/comandas/{comanda_id}/delivery/status",
            params={"status_novo": "finalizado"},
            headers=headers,
        )
        assert r4.status_code == 200
        assert r4.json()["delivery_status"] == "finalizado"

    def test_direct_transition_to_transito_without_motoboy_returns_409(self, char_client, char_setup):
        """[OBSERVADO] Tentar transitar para 'transito' sem motoboy vinculado retorna 409 Conflict."""
        headers = char_setup["headers"]
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Life No Motoboy",
            "cliente_telefone": "11988881234",
            "tipo_pedido": "delivery",
            "endereco_entrega": "Rua 2",
            "taxa_entrega": 5.0,
            "itens": [{"produto_id": "prod-char-simples", "quantidade": 1, "modificador_ids": []}],
        }
        res = char_client.post("/cardapio/pedidos", json=payload)
        comanda_id = res.json()["comanda_id"]

        char_client.put(
            f"/comandas/{comanda_id}/delivery/status",
            params={"status_novo": "producao"},
            headers=headers,
        )
        char_client.put(
            f"/comandas/{comanda_id}/delivery/status",
            params={"status_novo": "pronto"},
            headers=headers,
        )

        r_conflict = char_client.put(
            f"/comandas/{comanda_id}/delivery/status",
            params={"status_novo": "transito"},
            headers=headers,
        )
        assert r_conflict.status_code == 409
        assert "motoboy" in r_conflict.json()["detail"].lower()

    def test_pickup_order_full_happy_path(self, char_client, char_setup):
        """[OBSERVADO] Ciclo feliz de retirada: pendente -> producao -> pronto -> finalizado."""
        headers = char_setup["headers"]
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Life User 2",
            "cliente_telefone": "11988882222",
            "tipo_pedido": "retirada",
            "itens": [{"produto_id": "prod-char-simples", "quantidade": 1, "modificador_ids": []}],
        }
        res = char_client.post("/cardapio/pedidos", json=payload)
        comanda_id = res.json()["comanda_id"]

        # 1. Pendente -> Producao
        r1 = char_client.put(
            f"/comandas/{comanda_id}/delivery/status",
            params={"status_novo": "producao"},
            headers=headers,
        )
        assert r1.status_code == 200

        # 2. Producao -> Pronto
        r2 = char_client.put(
            f"/comandas/{comanda_id}/delivery/status",
            params={"status_novo": "pronto"},
            headers=headers,
        )
        assert r2.status_code == 200

        # 3. Pronto -> Finalizado
        r3 = char_client.put(
            f"/comandas/{comanda_id}/delivery/status",
            params={"status_novo": "finalizado"},
            headers=headers,
        )
        assert r3.status_code == 200
        assert r3.json()["delivery_status"] == "finalizado"

    def test_invalid_status_name_rejected_with_422(self, char_client, char_setup):
        """[OBSERVADO] Status desconhecido é rejeitado com 422 Unprocessable Content."""
        headers = char_setup["headers"]
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Life User 3",
            "cliente_telefone": "11988883333",
            "tipo_pedido": "retirada",
            "itens": [{"produto_id": "prod-char-simples", "quantidade": 1, "modificador_ids": []}],
        }
        res = char_client.post("/cardapio/pedidos", json=payload)
        comanda_id = res.json()["comanda_id"]

        inv = char_client.put(
            f"/comandas/{comanda_id}/delivery/status",
            params={"status_novo": "status_inexistente"},
            headers=headers,
        )
        assert inv.status_code == 422
        assert "Status inválido" in inv.json()["detail"]

    def test_rejection_from_pendente(self, char_client, char_setup):
        """[OBSERVADO] Pedido pendente pode ser recusado diretamente."""
        headers = char_setup["headers"]
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Life User 4",
            "cliente_telefone": "11988884444",
            "tipo_pedido": "retirada",
            "itens": [{"produto_id": "prod-char-simples", "quantidade": 1, "modificador_ids": []}],
        }
        res = char_client.post("/cardapio/pedidos", json=payload)
        comanda_id = res.json()["comanda_id"]

        rec = char_client.put(
            f"/comandas/{comanda_id}/delivery/status",
            params={"status_novo": "recusado"},
            headers=headers,
        )
        assert rec.status_code == 200
        assert rec.json()["delivery_status"] == "recusado"

    def test_cancellation_from_producao(self, char_client, char_setup):
        """[OBSERVADO] Pedido em produção pode ser cancelado/recusado por indisponibilidade operacional."""
        headers = char_setup["headers"]
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Life User 5",
            "cliente_telefone": "11988885555",
            "tipo_pedido": "retirada",
            "itens": [{"produto_id": "prod-char-simples", "quantidade": 1, "modificador_ids": []}],
        }
        res = char_client.post("/cardapio/pedidos", json=payload)
        comanda_id = res.json()["comanda_id"]

        char_client.put(
            f"/comandas/{comanda_id}/delivery/status",
            params={"status_novo": "producao"},
            headers=headers,
        )
        rec = char_client.put(
            f"/comandas/{comanda_id}/delivery/status",
            params={"status_novo": "recusado"},
            headers=headers,
        )
        assert rec.status_code == 200
        assert rec.json()["delivery_status"] == "recusado"

"""Testes de caracterização: Congelamento das regras de idempotência de pedidos."""

import uuid
import pytest
from unittest.mock import patch
from app.database import SessionLocal
from app.models import Comanda
from .fixtures import char_client, char_setup, CHAR_RESTAURANT_ID


@patch("app.routes.cardapio._enforce_public_order_rate_limits", lambda *args, **kwargs: None)
@patch("app.services.whatsapp.enviar_notificacao_whatsapp_task", lambda *args, **kwargs: None)
class TestLegacyOrderIdempotency:
    def test_idempotency_returns_existing_order_without_duplicate(self, char_client, char_setup):
        """[OBSERVADO] Mesma idempotency_key retorna a comanda existente com status 201 sem duplicar registro."""
        key = f"idemp-test-{uuid.uuid4()}"
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Idempotent User",
            "cliente_telefone": "11988880001",
            "tipo_pedido": "retirada",
            "idempotency_key": key,
            "itens": [
                {
                    "produto_id": "prod-char-simples",
                    "quantidade": 1,
                    "modificador_ids": [],
                }
            ],
        }

        # Primeiro envio
        res1 = char_client.post("/cardapio/pedidos", json=payload)
        assert res1.status_code == 201
        data1 = res1.json()
        comanda_id_1 = data1["comanda_id"]

        # Segundo envio com mesma chave
        res2 = char_client.post("/cardapio/pedidos", json=payload)
        assert res2.status_code == 201
        data2 = res2.json()
        comanda_id_2 = data2["comanda_id"]

        # Devem ser a mesma comanda
        assert comanda_id_1 == comanda_id_2
        assert "já cadastrado" in data2["mensagem"].lower()

        # Verifica unicidade no banco
        db = SessionLocal()
        try:
            count = db.query(Comanda).filter(
                Comanda.restaurante_id == CHAR_RESTAURANT_ID,
                Comanda.idempotency_key == key,
            ).count()
            assert count == 1
        finally:
            db.close()

    def test_orders_without_idempotency_key_create_separate_orders(self, char_client, char_setup):
        """[OBSERVADO] Envios sem chave de idempotência criam pedidos distintos."""
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Non Idempotent",
            "cliente_telefone": "11988880002",
            "tipo_pedido": "retirada",
            "itens": [
                {
                    "produto_id": "prod-char-simples",
                    "quantidade": 1,
                    "modificador_ids": [],
                }
            ],
        }
        res1 = char_client.post("/cardapio/pedidos", json=payload)
        res2 = char_client.post("/cardapio/pedidos", json=payload)
        assert res1.status_code == 201
        assert res2.status_code == 201
        assert res1.json()["comanda_id"] != res2.json()["comanda_id"]

    def test_different_idempotency_keys_create_separate_orders(self, char_client, char_setup):
        """[OBSERVADO] Chaves de idempotência distintas geram pedidos distintos."""
        k1 = f"key-a-{uuid.uuid4()}"
        k2 = f"key-b-{uuid.uuid4()}"
        payload1 = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "User Multi",
            "cliente_telefone": "11988880003",
            "tipo_pedido": "retirada",
            "idempotency_key": k1,
            "itens": [
                {
                    "produto_id": "prod-char-simples",
                    "quantidade": 1,
                    "modificador_ids": [],
                }
            ],
        }
        payload2 = dict(payload1, idempotency_key=k2)

        res1 = char_client.post("/cardapio/pedidos", json=payload1)
        res2 = char_client.post("/cardapio/pedidos", json=payload2)
        assert res1.status_code == 201
        assert res2.status_code == 201
        assert res1.json()["comanda_id"] != res2.json()["comanda_id"]

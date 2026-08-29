"""Testes de caracterização: Congelamento da persistência e criação de pedidos no cardápio legado."""

import pytest
from unittest.mock import patch
from app.database import SessionLocal
from app.models import Cliente, Comanda, Item, ItemModificador, Lancamento
from .fixtures import char_client, char_setup, capture_order_snapshot, CHAR_RESTAURANT_ID


@patch("app.routes.cardapio._enforce_public_order_rate_limits", lambda *args, **kwargs: None)
@patch("app.services.whatsapp.enviar_notificacao_whatsapp_task", lambda *args, **kwargs: None)
class TestLegacyCardapioCreation:
    def test_cardapio_creates_comanda_lancamento_item_hierarchy(self, char_client, char_setup):
        """[OBSERVADO] O cardápio cria a estrutura Comanda -> Lancamento -> Item -> ItemModificador."""
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Carlos Cliente",
            "cliente_telefone": "11988887777",
            "tipo_pedido": "delivery",
            "endereco_entrega": "Rua Central, 100",
            "taxa_entrega": 7.00,
            "itens": [
                {
                    "produto_id": "prod-char-simples",
                    "quantidade": 1,
                    "modificador_ids": ["mod-char-bacon"],
                    "observacao": "Sem maionese",
                }
            ],
        }
        res = char_client.post("/cardapio/pedidos", json=payload)
        assert res.status_code == 201
        data = res.json()
        comanda_id = data["comanda_id"]

        db = SessionLocal()
        try:
            snapshot = capture_order_snapshot(db, comanda_id)
            assert snapshot["tipo"] == "Delivery"
            assert snapshot["delivery_status"] == "pendente"
            assert snapshot["delivery_taxa"] == 7.0
            assert snapshot["delivery_endereco"] == "Rua Central, 100"
            assert len(snapshot["lancamentos"]) == 1
            assert len(snapshot["itens"]) == 1

            item = snapshot["itens"][0]
            assert item["produto_id"] == "prod-char-simples"
            assert item["preco_unit"] == 30.0
            assert item["observacao"] == "Sem maionese"
            assert len(item["modificadores"]) == 1
            assert item["modificadores"][0]["modificador_id"] == "mod-char-bacon"
            assert item["modificadores"][0]["preco_adicional"] == 5.0
        finally:
            db.close()

    def test_cardapio_registers_or_updates_client(self, char_client, char_setup):
        """[OBSERVADO] O cardápio persiste o cadastro do cliente em Cliente."""
        phone = "11977776666"
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Mariana Souza",
            "cliente_telefone": phone,
            "tipo_pedido": "retirada",
            "itens": [
                {
                    "produto_id": "prod-char-simples",
                    "quantidade": 1,
                    "modificador_ids": [],
                }
            ],
        }
        res = char_client.post("/cardapio/pedidos", json=payload)
        assert res.status_code == 201
        comanda_id = res.json()["comanda_id"]

        db = SessionLocal()
        try:
            comanda = db.query(Comanda).filter(
                Comanda.restaurante_id == CHAR_RESTAURANT_ID,
                Comanda.id == comanda_id,
            ).first()
            assert comanda is not None
            assert comanda.identificador == "Mariana Souza"
            assert comanda.delivery_telefone == phone
        finally:
            db.close()

    def test_cardapio_pickup_order_structure(self, char_client, char_setup):
        """[OBSERVADO] Pedido com tipo_pedido='retirada' gera Comanda.tipo='Retirada' e taxa 0."""
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Felipe Balcao",
            "cliente_telefone": "11966665555",
            "tipo_pedido": "retirada",
            "itens": [
                {
                    "produto_id": "prod-char-refri",
                    "quantidade": 2,
                    "modificador_ids": [],
                }
            ],
        }
        res = char_client.post("/cardapio/pedidos", json=payload)
        assert res.status_code == 201
        data = res.json()

        db = SessionLocal()
        try:
            snapshot = capture_order_snapshot(db, data["comanda_id"])
            assert snapshot["tipo"] == "Retirada"
            assert snapshot["delivery_taxa"] == 0.0
        finally:
            db.close()

    def test_cardapio_invalid_phone_rejected(self, char_client, char_setup):
        """[OBSERVADO] Telefone com menos de 10 dígitos é rejeitado com 422."""
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Invalido",
            "cliente_telefone": "12345",
            "tipo_pedido": "retirada",
            "itens": [
                {
                    "produto_id": "prod-char-simples",
                    "quantidade": 1,
                    "modificador_ids": [],
                }
            ],
        }
        res = char_client.post("/cardapio/pedidos", json=payload)
        assert res.status_code == 422

    def test_cardapio_delivery_without_address_rejected(self, char_client, char_setup):
        """[OBSERVADO] Pedido delivery com endereço vazio é rejeitado com 422."""
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Sem Endereco",
            "cliente_telefone": "11999991234",
            "tipo_pedido": "delivery",
            "endereco_entrega": "   ",
            "itens": [
                {
                    "produto_id": "prod-char-simples",
                    "quantidade": 1,
                    "modificador_ids": [],
                }
            ],
        }
        res = char_client.post("/cardapio/pedidos", json=payload)
        assert res.status_code == 422

    def test_cardapio_empty_items_rejected(self, char_client, char_setup):
        """[OBSERVADO] Pedido sem itens é rejeitado com 422."""
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Sem Itens",
            "cliente_telefone": "11999991234",
            "tipo_pedido": "retirada",
            "itens": [],
        }
        res = char_client.post("/cardapio/pedidos", json=payload)
        assert res.status_code == 422

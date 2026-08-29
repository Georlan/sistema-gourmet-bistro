"""Testes de caracterização: Congelamento das regras de pricing e cálculo do cardápio legado."""

from decimal import Decimal
import uuid
import pytest
from unittest.mock import patch

from .fixtures import char_client, char_setup, capture_order_snapshot, CHAR_RESTAURANT_ID


@patch("app.routes.cardapio._enforce_public_order_rate_limits", lambda *args, **kwargs: None)
@patch("app.services.whatsapp.enviar_notificacao_whatsapp_task", lambda *args, **kwargs: None)
class TestLegacyCardapioPricing:
    def test_pricing_single_item_produces_exact_base_price(self, char_client, char_setup):
        """[OBSERVADO] Produto simples de R$ 25.00 resulta em total R$ 25.00."""
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Cliente Preco 1",
            "cliente_telefone": "11999990001",
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
        data = res.json()
        assert data["total"] == 25.0
        assert Decimal(str(data["total"])) == Decimal("25.00")

    def test_pricing_multiple_quantity_multiplies_linearly(self, char_client, char_setup):
        """[OBSERVADO] 3x Produto de R$ 25.00 resulta em total R$ 75.00."""
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Cliente Preco 2",
            "cliente_telefone": "11999990002",
            "tipo_pedido": "retirada",
            "itens": [
                {
                    "produto_id": "prod-char-simples",
                    "quantidade": 3,
                    "modificador_ids": [],
                }
            ],
        }
        res = char_client.post("/cardapio/pedidos", json=payload)
        assert res.status_code == 201
        data = res.json()
        assert data["total"] == 75.0

    def test_pricing_item_with_single_modifier(self, char_client, char_setup):
        """[OBSERVADO] Burguer (R$ 25.00) + Bacon (R$ 5.00) = R$ 30.00."""
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Cliente Preco 3",
            "cliente_telefone": "11999990003",
            "tipo_pedido": "retirada",
            "itens": [
                {
                    "produto_id": "prod-char-simples",
                    "quantidade": 1,
                    "modificador_ids": ["mod-char-bacon"],
                }
            ],
        }
        res = char_client.post("/cardapio/pedidos", json=payload)
        assert res.status_code == 201
        data = res.json()
        assert data["total"] == 30.0

    def test_pricing_item_with_multiple_modifiers(self, char_client, char_setup):
        """[OBSERVADO] Burguer (R$ 25.00) + Bacon (R$ 5.00) + Cheddar (R$ 4.00) = R$ 34.00."""
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Cliente Preco 4",
            "cliente_telefone": "11999990004",
            "tipo_pedido": "retirada",
            "itens": [
                {
                    "produto_id": "prod-char-simples",
                    "quantidade": 1,
                    "modificador_ids": ["mod-char-bacon", "mod-char-cheddar"],
                }
            ],
        }
        res = char_client.post("/cardapio/pedidos", json=payload)
        assert res.status_code == 201
        data = res.json()
        assert data["total"] == 34.0

    def test_pricing_multiple_quantity_with_modifiers(self, char_client, char_setup):
        """[OBSERVADO] 2x (Burguer R$ 25.00 + Bacon R$ 5.00) = R$ 60.00."""
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Cliente Preco 5",
            "cliente_telefone": "11999990005",
            "tipo_pedido": "retirada",
            "itens": [
                {
                    "produto_id": "prod-char-simples",
                    "quantidade": 2,
                    "modificador_ids": ["mod-char-bacon"],
                }
            ],
        }
        res = char_client.post("/cardapio/pedidos", json=payload)
        assert res.status_code == 201
        data = res.json()
        assert data["total"] == 60.0

    def test_pricing_same_product_different_modifiers_in_single_order(self, char_client, char_setup):
        """[OBSERVADO] Mesmo produto em 2 itens distintos com adicionais diferentes acumulam corretamente.
        Item 1: Burguer + Bacon (R$ 30.00)
        Item 2: Burguer + Cheddar (R$ 29.00)
        Total = R$ 59.00
        """
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Cliente Preco 6",
            "cliente_telefone": "11999990006",
            "tipo_pedido": "retirada",
            "itens": [
                {
                    "produto_id": "prod-char-simples",
                    "quantidade": 1,
                    "modificador_ids": ["mod-char-bacon"],
                    "observacao": "Sem picles",
                },
                {
                    "produto_id": "prod-char-simples",
                    "quantidade": 1,
                    "modificador_ids": ["mod-char-cheddar"],
                    "observacao": "Bem passado",
                },
            ],
        }
        res = char_client.post("/cardapio/pedidos", json=payload)
        assert res.status_code == 201
        data = res.json()
        assert data["total"] == 59.0

    def test_pricing_delivery_fee_applied(self, char_client, char_setup):
        """[OBSERVADO] Burguer (R$ 25.00) + Taxa do Servidor (R$ 7.00) = R$ 32.00 (taxa do cliente é ignorada por segurança)."""
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Cliente Preco 7",
            "cliente_telefone": "11999990007",
            "tipo_pedido": "delivery",
            "endereco_entrega": "Av. Central, 456",
            "taxa_entrega": 8.50,
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
        data = res.json()
        assert data["total"] == 32.00

    def test_pricing_percentage_discount_coupon(self, char_client, char_setup):
        """[OBSERVADO] 2x Burguer (R$ 50.00) com Cupom CHAR10 (10%) = R$ 45.00."""
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Cliente Preco 8",
            "cliente_telefone": "11999990008",
            "tipo_pedido": "retirada",
            "cupom_codigo": "CHAR10",
            "itens": [
                {
                    "produto_id": "prod-char-simples",
                    "quantidade": 2,
                    "modificador_ids": [],
                }
            ],
        }
        res = char_client.post("/cardapio/pedidos", json=payload)
        assert res.status_code == 201
        data = res.json()
        assert data["total"] == 45.0

    def test_pricing_fixed_discount_coupon(self, char_client, char_setup):
        """[OBSERVADO] 2x Burguer (R$ 50.00) com Cupom FIXO15 (R$ 15.00 de desconto) = R$ 35.00."""
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Cliente Preco 9",
            "cliente_telefone": "11999990009",
            "tipo_pedido": "retirada",
            "cupom_codigo": "FIXO15",
            "itens": [
                {
                    "produto_id": "prod-char-simples",
                    "quantidade": 2,
                    "modificador_ids": [],
                }
            ],
        }
        res = char_client.post("/cardapio/pedidos", json=payload)
        assert res.status_code == 201
        data = res.json()
        assert data["total"] == 35.0

    def test_pricing_coupon_with_modifiers_and_delivery(self, char_client, char_setup):
        """[OBSERVADO]
        2x (Burguer R$ 25.00 + Bacon R$ 5.00) = Subtotal R$ 60.00
        Desconto CHAR10 (10% de R$ 60.00) = - R$ 6.00
        Taxa de Entrega Servidor = + R$ 7.00
        Total final esperado = R$ 61.00
        """
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Cliente Preco 10",
            "cliente_telefone": "11999990010",
            "tipo_pedido": "delivery",
            "endereco_entrega": "Rua das Acácias, 89",
            "taxa_entrega": 10.00,
            "cupom_codigo": "CHAR10",
            "itens": [
                {
                    "produto_id": "prod-char-simples",
                    "quantidade": 2,
                    "modificador_ids": ["mod-char-bacon"],
                }
            ],
        }
        res = char_client.post("/cardapio/pedidos", json=payload)
        assert res.status_code == 201
        data = res.json()
        assert data["total"] == 61.0

    def test_pricing_coupon_below_minimum_is_ignored_silently(self, char_client, char_setup):
        """[OBSERVADO] 1x Burguer (R$ 25.00) com Cupom FIXO15 (mínimo R$ 40.00): cupom é ignorado e pedido criado a R$ 25.00."""
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Cliente Preco 11",
            "cliente_telefone": "11999990011",
            "tipo_pedido": "retirada",
            "cupom_codigo": "FIXO15",
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
        assert res.json()["total"] == 25.0

    def test_pricing_multiple_modifiers_with_different_prices_quantity_2(self, char_client, char_setup):
        """[OBSERVADO] 2x (Burguer R$ 25.00 + Bacon R$ 5.00 + Cheddar R$ 4.00) = 2 * 34.00 = R$ 68.00."""
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Cliente Preco 12",
            "cliente_telefone": "11999990012",
            "tipo_pedido": "retirada",
            "itens": [
                {
                    "produto_id": "prod-char-simples",
                    "quantidade": 2,
                    "modificador_ids": ["mod-char-bacon", "mod-char-cheddar"],
                }
            ],
        }
        res = char_client.post("/cardapio/pedidos", json=payload)
        assert res.status_code == 201
        assert res.json()["total"] == 68.0

    def test_pricing_cashback_applied_reduces_total(self, char_client, char_setup):
        """[OBSERVADO] Cliente com R$ 6.00 de cashback usando cashback em pedido de R$ 25.00 paga R$ 19.00."""
        from app.database import SessionLocal
        from app.models import Cliente

        phone = "11999990013"
        db = SessionLocal()
        try:
            cli = db.query(Cliente).filter(
                Cliente.restaurante_id == CHAR_RESTAURANT_ID,
                Cliente.telefone == phone,
            ).first()
            if not cli:
                cli = Cliente(
                    id="cli-char-cashback",
                    restaurante_id=CHAR_RESTAURANT_ID,
                    nome="Cliente Cashback",
                    telefone=phone,
                    saldo_cashback=6.00,
                )
                db.add(cli)
            else:
                cli.saldo_cashback = 6.00
            db.commit()
        finally:
            db.close()

        from app.services.customer_auth import create_customer_access_token

        cust_token = create_customer_access_token(
            cliente_id="cli-char-cashback",
            restaurante_id=CHAR_RESTAURANT_ID,
        )
        cust_headers = {"X-Koma-Customer-Token": cust_token}

        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Cliente Cashback",
            "cliente_telefone": phone,
            "tipo_pedido": "retirada",
            "usar_cashback": True,
            "itens": [
                {
                    "produto_id": "prod-char-simples",
                    "quantidade": 1,
                    "modificador_ids": [],
                }
            ],
        }
        res = char_client.post("/cardapio/pedidos", json=payload, headers=cust_headers)
        assert res.status_code == 201
        data = res.json()
        # 25.00 - 6.00 = 19.00
        assert data["total"] == 19.0

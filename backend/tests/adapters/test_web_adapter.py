"""Testes unitários e de integração do CardapioWebAdapter (Fase 4)."""

import pytest
from unittest.mock import patch, MagicMock
from decimal import Decimal
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.application.orders.commands import CreateOrderCommand
from app.application.orders.service import OrderApplicationService
from app.database import SessionLocal
from app.domain.orders.types import FulfillmentType, OrderChannel
from app.models import (
    Comanda,
    ConfiguracaoRestaurante,
    Item,
    Lancamento,
    Produto,
    Restaurante,
    Usuario,
)
from tests.characterization.orders.fixtures import (
    char_client,
    char_setup,
    CHAR_RESTAURANT_ID,
)


@patch("app.routes.cardapio._enforce_public_order_rate_limits", lambda *args, **kwargs: None)
@patch("app.adapters.orders.web_adapter._enforce_public_order_rate_limits", lambda *args, **kwargs: None)
class TestCardapioWebAdapter:
    """Valida o comportamento e a delegação do WebAdapter."""

    def test_web_adapter_delegates_to_order_application_service(self, char_client, char_setup):
        """[PROVA ESTRUTURAL] A rota POST /cardapio/pedidos delega a criação ao OrderApplicationService."""
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Adapter Spy Test",
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

        with patch.object(
            OrderApplicationService,
            "create_order",
            wraps=OrderApplicationService.create_order,
        ) as spy_create_order:
            res = char_client.post("/cardapio/pedidos", json=payload)
            assert res.status_code == 201
            assert spy_create_order.called
            cmd: CreateOrderCommand = spy_create_order.call_args[0][1]
            assert isinstance(cmd, CreateOrderCommand)
            assert cmd.restaurant_id == CHAR_RESTAURANT_ID
            assert cmd.channel == OrderChannel.WEB_CARDAPIO
            assert cmd.fulfillment == FulfillmentType.PICKUP
            assert cmd.customer.name == "Adapter Spy Test"
            assert cmd.customer.phone == "11999990001"
            assert len(cmd.items) == 1
            assert cmd.items[0].product_id == "prod-char-simples"

    def test_web_adapter_response_contract_matches_legacy(self, char_client, char_setup):
        """[CONTRATO] A resposta HTTP possui exatamente as chaves e tipos esperados pelo frontend."""
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Contract Tester",
            "cliente_telefone": "11999990002",
            "tipo_pedido": "delivery",
            "endereco_entrega": "Av. Teste Contrato, 42",
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

        assert data["status"] == "success"
        assert data["message"] == "Pedido enviado e integrado ao caixa com sucesso!"
        assert isinstance(data["id"], str) and data["id"].startswith("c-")
        assert data["comanda_id"] == data["id"]
        assert isinstance(data["numero_pedido"], int)
        assert isinstance(data["total"], (int, float))
        assert data["total"] == 57.0  # (25 * 2) + 7.0 delivery fee
        assert data["pagamento"] == {
            "status": "pendente_no_atendimento",
            "cobranca_online": False,
        }

    def test_web_adapter_authoritative_delivery_fee_ignores_client_tampering(self, char_client, char_setup):
        """[SEGURANÇA] O WebAdapter não confia no valor de taxa_entrega adulterado enviado pelo cliente."""
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Hacker Frete",
            "cliente_telefone": "11999990003",
            "tipo_pedido": "delivery",
            "endereco_entrega": "Rua Invasao, 1",
            "taxa_entrega": 0.01,  # Tentativa de adulteração para R$ 0,01
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
            comanda = db.query(Comanda).filter(Comanda.id == comanda_id).first()
            assert comanda is not None
            assert comanda.delivery_taxa == 7.0  # Política oficial aplicada
        finally:
            db.close()

    def test_web_adapter_rejects_closed_restaurant_policy(self, char_client, char_setup):
        """[POLÍTICA] Quando accepting_orders=False, retorna 409 com motivo da política."""
        db = SessionLocal()
        try:
            rest = db.query(Restaurante).filter(Restaurante.id == CHAR_RESTAURANT_ID).first()
            rest.status_override = "fechado"
            db.commit()
        finally:
            db.close()

        try:
            payload = {
                "restaurante_id": CHAR_RESTAURANT_ID,
                "cliente_nome": "Cliente Pausado",
                "cliente_telefone": "11999990004",
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
            assert res.status_code == 409
            assert "fechado" in res.json()["detail"].lower()
        finally:
            db = SessionLocal()
            rest = db.query(Restaurante).filter(Restaurante.id == CHAR_RESTAURANT_ID).first()
            rest.status_override = "automatico"
            db.commit()
            db.close()

    def test_web_adapter_rejects_inactive_product(self, char_client, char_setup):
        """[CATÁLOGO] Produto inativo resulta em 404 padronizado."""
        db = SessionLocal()
        try:
            prod = db.query(Produto).filter(Produto.id == "prod-char-simples").first()
            prod.ativo = False
            db.commit()
        finally:
            db.close()

        try:
            payload = {
                "restaurante_id": CHAR_RESTAURANT_ID,
                "cliente_nome": "Cliente Prod Inativo",
                "cliente_telefone": "11999990005",
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
            assert res.status_code == 404
            assert "prod-char-simples" in res.json()["detail"]
        finally:
            db = SessionLocal()
            prod = db.query(Produto).filter(Produto.id == "prod-char-simples").first()
            prod.ativo = True
            db.commit()
            db.close()

    def test_web_adapter_idempotency_replay(self, char_client, char_setup):
        """[IDEMPOTÊNCIA] Replay com mesma idempotency_key retorna comanda existente sem duplicar."""
        key = "idemp-webadapter-12345"
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Idempotent User",
            "cliente_telefone": "11999990006",
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
        res1 = char_client.post("/cardapio/pedidos", json=payload)
        assert res1.status_code == 201
        data1 = res1.json()

        res2 = char_client.post("/cardapio/pedidos", json=payload)
        assert res2.status_code == 200 or res2.status_code == 201
        data2 = res2.json()

        assert data1["comanda_id"] == data2["comanda_id"]
        assert data1["numero_pedido"] == data2["numero_pedido"]

        db = SessionLocal()
        try:
            comandas_count = db.query(Comanda).filter(
                Comanda.restaurante_id == CHAR_RESTAURANT_ID,
                Comanda.idempotency_key == key,
            ).count()
            assert comandas_count == 1
        finally:
            db.close()

"""Testes unitários e de integração do PosAdapter (Fase 5A)."""

from __future__ import annotations

import pytest
from unittest.mock import patch, MagicMock
from decimal import Decimal
from fastapi.testclient import TestClient

from app.application.orders.commands import CreateOrderCommand
from app.application.orders.service import OrderApplicationService
from app.database import SessionLocal
from app.domain.orders.types import FulfillmentType, OrderChannel
from app.models import CaixaTurno, Comanda, ConfiguracaoRestaurante, Item, Lancamento
from tests.characterization.orders.fixtures import (
    CHAR_RESTAURANT_ID,
    char_client,
    char_setup,
)


class TestPosAdapter:
    """Valida o comportamento e a delegação do PosAdapter."""

    def test_pos_adapter_delegates_to_order_application_service(self, char_client, char_setup):
        """[PROVA ESTRUTURAL] A rota POST /comandas/venda-direta delega ao OrderApplicationService."""
        headers = char_setup["headers"]
        payload = {
            "tipo": "balcao",
            "itens": [
                {
                    "produto_id": "prod-char-simples",
                    "observacao": "Sem cebola",
                }
            ],
        }

        with patch.object(
            OrderApplicationService,
            "create_order",
            wraps=OrderApplicationService.create_order,
        ) as spy_create:
            res = char_client.post("/comandas/venda-direta", json=payload, headers=headers)
            assert res.status_code == 201

            spy_create.assert_called_once()
            _, kwargs = spy_create.call_args
            cmd: CreateOrderCommand = spy_create.call_args[0][1]

            assert cmd.channel == OrderChannel.POS
            assert cmd.fulfillment == FulfillmentType.PICKUP
            assert cmd.restaurant_id == CHAR_RESTAURANT_ID
            assert len(cmd.items) == 1
            assert cmd.items[0].product_id == "prod-char-simples"

    def test_pos_adapter_response_contract_matches_comanda_detail(self, char_client, char_setup):
        """[CONTRATO HTTP] A resposta da venda direta contém todos os campos de ComandaDetail."""
        headers = char_setup["headers"]
        payload = {
            "tipo": "balcao",
            "itens": [
                {
                    "produto_id": "prod-char-simples",
                }
            ],
        }

        res = char_client.post("/comandas/venda-direta", json=payload, headers=headers)
        assert res.status_code == 201
        data = res.json()

        # Invariantes do contrato ComandaDetail
        assert "id" in data
        assert "numero_pedido" in data
        assert "tipo" in data
        assert "fechada" in data
        assert "criado_em" in data
        assert "itens" in data
        assert "lancamentos" in data
        assert isinstance(data["itens"], list)
        assert isinstance(data["lancamentos"], list)
        assert len(data["itens"]) == 1
        assert len(data["lancamentos"]) == 1
        assert data["itens"][0]["produto_id"] == "prod-char-simples"
        assert data["lancamentos"][0]["origem"] == "caixa"

    def test_pos_adapter_requires_open_cash_shift(self, char_client, char_setup):
        """[POLÍTICA] O caixa precisa estar aberto para processar venda direta."""
        headers = char_setup["headers"]
        db = SessionLocal()
        try:
            turno = db.query(CaixaTurno).filter(
                CaixaTurno.restaurante_id == CHAR_RESTAURANT_ID,
                CaixaTurno.status == "aberto",
            ).first()
            if turno:
                turno.status = "fechado"
                db.commit()
        finally:
            db.close()

        try:
            payload = {
                "tipo": "balcao",
                "itens": [{"produto_id": "prod-char-simples"}],
            }
            res = char_client.post("/comandas/venda-direta", json=payload, headers=headers)
            assert res.status_code == 409
            assert "caixa precisa estar aberto" in res.json()["detail"]
        finally:
            # Reabrir turno
            db = SessionLocal()
            turno = db.query(CaixaTurno).filter(
                CaixaTurno.restaurante_id == CHAR_RESTAURANT_ID,
            ).first()
            if turno:
                turno.status = "aberto"
                db.commit()
            db.close()

    def test_pos_adapter_accepts_dine_in_without_table(self, char_client, char_setup):
        """[CONTRATO] Consumo no Local pode nascer sem mesa associada."""
        headers = char_setup["headers"]
        payload = {
            "tipo": "mesa",
            "mesa_id": None,
            "itens": [{"produto_id": "prod-char-simples"}],
        }
        res = char_client.post("/comandas/venda-direta", json=payload, headers=headers)
        assert res.status_code == 201
        data = res.json()
        assert data["tipo"] == "Consumo no Local"
        assert data["mesa_id"] is None
        assert data["delivery_status"] == "producao"

    def test_pos_adapter_accepts_pickup_associated_with_table(self, char_client, char_setup):
        """[CONTRATO] Retirada preserva a mesa opcional sem mudar de modalidade."""
        headers = char_setup["headers"]
        payload = {
            "tipo": "retirada",
            "mesa_id": 1,
            "identificador": "Cliente Retirada",
            "delivery_telefone": "81999997777",
            "delivery_forma_pagamento": "pix",
            "itens": [{"produto_id": "prod-char-simples"}],
        }
        res = char_client.post("/comandas/venda-direta", json=payload, headers=headers)
        assert res.status_code == 201
        data = res.json()
        assert data["tipo"] == "Retirada"
        assert data["mesa_id"] == 1
        assert data["delivery_status"] == "producao"
        assert data["delivery_forma_pagamento"] == "pix"

    def test_pos_adapter_preserves_payment_method_in_canonical_command(self, char_client, char_setup):
        headers = char_setup["headers"]
        payload = {
            "tipo": "retirada",
            "identificador": "Cliente Retirada",
            "delivery_telefone": "81999997777",
            "delivery_forma_pagamento": "cartao_debito",
            "itens": [{"produto_id": "prod-char-simples"}],
        }

        with patch.object(
            OrderApplicationService,
            "create_order",
            wraps=OrderApplicationService.create_order,
        ) as spy_create:
            response = char_client.post("/comandas/venda-direta", json=payload, headers=headers)

        assert response.status_code == 201
        cmd: CreateOrderCommand = spy_create.call_args[0][1]
        assert cmd.payment_method == "cartao_debito"

    def test_pos_adapter_rejects_delivery_associated_with_table(self, char_client, char_setup):
        """[CONTRATO] Delivery usa endereço como referência e não aceita mesa."""
        headers = char_setup["headers"]
        payload = {
            "tipo": "entrega",
            "mesa_id": 1,
            "identificador": "Cliente Delivery",
            "delivery_telefone": "81999998888",
            "delivery_endereco": "Rua de Teste, 100",
            "itens": [{"produto_id": "prod-char-simples"}],
        }
        res = char_client.post("/comandas/venda-direta", json=payload, headers=headers)
        assert res.status_code == 422
        assert res.json()["detail"] == "Pedidos de delivery não podem ser vinculados a uma mesa."

    def test_pos_adapter_allows_all_modes_when_canonical_policy_active(self, char_client, char_setup):
        """[REGRESSÃO CTM-409] Tenant com consumo_local, retirada e delivery permite os 4 canais."""
        db = SessionLocal()
        config = db.query(ConfiguracaoRestaurante).filter(
            ConfiguracaoRestaurante.restaurante_id == CHAR_RESTAURANT_ID,
        ).first()
        old_modes = config.tipos_pedido_ativos
        config.tipos_pedido_ativos = ["consumo_local", "retirada", "delivery"]
        db.commit()
        db.close()

        headers = char_setup["headers"]
        try:
            # A. Venda rápida / Balcão
            res_balcao = char_client.post("/comandas/venda-direta", headers=headers, json={
                "tipo": "balcao",
                "itens": [{"produto_id": "prod-char-simples"}],
            })
            assert res_balcao.status_code == 201
            assert res_balcao.json()["tipo"] == "Retirada"

            # B. Retirada com cliente e telefone
            res_retirada = char_client.post("/comandas/venda-direta", headers=headers, json={
                "tipo": "retirada",
                "identificador": "Cliente Retirada",
                "delivery_telefone": "85999991111",
                "itens": [{"produto_id": "prod-char-simples"}],
            })
            assert res_retirada.status_code == 201

            # C. Consumo no Local
            res_dine_in = char_client.post("/comandas/venda-direta", headers=headers, json={
                "tipo": "consumo no local",
                "itens": [{"produto_id": "prod-char-simples"}],
            })
            assert res_dine_in.status_code == 201
            assert res_dine_in.json()["tipo"] == "Consumo no Local"

            # D. Delivery
            res_delivery = char_client.post("/comandas/venda-direta", headers=headers, json={
                "tipo": "delivery",
                "identificador": "Cliente Entrega",
                "delivery_telefone": "85999992222",
                "delivery_endereco": "Av. Beira Mar, 500",
                "itens": [{"produto_id": "prod-char-simples"}],
            })
            assert res_delivery.status_code == 201
            assert res_delivery.json()["tipo"] == "Entrega"
        finally:
            db = SessionLocal()
            config = db.query(ConfiguracaoRestaurante).filter(
                ConfiguracaoRestaurante.restaurante_id == CHAR_RESTAURANT_ID,
            ).first()
            config.tipos_pedido_ativos = old_modes
            db.commit()
            db.close()

    def test_pos_adapter_rejects_disabled_mode_with_409(self, char_client, char_setup):
        """[REGRESSÃO CTM-409] Modalidade verdadeiramente desativada retorna 409 sem enfraquecer o gate."""
        db = SessionLocal()
        config = db.query(ConfiguracaoRestaurante).filter(
            ConfiguracaoRestaurante.restaurante_id == CHAR_RESTAURANT_ID,
        ).first()
        old_modes = config.tipos_pedido_ativos
        config.tipos_pedido_ativos = ["retirada", "delivery"]  # consumo_local desativado
        db.commit()
        db.close()

        headers = char_setup["headers"]
        try:
            # Consumo local deve falhar com 409
            res_disabled = char_client.post("/comandas/venda-direta", headers=headers, json={
                "tipo": "consumo no local",
                "itens": [{"produto_id": "prod-char-simples"}],
            })
            assert res_disabled.status_code == 409
            assert "Esta modalidade de pedido está desativada para o restaurante." in res_disabled.json()["detail"]

            # Retirada/balcão continua permitido normalmente
            res_allowed = char_client.post("/comandas/venda-direta", headers=headers, json={
                "tipo": "balcao",
                "itens": [{"produto_id": "prod-char-simples"}],
            })
            assert res_allowed.status_code == 201
        finally:
            db = SessionLocal()
            config = db.query(ConfiguracaoRestaurante).filter(
                ConfiguracaoRestaurante.restaurante_id == CHAR_RESTAURANT_ID,
            ).first()
            config.tipos_pedido_ativos = old_modes
            db.commit()
            db.close()

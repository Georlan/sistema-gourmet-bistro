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
from app.models import CaixaTurno, Comanda, Item, Lancamento
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

    def test_pos_adapter_rejects_missing_table_for_dine_in(self, char_client, char_setup):
        """[VALIDAÇÃO] Consumo no Local sem mesa é rejeitado."""
        headers = char_setup["headers"]
        payload = {
            "tipo": "mesa",
            "mesa_id": None,
            "itens": [{"produto_id": "prod-char-simples"}],
        }
        res = char_client.post("/comandas/venda-direta", json=payload, headers=headers)
        assert res.status_code == 422
        assert "Selecione uma mesa" in res.json()["detail"]

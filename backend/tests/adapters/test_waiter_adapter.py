"""Testes unitários e estruturais do WaiterAdapter (Fase 5B)."""

from __future__ import annotations

import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient

from app.application.orders.commands import CreateOrderCommand
from app.application.orders.service import OrderApplicationService
from app.database import SessionLocal
from app.domain.orders.types import FulfillmentType, OrderChannel
from app.models import CaixaTurno, Comanda, Lancamento
from tests.characterization.orders.fixtures import (
    CHAR_RESTAURANT_ID,
    char_client,
    char_setup,
)


class TestWaiterAdapter:
    """Valida o comportamento de borda, delegação e contrato do WaiterAdapter."""

    def test_waiter_adapter_delegates_to_order_application_service(
        self, char_client: TestClient, char_setup: dict
    ):
        """[PROVA ESTRUTURAL] A rota POST /comandas/{id}/lancamentos delega ao OrderApplicationService com channel=WAITER."""
        headers = char_setup["headers"]

        db = SessionLocal()
        try:
            from app.models import Mesa
            m20 = db.query(Mesa).filter(Mesa.restaurante_id == CHAR_RESTAURANT_ID, Mesa.id == 20).first()
            if not m20:
                m20 = Mesa(id=20, restaurante_id=CHAR_RESTAURANT_ID, capacidade=4, nome="Mesa 20")
                db.add(m20)
            db.query(Comanda).filter(Comanda.restaurante_id == CHAR_RESTAURANT_ID, Comanda.mesa_id == 20).update({"fechada": True})
            db.commit()
        finally:
            db.close()

        # Cria comanda
        res_venda = char_client.post(
            "/comandas/venda-direta",
            json={"tipo": "mesa", "mesa_id": 20, "itens": [{"produto_id": "prod-char-refri"}]},
            headers=headers,
        )
        assert res_venda.status_code == 201
        comanda_id = res_venda.json()["id"]

        payload = {
            "garcom_id": "usr-char-garcom",
            "itens": [
                {
                    "produto_id": "prod-char-simples",
                    "observacao": "Sem maionese",
                }
            ],
        }

        with patch.object(
            OrderApplicationService,
            "create_order",
            wraps=OrderApplicationService.create_order,
        ) as spy_create:
            res = char_client.post(
                f"/comandas/{comanda_id}/lancamentos",
                json=payload,
                headers=headers,
            )
            assert res.status_code == 201

            spy_create.assert_called_once()
            cmd: CreateOrderCommand = spy_create.call_args[0][1]

            assert cmd.channel == OrderChannel.WAITER
            assert cmd.check_id == comanda_id
            assert cmd.table_id == "20"
            assert cmd.fulfillment == FulfillmentType.DINE_IN
            assert len(cmd.items) == 1
            assert cmd.items[0].product_id == "prod-char-simples"
            assert cmd.items[0].notes == "Sem maionese"

    def test_waiter_adapter_response_contract_matches_lancamento_response(
        self, char_client: TestClient, char_setup: dict
    ):
        """[CONTRATO HTTP] A resposta do lançamento contém todos os campos de LancamentoResponse."""
        headers = char_setup["headers"]

        res_venda = char_client.post(
            "/comandas/venda-direta",
            json={"tipo": "balcao", "itens": [{"produto_id": "prod-char-refri"}]},
            headers=headers,
        )
        comanda_id = res_venda.json()["id"]

        payload = {
            "garcom_id": "usr-char-garcom",
            "itens": [{"produto_id": "prod-char-simples"}],
        }

        res = char_client.post(
            f"/comandas/{comanda_id}/lancamentos",
            json=payload,
            headers=headers,
        )
        assert res.status_code == 201
        data = res.json()

        # Invariantes de LancamentoResponse
        assert "id" in data
        assert "comanda_id" in data
        assert data["comanda_id"] == comanda_id
        assert "garcom_id" in data
        assert data["garcom_id"] == "usr-char-garcom"
        assert "origem" in data
        assert "timestamp" in data
        assert "itens" in data
        assert isinstance(data["itens"], list)
        assert len(data["itens"]) == 1
        assert data["itens"][0]["produto_id"] == "prod-char-simples"
        assert data["itens"][0]["status"] == "preparando"

    def test_waiter_adapter_requires_open_cash_shift(
        self, char_client: TestClient, char_setup: dict
    ):
        """[POLÍTICA] O caixa precisa estar aberto para permitir lançamentos do garçom."""
        headers = char_setup["headers"]

        res_venda = char_client.post(
            "/comandas/venda-direta",
            json={"tipo": "balcao", "itens": [{"produto_id": "prod-char-refri"}]},
            headers=headers,
        )
        comanda_id = res_venda.json()["id"]

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
                "garcom_id": "usr-char-garcom",
                "itens": [{"produto_id": "prod-char-simples"}],
            }
            res = char_client.post(
                f"/comandas/{comanda_id}/lancamentos",
                json=payload,
                headers=headers,
            )
            assert res.status_code == 409
            assert "caixa precisa estar aberto" in res.json()["detail"]
        finally:
            db = SessionLocal()
            turno = db.query(CaixaTurno).filter(
                CaixaTurno.restaurante_id == CHAR_RESTAURANT_ID,
            ).first()
            if turno:
                turno.status = "aberto"
                db.commit()
            db.close()

    def test_waiter_adapter_rejects_closed_counter_comanda(
        self, char_client: TestClient, char_setup: dict
    ):
        """[VALIDAÇÃO] Lançamento em comanda de balcão já fechada é rejeitado com 400."""
        headers = char_setup["headers"]

        res_venda = char_client.post(
            "/comandas/venda-direta",
            json={"tipo": "balcao", "itens": [{"produto_id": "prod-char-refri"}]},
            headers=headers,
        )
        comanda_id = res_venda.json()["id"]

        # Fecha a comanda de balcão
        db = SessionLocal()
        try:
            comanda = db.query(Comanda).filter(Comanda.id == comanda_id).first()
            comanda.fechada = True
            db.commit()
        finally:
            db.close()

        payload = {
            "garcom_id": "usr-char-garcom",
            "itens": [{"produto_id": "prod-char-simples"}],
        }
        res = char_client.post(
            f"/comandas/{comanda_id}/lancamentos",
            json=payload,
            headers=headers,
        )
        assert res.status_code == 400
        assert "Comanda já fechada" in res.json()["detail"]

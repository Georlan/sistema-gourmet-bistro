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

    def test_waiter_adapter_preserves_delivery_fulfillment_for_delivery_comanda(
        self, char_client: TestClient, char_setup: dict
    ):
        """[CANAL DELIVERY] Garçom lançando itens em comanda Delivery preserva fulfillment DELIVERY e status pendente."""
        headers = char_setup["headers"]

        db = SessionLocal()
        try:
            cmd = Comanda(
                id="cmd-char-waiter-delivery",
                restaurante_id=CHAR_RESTAURANT_ID,
                garcom_id="usr-char-garcom",
                numero_pedido=99,
                tipo="Delivery",
                delivery_status="pendente",
                delivery_endereco="Rua Teste, 100",
                delivery_telefone="11999999999",
                fechada=False,
            )
            db.add(cmd)
            db.commit()
        finally:
            db.close()

        payload = {
            "garcom_id": "usr-char-garcom",
            "itens": [{"produto_id": "prod-char-simples"}],
        }

        with patch.object(
            OrderApplicationService,
            "create_order",
            wraps=OrderApplicationService.create_order,
        ) as spy_create:
            res = char_client.post(
                "/comandas/cmd-char-waiter-delivery/lancamentos",
                json=payload,
                headers=headers,
            )
            assert res.status_code == 201

            spy_create.assert_called_once()
            cmd: CreateOrderCommand = spy_create.call_args[0][1]
            assert cmd.fulfillment == FulfillmentType.DELIVERY

        db = SessionLocal()
        try:
            lancamento_db = db.query(Lancamento).filter(Lancamento.id == res.json()["id"]).first()
            assert lancamento_db is not None
            assert lancamento_db.status == "pendente"
            comanda_db = db.query(Comanda).filter(Comanda.id == "cmd-char-waiter-delivery").first()
            assert comanda_db is not None
            assert comanda_db.delivery_status == "pendente"
        finally:
            db.close()

    def test_waiter_modifiers_adapter_preserves_delivery_fulfillment_for_delivery_comanda(
        self, char_client: TestClient, char_setup: dict
    ):
        """[CANAL DELIVERY] Garçom lançando itens com modificadores em comanda Delivery preserva fulfillment DELIVERY."""
        headers = char_setup["headers"]

        comanda_id = "cmd-char-waiter-mods-deliv"
        db = SessionLocal()
        try:
            cmd = Comanda(
                id=comanda_id,
                restaurante_id=CHAR_RESTAURANT_ID,
                garcom_id="usr-char-garcom",
                numero_pedido=100,
                tipo="Delivery",
                delivery_status="pendente",
                delivery_endereco="Av Paulista, 1000",
                delivery_telefone="11988888888",
                fechada=False,
            )
            db.add(cmd)
            db.commit()
        finally:
            db.close()

        payload = {
            "garcom_id": "usr-char-garcom",
            "itens": [{"produto_id": "prod-char-simples", "modificador_ids": []}],
        }

        with patch.object(
            OrderApplicationService,
            "create_order",
            wraps=OrderApplicationService.create_order,
        ) as spy_create:
            res = char_client.post(
                f"/cardapio/modificadores/lancamentos/{comanda_id}",
                json=payload,
                headers=headers,
            )
            assert res.status_code == 200

            spy_create.assert_called_once()
            cmd: CreateOrderCommand = spy_create.call_args[0][1]
            assert cmd.fulfillment == FulfillmentType.DELIVERY

        db = SessionLocal()
        try:
            lancamento_db = db.query(Lancamento).filter(Lancamento.id == res.json()["id"]).first()
            assert lancamento_db is not None
            assert lancamento_db.status == "pendente"
            comanda_db = db.query(Comanda).filter(Comanda.id == "cmd-char-waiter-mods-deliv").first()
            assert comanda_db is not None
            assert comanda_db.delivery_status == "pendente"
        finally:
            db.close()



def test_waiter_launch_serializes_without_post_commit_database_reads(char_client, char_setup):
    """The committed response and notification must use the materialized snapshot."""
    from sqlalchemy import event
    from sqlalchemy.orm import Session
    from app.database import engine
    headers = char_setup["headers"]
    created = char_client.post(
        "/comandas/venda-direta", headers=headers,
        json={"tipo": "balcao", "itens": [{"produto_id": "prod-char-refri"}]},
    )
    assert created.status_code == 201
    committed = False
    reads = []

    def after_commit(session):
        nonlocal committed
        committed = True

    def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        if committed and statement.lstrip().upper().startswith("SELECT"):
            reads.append(statement)

    event.listen(Session, "after_commit", after_commit)
    event.listen(engine, "before_cursor_execute", before_cursor_execute)
    try:
        response = char_client.post(
            f"/cardapio/modificadores/lancamentos/{created.json()['id']}",
            headers=headers,
            json={"garcom_id": "usr-char-garcom", "itens": [
                {"produto_id": "prod-char-simples", "modificador_ids": [], "observacao": "snapshot"},
            ]},
        )
    finally:
        event.remove(Session, "after_commit", after_commit)
        event.remove(engine, "before_cursor_execute", before_cursor_execute)
    assert response.status_code == 200, response.text
    assert committed
    assert response.json()["itens"][0]["produto"]["nome"]
    assert reads == [], reads


@pytest.mark.parametrize("item_count", [1, 12])
def test_waiter_replay_batches_modifier_lookup(char_client, char_setup, item_count):
    from sqlalchemy import event
    from app.database import engine
    headers = char_setup["headers"]
    created = char_client.post(
        "/comandas/venda-direta", headers=headers,
        json={"tipo": "balcao", "itens": [{"produto_id": "prod-char-refri"}]},
    )
    assert created.status_code == 201
    payload = {"garcom_id": "usr-char-garcom", "idempotency_key": f"waiter-query-budget-{item_count}",
               "itens": [{"produto_id": "prod-char-simples", "modificador_ids": [],
                          "observacao": f"item {index}"} for index in range(item_count)]}
    url = f"/cardapio/modificadores/lancamentos/{created.json()['id']}"
    first = char_client.post(url, headers=headers, json=payload)
    assert first.status_code == 200, first.text
    reads = []

    def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT") and "item_modificadores" in statement:
            reads.append(statement)

    event.listen(engine, "before_cursor_execute", before_cursor_execute)
    try:
        replay = char_client.post(url, headers=headers, json=payload)
    finally:
        event.remove(engine, "before_cursor_execute", before_cursor_execute)
    assert replay.status_code == 200, replay.text
    assert replay.json()["id"] == first.json()["id"]
    assert len(replay.json()["itens"]) == item_count
    assert len(reads) == 1, reads
    payload["itens"][0]["observacao"] = "different request"
    assert char_client.post(url, headers=headers, json=payload).status_code == 409

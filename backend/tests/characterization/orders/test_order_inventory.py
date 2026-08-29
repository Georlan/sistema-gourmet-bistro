"""Testes de caracterização: Congelamento das regras de movimentação de estoque por pedido."""

import pytest
from unittest.mock import patch
from app.database import SessionLocal
from app.models import Insumo, MovimentacaoEstoque
from .fixtures import char_client, char_setup, capture_order_snapshot, CHAR_RESTAURANT_ID


@patch("app.routes.cardapio._enforce_public_order_rate_limits", lambda *args, **kwargs: None)
@patch("app.services.whatsapp.enviar_notificacao_whatsapp_task", lambda *args, **kwargs: None)
class TestLegacyOrderInventory:
    def test_pending_order_does_not_consume_inventory(self, char_client, char_setup):
        """[OBSERVADO] Enquanto o pedido estiver PENDENTE, nenhum insumo é baixado no estoque."""
        headers = char_setup["headers"]
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Estoque Test 1",
            "cliente_telefone": "11977770001",
            "tipo_pedido": "delivery",
            "endereco_entrega": "Rua 1",
            "taxa_entrega": 5.0,
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
            snapshot = capture_order_snapshot(db, comanda_id)
            assert snapshot["delivery_status"] == "pendente"
            assert len(snapshot["movimentacoes_estoque"]) == 0
        finally:
            db.close()

    def test_accepting_order_consumes_inventory_via_recipe(self, char_client, char_setup):
        """[OBSERVADO] Aceitar o pedido (status -> 'producao') consome os insumos da ficha técnica."""
        headers = char_setup["headers"]
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Estoque Test 2",
            "cliente_telefone": "11977770002",
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
        comanda_id = res.json()["comanda_id"]

        # Operador aceita o pedido -> producao
        accept_res = char_client.put(
            f"/comandas/{comanda_id}/delivery/status",
            params={"status_novo": "producao"},
            headers=headers,
        )
        assert accept_res.status_code == 200

        db = SessionLocal()
        try:
            snapshot = capture_order_snapshot(db, comanda_id)
            assert snapshot["delivery_status"] == "producao"
            saidas = [m for m in snapshot["movimentacoes_estoque"] if m["tipo"] == "saida"]
            assert len(saidas) >= 2
            insumos_consumidos = {m["insumo_id"]: m["quantidade"] for m in saidas}
            assert insumos_consumidos.get("ins-char-pao") == 1.0
            assert insumos_consumidos.get("ins-char-carne") == 1.0
        finally:
            db.close()

    def test_retry_accepting_order_does_not_duplicate_inventory_deduction(self, char_client, char_setup):
        """[OBSERVADO] Chamar aceite quando o pedido já está em produção não duplica a baixa de estoque."""
        headers = char_setup["headers"]
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Estoque Test 3",
            "cliente_telefone": "11977770003",
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
        comanda_id = res.json()["comanda_id"]

        # Primeiro aceite
        char_client.put(
            f"/comandas/{comanda_id}/delivery/status",
            params={"status_novo": "producao"},
            headers=headers,
        )

        db = SessionLocal()
        try:
            movs_after_first = len(capture_order_snapshot(db, comanda_id)["movimentacoes_estoque"])
        finally:
            db.close()

        # Segundo aceite repetido
        char_client.put(
            f"/comandas/{comanda_id}/delivery/status",
            params={"status_novo": "producao"},
            headers=headers,
        )

        db = SessionLocal()
        try:
            movs_after_second = len(capture_order_snapshot(db, comanda_id)["movimentacoes_estoque"])
            assert movs_after_first == movs_after_second
        finally:
            db.close()

    def test_rejecting_pending_order_creates_no_stock_movements(self, char_client, char_setup):
        """[OBSERVADO] Recusar pedido pendente não gera movimentações nem estornos."""
        headers = char_setup["headers"]
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Estoque Test 4",
            "cliente_telefone": "11977770004",
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
        comanda_id = res.json()["comanda_id"]

        # Recusa direto de pendente -> recusado
        char_client.put(
            f"/comandas/{comanda_id}/delivery/status",
            params={"status_novo": "recusado"},
            headers=headers,
        )

        db = SessionLocal()
        try:
            snapshot = capture_order_snapshot(db, comanda_id)
            assert snapshot["delivery_status"] == "recusado"
            assert len(snapshot["movimentacoes_estoque"]) == 0
        finally:
            db.close()

    def test_cancelling_accepted_order_restores_inventory(self, char_client, char_setup):
        """[OBSERVADO] Cancelar pedido que já estava em 'producao' gera estorno dos insumos consumidos."""
        headers = char_setup["headers"]
        payload = {
            "restaurante_id": CHAR_RESTAURANT_ID,
            "cliente_nome": "Estoque Test 5",
            "cliente_telefone": "11977770005",
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
        comanda_id = res.json()["comanda_id"]

        # 1. Aceite
        char_client.put(
            f"/comandas/{comanda_id}/delivery/status",
            params={"status_novo": "producao"},
            headers=headers,
        )

        # 2. Cancelamento posterior
        char_client.put(
            f"/comandas/{comanda_id}/delivery/status",
            params={"status_novo": "recusado"},
            headers=headers,
        )

        db = SessionLocal()
        try:
            snapshot = capture_order_snapshot(db, comanda_id)
            assert snapshot["delivery_status"] == "recusado"
            estornos = [m for m in snapshot["movimentacoes_estoque"] if m["tipo"] == "ajuste_positivo"]
            # Deve haver estorno (ajuste_positivo) para os 2 insumos
            assert len(estornos) >= 2
            insumos_estornados = {m["insumo_id"]: m["quantidade"] for m in estornos}
            assert insumos_estornados.get("ins-char-pao") == 1.0
            assert insumos_estornados.get("ins-char-carne") == 1.0
        finally:
            db.close()

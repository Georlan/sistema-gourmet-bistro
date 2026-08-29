"""Testes de caracterização: Congelamento da criação de pedidos presenciais no PDV / Balcão (Fase 5A)."""

from __future__ import annotations

import pytest
from unittest.mock import patch
from app.database import SessionLocal
from app.models import Comanda, Item, Lancamento, MovimentacaoEstoque, Produto
from .fixtures import (
    CHAR_RESTAURANT_ID,
    capture_order_snapshot,
    char_client,
    char_setup,
)


class TestPosOrderCreation:
    """Valida o comportamento e a persistência de pedidos criados via PDV / Balcão (Venda Direta)."""

    def test_pos_counter_sale_creates_order_directly_in_production(self, char_client, char_setup):
        """[COMPORTAMENTO] Pedido de Balcão entra diretamente em 'producao' com origem 'caixa'."""
        headers = char_setup["headers"]
        payload = {
            "tipo": "balcao",
            "itens": [
                {
                    "produto_id": "prod-char-simples",
                    "observacao": "Sem cebola",
                    "cliente_nome": "Balcao 1",
                }
            ],
        }

        res = char_client.post("/comandas/venda-direta", json=payload, headers=headers)
        assert res.status_code == 201
        data = res.json()
        comanda_id = data["id"]

        db = SessionLocal()
        try:
            comanda = db.query(Comanda).filter(Comanda.id == comanda_id).first()
            assert comanda is not None
            assert comanda.tipo == "Retirada"
            assert comanda.identificador == "Balcão"
            assert comanda.delivery_status == "producao"

            # Lançamento associado
            assert len(comanda.lancamentos) == 1
            lanc = comanda.lancamentos[0]
            assert lanc.origem == "caixa"
            assert lanc.status == "producao"

            # Itens
            assert len(comanda.itens) == 1
            item = comanda.itens[0]
            assert item.produto_id == "prod-char-simples"
            assert item.preco_unit == 25.0
            assert item.status == "preparando"

            # Estoque baixado imediatamente para pedidos em produção
            movs = db.query(MovimentacaoEstoque).filter(
                MovimentacaoEstoque.restaurante_id == CHAR_RESTAURANT_ID,
                MovimentacaoEstoque.tipo == "saida",
            ).all()
            assert len(movs) > 0
        finally:
            db.close()

    def test_pos_pickup_sale_with_customer_info(self, char_client, char_setup):
        """[COMPORTAMENTO] Pedido de Retirada com nome e telefone entra em produção."""
        headers = char_setup["headers"]
        payload = {
            "tipo": "retirada",
            "identificador": "Mariana Balcao",
            "delivery_telefone": "11998877665",
            "itens": [
                {
                    "produto_id": "prod-char-simples",
                    "observacao": "Bem passado",
                }
            ],
        }

        res = char_client.post("/comandas/venda-direta", json=payload, headers=headers)
        assert res.status_code == 201
        data = res.json()
        comanda_id = data["id"]

        db = SessionLocal()
        try:
            comanda = db.query(Comanda).filter(Comanda.id == comanda_id).first()
            assert comanda is not None
            assert comanda.tipo == "Retirada"
            assert comanda.identificador == "Mariana Balcao"
            assert comanda.delivery_status == "producao"
            assert comanda.delivery_telefone == "11998877665"
        finally:
            db.close()

    def test_pos_delivery_sale_with_address_enters_production(self, char_client, char_setup):
        """[COMPORTAMENTO] Pedido de Delivery aberto no Caixa entra em produção (já aceito pelo operador)."""
        headers = char_setup["headers"]
        payload = {
            "tipo": "delivery",
            "identificador": "Pedro Delivery Caixa",
            "delivery_telefone": "11991122334",
            "delivery_endereco": "Rua do Caixa, 50",
            "delivery_taxa": 7.0,
            "itens": [
                {
                    "produto_id": "prod-char-simples",
                    "observacao": "",
                }
            ],
        }

        res = char_client.post("/comandas/venda-direta", json=payload, headers=headers)
        assert res.status_code == 201
        data = res.json()
        comanda_id = data["id"]

        db = SessionLocal()
        try:
            comanda = db.query(Comanda).filter(Comanda.id == comanda_id).first()
            assert comanda is not None
            assert comanda.tipo == "Entrega"
            assert comanda.identificador == "Pedro Delivery Caixa"
            assert comanda.delivery_status == "producao"
            assert comanda.delivery_endereco == "Rua do Caixa, 50"
            assert comanda.delivery_taxa == 7.0
        finally:
            db.close()

    def test_pos_idempotency_replay(self, char_client, char_setup):
        """[IDEMPOTÊNCIA] Replay de chave idempotente no PDV retorna a mesma venda sem duplicar."""
        headers = char_setup["headers"]
        key = "idemp-pos-test-999"
        payload = {
            "tipo": "balcao",
            "idempotency_key": key,
            "itens": [
                {
                    "produto_id": "prod-char-simples",
                    "observacao": "Replay test",
                }
            ],
        }

        res1 = char_client.post("/comandas/venda-direta", json=payload, headers=headers)
        assert res1.status_code == 201
        data1 = res1.json()

        res2 = char_client.post("/comandas/venda-direta", json=payload, headers=headers)
        assert res2.status_code in (200, 201)
        data2 = res2.json()

        assert data1["id"] == data2["id"]
        assert data1["numero_pedido"] == data2["numero_pedido"]

        db = SessionLocal()
        try:
            count = db.query(Comanda).filter(
                Comanda.restaurante_id == CHAR_RESTAURANT_ID,
                Comanda.idempotency_key == key,
            ).count()
            assert count == 1
        finally:
            db.close()

    def test_pos_rejects_inactive_product(self, char_client, char_setup):
        """[CATÁLOGO] Pedido no PDV com produto inativo é rejeitado."""
        headers = char_setup["headers"]
        db = SessionLocal()
        try:
            prod = db.query(Produto).filter(Produto.id == "prod-char-simples").first()
            prod.ativo = False
            db.commit()
        finally:
            db.close()

        try:
            payload = {
                "tipo": "balcao",
                "itens": [
                    {
                        "produto_id": "prod-char-simples",
                    }
                ],
            }
            res = char_client.post("/comandas/venda-direta", json=payload, headers=headers)
            assert res.status_code in (404, 422)
        finally:
            db = SessionLocal()
            prod = db.query(Produto).filter(Produto.id == "prod-char-simples").first()
            prod.ativo = True
            db.commit()
            db.close()

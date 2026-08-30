"""Testes de caracterização para lançamento de pedidos por garçom em comanda/mesa existente (Fase 5B)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import (
    CaixaTurno,
    Comanda,
    Item,
    Lancamento,
    Mesa,
    MovimentacaoEstoque,
    Produto,
)
from app.services.atendimentos import get_launch_identity
from tests.characterization.orders.fixtures import (
    CHAR_RESTAURANT_ID,
    char_client,
    char_setup,
)


class TestWaiterOrderCreation:
    """Testa o comportamento de borda e domínio ao lançar pedidos em comanda existente."""

    def test_waiter_launches_first_and_second_orders_with_canonical_identity(
        self, char_client: TestClient, char_setup: dict
    ):
        """[IDENTIDADE CANÔNICA] Dois lançamentos na mesma comanda de mesa recebem 24-A e 24-B."""
        headers = char_setup["headers"]

        db = SessionLocal()
        try:
            mesa10 = db.query(Mesa).filter(Mesa.restaurante_id == CHAR_RESTAURANT_ID, Mesa.id == 10).first()
            if not mesa10:
                mesa10 = Mesa(id=10, restaurante_id=CHAR_RESTAURANT_ID, capacidade=4, nome="Mesa 10")
                db.add(mesa10)
            # Fecha comandas antigas na mesa 10 se houver
            db.query(Comanda).filter(Comanda.restaurante_id == CHAR_RESTAURANT_ID, Comanda.mesa_id == 10).update({"fechada": True})
            db.commit()
        finally:
            db.close()

        # 1. Abre uma comanda de mesa pelo PDV
        venda_payload = {
            "tipo": "mesa",
            "mesa_id": 10,
            "itens": [
                {
                    "produto_id": "prod-char-simples",
                    "observacao": "Primeiro pedido",
                }
            ],
        }
        res_venda = char_client.post("/comandas/venda-direta", json=venda_payload, headers=headers)
        assert res_venda.status_code == 201
        comanda_id = res_venda.json()["id"]
        numero_comanda = res_venda.json()["numero_pedido"]

        # 2. Garçom lança segundo pedido na mesma comanda
        segundo_payload = {
            "garcom_id": "usr-char-garcom",
            "itens": [
                {
                    "produto_id": "prod-char-especial",
                    "observacao": "Segundo pedido",
                    "cliente_nome": "Cliente Mesa 10",
                }
            ],
        }
        res_lanc = char_client.post(
            f"/comandas/{comanda_id}/lancamentos",
            json=segundo_payload,
            headers=headers,
        )
        assert res_lanc.status_code == 201
        lanc_data = res_lanc.json()
        lancamento_2_id = lanc_data["id"]

        db = SessionLocal()
        try:
            # Verifica comanda e lançamentos
            comanda = db.query(Comanda).filter(Comanda.id == comanda_id).first()
            assert comanda is not None
            assert len(comanda.lancamentos) == 2

            # Verifica identidades operacionais
            id1 = get_launch_identity(db, CHAR_RESTAURANT_ID, comanda.lancamentos[0].id)
            id2 = get_launch_identity(db, CHAR_RESTAURANT_ID, lancamento_2_id)
            assert id1 is not None
            assert id2 is not None

            # Primeiro lançamento: 24-A (ou X-A)
            assert id1.sequencia == 1
            assert id1.label == f"{numero_comanda}-A"

            # Segundo lançamento: 24-B (ou X-B)
            assert id2.sequencia == 2
            assert id2.label == f"{numero_comanda}-B"

            # Itens do segundo lançamento estão preparando
            itens_lanc2 = (
                db.query(Item)
                .filter(Item.lancamento_id == lancamento_2_id)
                .all()
            )
            assert len(itens_lanc2) == 1
            assert itens_lanc2[0].produto_id == "prod-char-especial"
            assert itens_lanc2[0].status == "preparando"
        finally:
            db.close()

    def test_waiter_launch_consumes_inventory_immediately(
        self, char_client: TestClient, char_setup: dict
    ):
        """[ESTOQUE] Lançamento de garçom baixa estoque das fichas técnicas imediatamente."""
        headers = char_setup["headers"]

        # Cria comanda
        res_venda = char_client.post(
            "/comandas/venda-direta",
            json={"tipo": "balcao", "itens": [{"produto_id": "prod-char-refri"}]},
            headers=headers,
        )
        comanda_id = res_venda.json()["id"]

        db = SessionLocal()
        try:
            movs_antes = db.query(MovimentacaoEstoque).filter(
                MovimentacaoEstoque.restaurante_id == CHAR_RESTAURANT_ID,
                MovimentacaoEstoque.tipo == "saida",
            ).count()
        finally:
            db.close()

        # Garçom lança item com receita (prod-char-simples usa pão e carne)
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

        db = SessionLocal()
        try:
            movs_depois = db.query(MovimentacaoEstoque).filter(
                MovimentacaoEstoque.restaurante_id == CHAR_RESTAURANT_ID,
                MovimentacaoEstoque.tipo == "saida",
            ).count()
            # prod-char-simples consome 2 insumos (pão e carne)
            assert movs_depois == movs_antes + 2
        finally:
            db.close()

    def test_waiter_launch_idempotency_replay(
        self, char_client: TestClient, char_setup: dict
    ):
        """[IDEMPOTÊNCIA] Replay de chave idempotente no garçom retorna o mesmo lançamento sem duplicar."""
        headers = char_setup["headers"]
        key = "idemp-waiter-key-12345"

        res_venda = char_client.post(
            "/comandas/venda-direta",
            json={"tipo": "balcao", "itens": [{"produto_id": "prod-char-refri"}]},
            headers=headers,
        )
        comanda_id = res_venda.json()["id"]

        payload = {
            "garcom_id": "usr-char-garcom",
            "idempotency_key": key,
            "itens": [{"produto_id": "prod-char-simples", "observacao": "Idemp test"}],
        }

        res1 = char_client.post(f"/comandas/{comanda_id}/lancamentos", json=payload, headers=headers)
        assert res1.status_code == 201
        data1 = res1.json()

        res2 = char_client.post(f"/comandas/{comanda_id}/lancamentos", json=payload, headers=headers)
        assert res2.status_code in (200, 201)
        data2 = res2.json()

        assert data1["id"] == data2["id"]

        db = SessionLocal()
        try:
            total_lancamentos = (
                db.query(Lancamento)
                .filter(Lancamento.comanda_id == comanda_id)
                .count()
            )
            # 1 inicial da venda direta + 1 do lançamento (sem duplicar no replay)
            assert total_lancamentos == 2
        finally:
            db.close()

    def test_waiter_launch_rejects_nonexistent_command(
        self, char_client: TestClient, char_setup: dict
    ):
        """[VALIDAÇÃO] Tentativa de lançar em comanda inexistente retorna 404."""
        headers = char_setup["headers"]
        payload = {
            "garcom_id": "usr-char-garcom",
            "itens": [{"produto_id": "prod-char-simples"}],
        }
        res = char_client.post(
            "/comandas/c-non-existent-9999/lancamentos",
            json=payload,
            headers=headers,
        )
        assert res.status_code == 404
        assert "Comanda não encontrada" in res.json()["detail"]

    def test_waiter_launch_on_closed_table_command_opens_new_check(
        self, char_client: TestClient, char_setup: dict
    ):
        """[PARIDADE CANÔNICA] Lançamento em comanda de mesa fechada abre automaticamente uma nova comanda aberta."""
        headers = char_setup["headers"]

        db = SessionLocal()
        try:
            mesa11 = db.query(Mesa).filter(Mesa.restaurante_id == CHAR_RESTAURANT_ID, Mesa.id == 11).first()
            if not mesa11:
                mesa11 = Mesa(id=11, restaurante_id=CHAR_RESTAURANT_ID, capacidade=4, nome="Mesa 11")
                db.add(mesa11)
            db.query(Comanda).filter(Comanda.restaurante_id == CHAR_RESTAURANT_ID, Comanda.mesa_id == 11).update({"fechada": True})
            db.commit()
        finally:
            db.close()

        # 1. Cria comanda de mesa 11
        venda_payload = {
            "tipo": "mesa",
            "mesa_id": 11,
            "itens": [{"produto_id": "prod-char-refri"}],
        }
        res_venda = char_client.post("/comandas/venda-direta", json=venda_payload, headers=headers)
        assert res_venda.status_code == 201
        comanda_antiga_id = res_venda.json()["id"]

        # 2. Fecha a comanda de mesa
        db = SessionLocal()
        try:
            comanda_antiga = db.query(Comanda).filter(Comanda.id == comanda_antiga_id).first()
            comanda_antiga.fechada = True
            db.commit()
        finally:
            db.close()

        # 3. Garçom lança novo pedido referenciando o ID da comanda fechada
        novo_payload = {
            "garcom_id": "usr-char-garcom",
            "itens": [{"produto_id": "prod-char-simples", "observacao": "Novo lote mesa 11"}],
        }
        res_novo = char_client.post(
            f"/comandas/{comanda_antiga_id}/lancamentos",
            json=novo_payload,
            headers=headers,
        )
        assert res_novo.status_code == 201
        novo_lanc_data = res_novo.json()
        novo_lanc_id = novo_lanc_data["id"]

        db = SessionLocal()
        try:
            # Comanda antiga permanece fechada e intocada com apenas 1 lançamento
            c_antiga = db.query(Comanda).filter(Comanda.id == comanda_antiga_id).first()
            assert c_antiga.fechada is True
            assert len(c_antiga.lancamentos) == 1
            assert c_antiga.lancamentos[0].id != novo_lanc_id

            # Lançamento pertence a uma nova comanda aberta da mesma mesa
            novo_lanc = db.query(Lancamento).filter(Lancamento.id == novo_lanc_id).first()
            assert novo_lanc is not None
            assert novo_lanc.comanda_id != comanda_antiga_id

            c_nova = db.query(Comanda).filter(Comanda.id == novo_lanc.comanda_id).first()
            assert c_nova is not None
            assert c_nova.mesa_id == 11
            assert c_nova.fechada is False
            assert c_nova.id != comanda_antiga_id
        finally:
            db.close()


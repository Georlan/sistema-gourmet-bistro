"""Testes de caracterização: Congelamento da estrutura de pedidos de salão/mesa e múltiplos lançamentos."""

from app.database import SessionLocal
from app.models import Comanda, Item, Lancamento
from .fixtures import char_client, char_setup, capture_order_snapshot, CHAR_RESTAURANT_ID


class TestLegacyTableOrders:
    def test_table_order_multiple_launches_on_same_check(self, char_client, char_setup):
        """[OBSERVADO] Uma comanda de mesa suporta múltiplos lançamentos sequenciais sem quebrar a conta."""
        headers = char_setup["headers"]

        # 1. Abrir comanda na Mesa 1
        open_res = char_client.post(
            "/comandas/",
            json={
                "mesa_id": 1,
                "garcom_id": "usr-char-admin",
                "identificador": "Mesa Família Silva",
                "tipo": "Consumo no Local",
            },
            headers=headers,
        )
        assert open_res.status_code == 201
        comanda_id = open_res.json()["id"]

        # 2. Lançamento 1: Bebidas (2x Refrigerante = R$ 16.00)
        l1_res = char_client.post(
            f"/comandas/{comanda_id}/lancamentos",
            json={
                "garcom_id": "usr-char-admin",
                "itens": [
                    {
                        "produto_id": "prod-char-refri",
                        "observacao": "Com gelo e limão",
                    },
                    {
                        "produto_id": "prod-char-refri",
                        "observacao": "Com gelo e limão",
                    },
                ],
            },
            headers=headers,
        )
        assert l1_res.status_code == 201

        # 3. Lançamento 2: Pratos (1x Burguer Especial R$ 35.00 + 1x Burguer Simples R$ 25.00 = R$ 60.00)
        l2_res = char_client.post(
            f"/comandas/{comanda_id}/lancamentos",
            json={
                "garcom_id": "usr-char-admin",
                "itens": [
                    {
                        "produto_id": "prod-char-especial",
                        "observacao": "Ao ponto",
                    },
                    {
                        "produto_id": "prod-char-simples",
                        "observacao": "",
                    },
                ],
            },
            headers=headers,
        )
        assert l2_res.status_code == 201

        # 4. Verificação no banco de dados real
        db = SessionLocal()
        try:
            snapshot = capture_order_snapshot(db, comanda_id)
            assert snapshot["mesa_id"] == 1
            # 2 Lançamentos distintos vinculados à mesma comanda
            assert len(snapshot["lancamentos"]) == 2
            # 4 itens individuais registrados
            assert len(snapshot["itens"]) == 4

            # Consulta da comanda consolidada e cálculo dos itens ativos
            comanda_get = char_client.get(f"/comandas/{comanda_id}", headers=headers)
            assert comanda_get.status_code == 200
            itens = comanda_get.json()["itens"]
            total_itens = sum(it["preco_unit"] for it in itens if it["status"] != "cancelado")
            # 16.00 + 35.00 + 25.00 = 76.00
            assert total_itens == 76.0
        finally:
            db.close()

    def test_table_order_item_cancellation_reduces_total(self, char_client, char_setup):
        """[OBSERVADO] Cancelar um item de mesa atualiza o status para 'cancelado' e reduz o subtotal ativo."""
        headers = char_setup["headers"]

        open_res = char_client.post(
            "/comandas/",
            json={
                "mesa_id": 1,
                "garcom_id": "usr-char-admin",
                "identificador": "Mesa Cancel Test",
                "tipo": "Consumo no Local",
            },
            headers=headers,
        )
        comanda_id = open_res.json()["id"]

        char_client.post(
            f"/comandas/{comanda_id}/lancamentos",
            json={
                "garcom_id": "usr-char-admin",
                "itens": [
                    {"produto_id": "prod-char-refri", "observacao": ""},
                    {"produto_id": "prod-char-simples", "observacao": ""},
                ],
            },
            headers=headers,
        )

        db = SessionLocal()
        try:
            snapshot = capture_order_snapshot(db, comanda_id)
            item_refri = [it for it in snapshot["itens"] if it["produto_id"] == "prod-char-refri"][0]
            item_id = item_refri["id"]
        finally:
            db.close()

        # Cancelar item do refri (R$ 8.00)
        canc_res = char_client.put(
            f"/comandas/itens/{item_id}/cancelar",
            headers=headers,
        )
        assert canc_res.status_code == 200
        assert canc_res.json()["status"] == "cancelado"

        # Total ativo deve ser apenas o Burguer Simples (R$ 25.00)
        comanda_get = char_client.get(f"/comandas/{comanda_id}", headers=headers)
        itens = comanda_get.json()["itens"]
        total_ativo = sum(it["preco_unit"] for it in itens if it["status"] != "cancelado")
        assert total_ativo == 25.0

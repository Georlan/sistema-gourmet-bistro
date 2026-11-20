"""Regressões B1: integridade financeira/operacional em status de item, edição e divisão de comanda."""

from __future__ import annotations

import uuid

from app.database import SessionLocal
from app.models import Comanda, Item, Pagamento
from tests.characterization.orders.fixtures import char_client, char_setup


def _seed_table_order(char_client, headers: dict[str, str], mesa_id: int = 1, qty: int = 2) -> tuple[str, list[str]]:
    res = char_client.post(
        "/comandas/venda-direta",
        json={
            "tipo": "Consumo no Local",
            "mesa_id": mesa_id,
            "itens": [{"produto_id": "prod-char-simples"} for _ in range(qty)],
        },
        headers=headers,
    )
    assert res.status_code == 201, res.text
    data = res.json()
    return data["id"], [item["id"] for item in data["itens"]]


def test_item_status_endpoint_cannot_bypass_cancel_payment_guards_or_resurrect_cancelled_items(
    char_client,
    char_setup,
):
    """[B1-FIN] PUT /comandas/itens/{id}/status não pode cancelar item sem auditoria/guardas nem ressuscitar item cancelado."""
    rid = char_setup["restaurant_id"]
    headers = char_setup["headers"]
    comanda_id, item_ids = _seed_table_order(char_client, headers, mesa_id=1, qty=2)
    first_item, second_item = item_ids

    # 1. Cancelar via endpoint de status deve ser rejeitado (409) mesmo para admin/caixa
    bypass_cancel = char_client.put(
        f"/comandas/itens/{first_item}/status",
        params={"status": "cancelado"},
        headers=headers,
    )
    assert bypass_cancel.status_code == 409, bypass_cancel.text

    with SessionLocal(restaurante_id=rid) as db:
        assert db.get(Item, first_item).status == "preparando"

    # 2. Cancelamento canônico funciona e impede ressurreição posterior via /status
    canonical_cancel = char_client.put(
        f"/comandas/itens/{first_item}/cancelar",
        headers=headers,
    )
    assert canonical_cancel.status_code == 200, canonical_cancel.text

    for target_status in ("preparando", "pronto", "entregue"):
        resurrect = char_client.put(
            f"/comandas/itens/{first_item}/status",
            params={"status": target_status},
            headers=headers,
        )
        assert resurrect.status_code == 409, (target_status, resurrect.status_code, resurrect.text)

    with SessionLocal(restaurante_id=rid) as db:
        assert db.get(Item, first_item).status == "cancelado"

    # 3. Comanda fechada não permite mutação de status de item nem para admin/caixa
    with SessionLocal(restaurante_id=rid) as db:
        comanda = db.get(Comanda, comanda_id)
        comanda.fechada = True
        db.commit()

    closed_mutation = char_client.put(
        f"/comandas/itens/{second_item}/status",
        params={"status": "pronto"},
        headers=headers,
    )
    assert closed_mutation.status_code == 409, closed_mutation.text

    with SessionLocal(restaurante_id=rid) as db:
        assert db.get(Item, second_item).status == "preparando"


def test_item_edit_cannot_clone_cancelled_paid_or_online_pix_order_items(
    char_client,
    char_setup,
):
    """[B1-FIN] PUT /comandas/itens/{id} não pode duplicar item cancelado, pago ou sob Pix online."""
    rid = char_setup["restaurant_id"]
    headers = char_setup["headers"]
    comanda_id, item_ids = _seed_table_order(char_client, headers, mesa_id=1, qty=2)
    cancelled_item, active_item = item_ids

    # 1. Cancelar o primeiro item e tentar clonar/editar -> 409
    cancel_res = char_client.put(f"/comandas/itens/{cancelled_item}/cancelar", headers=headers)
    assert cancel_res.status_code == 200, cancel_res.text

    clone_cancelled = char_client.put(
        f"/comandas/itens/{cancelled_item}",
        json={"quantidade_adicional": 2},
        headers=headers,
    )
    assert clone_cancelled.status_code == 409, clone_cancelled.text

    # 2. Item sob cobrança online Pix aprovada/pendente não pode receber quantidade_adicional
    with SessionLocal(restaurante_id=rid) as db:
        comanda = db.get(Comanda, comanda_id)
        comanda.online_payment_status = "approved"
        db.commit()

    inflate_online = char_client.put(
        f"/comandas/itens/{active_item}",
        json={"quantidade_adicional": 2},
        headers=headers,
    )
    assert inflate_online.status_code == 409, inflate_online.text

    # 3. Item já marcado como pago não pode ser clonado via quantidade_adicional
    with SessionLocal(restaurante_id=rid) as db:
        comanda = db.get(Comanda, comanda_id)
        comanda.online_payment_status = None
        db.get(Item, active_item).pago = True
        db.commit()

    clone_paid = char_client.put(
        f"/comandas/itens/{active_item}",
        json={"quantidade_adicional": 2},
        headers=headers,
    )
    assert clone_paid.status_code == 409, clone_paid.text

    # Nenhum item extra foi criado
    with SessionLocal(restaurante_id=rid) as db:
        assert db.query(Item).filter(Item.comanda_id == comanda_id).count() == 2


def test_split_comanda_blocks_paid_orders_non_dine_in_empty_and_full_drain(
    char_client,
    char_setup,
):
    """[B1-FIN] POST /comandas/{id}/dividir bloqueia pagamento ativo, modalidades não-salão, lista vazia e esvaziamento total."""
    rid = char_setup["restaurant_id"]
    headers = char_setup["headers"]

    # 1. Comanda de salão com 2 itens
    comanda_id, item_ids = _seed_table_order(char_client, headers, mesa_id=1, qty=2)

    # Lista vazia não pode criar comanda fantasma
    empty_split = char_client.post(
        f"/comandas/{comanda_id}/dividir",
        params={"novo_identificador": "Fantasma"},
        json=[],
        headers=headers,
    )
    assert empty_split.status_code in (400, 422), empty_split.text

    # Mover TODOS os itens ativos deixaria comanda original vazia
    full_drain = char_client.post(
        f"/comandas/{comanda_id}/dividir",
        params={"novo_identificador": "Tudo"},
        json=item_ids,
        headers=headers,
    )
    assert full_drain.status_code == 409, full_drain.text

    # 2. Pagamento parcial ou registrado na comanda bloqueia divisão
    pay_res = char_client.post(
        f"/caixa/comandas/{comanda_id}/pagar",
        json={
            "valor": 5.0,
            "metodo": "pix",
            "idempotency_key": f"b1-split-pay-{uuid.uuid4().hex[:8]}",
        },
        headers=headers,
    )
    assert pay_res.status_code in (200, 201), pay_res.text

    paid_split = char_client.post(
        f"/comandas/{comanda_id}/dividir",
        params={"novo_identificador": "Cliente B"},
        json=[item_ids[0]],
        headers=headers,
    )
    assert paid_split.status_code == 409, paid_split.text

    # 3. Pedido de Retirada/Delivery não pode ser dividido gerando comanda órfã
    pickup_res = char_client.post(
        "/comandas/venda-direta",
        json={
            "tipo": "Retirada",
            "identificador": "Retirada Split",
            "delivery_telefone": "81999994444",
            "itens": [
                {"produto_id": "prod-char-simples"},
                {"produto_id": "prod-char-simples"},
            ],
        },
        headers=headers,
    )
    assert pickup_res.status_code == 201, pickup_res.text
    pickup_data = pickup_res.json()
    pickup_split = char_client.post(
        f"/comandas/{pickup_data['id']}/dividir",
        params={"novo_identificador": "Orfao"},
        json=[pickup_data["itens"][0]["id"]],
        headers=headers,
    )
    assert pickup_split.status_code == 409, pickup_split.text

    # 4. Divisão legítima de comanda de salão sem pagamento mantendo ao menos 1 item continua funcionando
    clean_id, clean_items = _seed_table_order(char_client, headers, mesa_id=1, qty=2)
    # Remove o vínculo da mesa anterior fechando/usando nova comanda sem pagamento
    valid_split = char_client.post(
        f"/comandas/{clean_id}/dividir",
        params={"novo_identificador": "Amigo"},
        json=[clean_items[0]],
        headers=headers,
    )
    assert valid_split.status_code == 200, valid_split.text
    split_result = valid_split.json()
    assert len(split_result) == 2
    assert split_result[1]["identificador"] == "Amigo"
    assert split_result[1]["numero_pedido"] == split_result[0]["numero_pedido"]

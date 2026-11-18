"""Regressões B1-D: bloqueio de cancelamento/recusa quando há pagamento registrado ou aprovado."""

from __future__ import annotations

import uuid

from app.database import SessionLocal
from app.models import Comanda, Pagamento
from tests.characterization.orders.fixtures import char_client, char_setup


def test_cannot_cancel_or_reject_order_with_approved_payment(char_client, char_setup):
    """[B1-D] Pedido com pagamento aprovado não pode ser cancelado/recusado via lifecycle sem estorno."""
    rid = char_setup["restaurant_id"]
    headers = char_setup["headers"]

    # 1. Cria pedido de retirada pelo cardápio (nasce pendente)
    create_res = char_client.post(
        "/cardapio/pedidos",
        json={
            "restaurante_id": rid,
            "tipo_pedido": "retirada",
            "cliente_nome": "Cliente Pago",
            "cliente_telefone": "81999993333",
            "forma_pagamento": "na_entrega",
            "forma_pagamento_detalhe": "dinheiro",
            "idempotency_key": f"b1-cancel-paid-{uuid.uuid4().hex[:8]}",
            "itens": [{"produto_id": "prod-char-simples", "quantidade": 1}],
        },
    )
    assert create_res.status_code == 201, create_res.text
    comanda_id = create_res.json()["comanda_id"]

    # 2. Registra pagamento aprovado na comanda
    pay_res = char_client.post(
        f"/caixa/comandas/{comanda_id}/pagar",
        json={
            "valor": float(create_res.json()["total"]),
            "metodo": "pix",
            "idempotency_key": f"b1-pay-{uuid.uuid4().hex[:8]}",
        },
        headers=headers,
    )
    assert pay_res.status_code in (200, 201), pay_res.text

    # 3. Tentar recusar ou cancelar via PUT /comandas/{id}/delivery/status deve ser bloqueado
    reject_res = char_client.put(
        f"/comandas/{comanda_id}/delivery/status",
        params={"status_novo": "recusado"},
        headers=headers,
    )
    assert reject_res.status_code == 400, reject_res.text
    assert "Estorne o pagamento" in reject_res.json()["detail"]

    # Aceitar para produção e tentar cancelar também deve ser bloqueado enquanto pago
    accept_res = char_client.put(
        f"/comandas/{comanda_id}/delivery/status",
        params={"status_novo": "producao"},
        headers=headers,
    )
    assert accept_res.status_code == 200, accept_res.text

    cancel_res = char_client.put(
        f"/comandas/{comanda_id}/delivery/status",
        params={"status_novo": "recusado"},
        headers=headers,
    )
    assert cancel_res.status_code == 400, cancel_res.text
    assert "Estorne o pagamento" in cancel_res.json()["detail"]

    # 4. Pagamento aprovado e comanda permanecem íntegros no banco
    with SessionLocal(restaurante_id=rid) as db:
        comanda = db.get(Comanda, comanda_id)
        pag = db.query(Pagamento).filter_by(restaurante_id=rid, comanda_id=comanda_id).first()
        assert comanda is not None
        assert comanda.delivery_status == "producao"
        assert float(comanda.valor_pago or 0.0) > 0.0
        assert pag is not None and pag.status == "aprovado"

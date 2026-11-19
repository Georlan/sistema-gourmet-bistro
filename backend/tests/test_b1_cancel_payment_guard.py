"""Regressões B1-D: bloqueio de cancelamento/recusa quando há pagamento registrado ou aprovado."""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest

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


from app.application.orders.commands import CancelOrderCommand, RejectOrderCommand
from app.application.orders.service import OrderApplicationService, OrderValidationError
from app.models import CaixaTurno
from app.services.cash_reconciliation import create_refund


def _create_unpaid_order(rid):
    from app.application.orders.commands import (
        CreateOrderCommand, CustomerInput, FulfillmentType, OrderChannel, OrderItemInput,
    )
    # The matrix characterizes the financial service, independently of public
    # per-phone/IP quotas. The HTTP paid-order regression above covers the edge.
    with SessionLocal(restaurante_id=rid) as db:
        return OrderApplicationService.create_order(db, CreateOrderCommand(
            restaurant_id=rid, channel=OrderChannel.WEB_CARDAPIO,
            fulfillment=FulfillmentType.PICKUP,
            customer=CustomerInput(name="Estado financeiro", phone="81999994444"),
            payment_method="dinheiro", idempotency_key=f"guard-{uuid.uuid4().hex}",
            items=(OrderItemInput(product_id="prod-char-simples", quantity=Decimal("1")),),
        )).comanda_id


@pytest.mark.parametrize("method", ["dinheiro", "pix", "cartao_credito"])
@pytest.mark.parametrize("operation", ["cancel", "reject"])
@pytest.mark.parametrize("payment_status,blocked", [("pendente", False), ("cancelado", False), ("aprovado", True)])
def test_payment_guard_uses_canonical_payment_state(char_client, char_setup, operation, payment_status, blocked, method):
    rid = char_setup["restaurant_id"]
    cid = _create_unpaid_order(rid)
    with SessionLocal(restaurante_id=rid) as db:
        turno = db.query(CaixaTurno).filter_by(restaurante_id=rid, status="aberto").one()
        db.add(Pagamento(id=f"guard-{uuid.uuid4().hex}", restaurante_id=rid, comanda_id=cid,
                         turno_id=turno.id, valor=1, metodo=method, status=payment_status))
        db.commit()
        # Partial approved payment is sufficient even if a legacy projection is stale.
        command = (CancelOrderCommand if operation == "cancel" else RejectOrderCommand)(
            restaurant_id=rid, order_id=cid, operator_user_id="usr-char-admin", reason="Teste financeiro",
        )
        execute = OrderApplicationService.cancel_order if operation == "cancel" else OrderApplicationService.reject_order
        if blocked:
            with pytest.raises(OrderValidationError, match="Estorne"):
                execute(db, command)
            db.rollback()
            assert db.get(Comanda, cid).fechada is False
        else:
            execute(db, command)
            assert db.get(Comanda, cid).fechada is True


@pytest.mark.parametrize("refund_value,blocked", [(Decimal("0.50"), True), (Decimal("1.00"), False)])
def test_refund_ledger_controls_cancellation_without_erasing_payment_history(char_client, char_setup, refund_value, blocked):
    rid = char_setup["restaurant_id"]
    cid = _create_unpaid_order(rid)
    paid = char_client.post(f"/caixa/comandas/{cid}/pagar", headers=char_setup["headers"], json={
        "valor": 1, "metodo": "dinheiro", "idempotency_key": f"partial-{uuid.uuid4().hex}",
    })
    assert paid.status_code in (200, 201), paid.text
    with SessionLocal(restaurante_id=rid) as db:
        payment = db.query(Pagamento).filter_by(restaurante_id=rid, comanda_id=cid).one()
        key = f"refund-cancel-{uuid.uuid4().hex}"
        args = dict(restaurante_id=rid, payment_id=payment.id, turno_id=payment.turno_id,
                    usuario_id="usr-char-admin", valor=refund_value, motivo="Teste de estorno", idempotency_key=key)
        first = create_refund(db, **args)
        db.commit()
        assert create_refund(db, **args).id == first.id
        command = CancelOrderCommand(restaurant_id=rid, order_id=cid, reason="Após estorno")
        if blocked:
            with pytest.raises(OrderValidationError, match="Estorne"):
                OrderApplicationService.cancel_order(db, command)
        else:
            OrderApplicationService.cancel_order(db, command)
            assert db.get(Comanda, cid).fechada is True
        assert payment.status == "aprovado"
        assert float(db.get(Comanda, cid).valor_pago) == 1

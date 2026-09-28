import datetime
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, current_restaurante_id, engine, tenant_session_scope
from app.main import app
from app.models import CaixaTurno, Comanda, Restaurante, Usuario
from app.online_order_control_models import OnlineOrderCustomerBlock, OnlineOrderOperationalAudit
from app.order_chat_models import (
    OrderConversation,
    OrderConversationEvent,
    OrderMessage,
    OrderPushSubscription,
)
from app.routes.auth import create_access_token
from app.services.order_chat_service import create_conversation_for_order

client = TestClient(app)
RID = 8821
ADMIN_ID = "online-order-reject-admin-8821"


def _headers():
    token = create_access_token(subject=ADMIN_ID, restaurante_id=RID, role="admin")
    return {"Authorization": f"Bearer {token}"}


def _reset():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    marker = current_restaurante_id.set(RID)
    try:
        db.query(OnlineOrderOperationalAudit).filter(
            OnlineOrderOperationalAudit.restaurante_id == RID
        ).delete(synchronize_session=False)
        db.query(OnlineOrderCustomerBlock).filter(
            OnlineOrderCustomerBlock.restaurante_id == RID
        ).delete(synchronize_session=False)
        for model in (OrderConversationEvent, OrderMessage, OrderPushSubscription):
            db.query(model).filter(model.restaurante_id == RID).delete(
                synchronize_session=False
            )
        db.query(OrderConversation).filter(
            OrderConversation.restaurante_id == RID
        ).delete(synchronize_session=False)
        db.query(Comanda).filter(
            Comanda.restaurante_id == RID
        ).delete(synchronize_session=False)
        db.query(CaixaTurno).filter(CaixaTurno.restaurante_id == RID).delete(synchronize_session=False)

        restaurant = db.query(Restaurante).filter(Restaurante.id == RID).first()
        if restaurant is None:
            db.add(
                Restaurante(id=RID, nome="Reject Safety", plano="pro", slug="reject-safety")
            )
        user = db.query(Usuario).filter(Usuario.id == ADMIN_ID).first()
        if user is None:
            db.add(
                Usuario(
                    id=ADMIN_ID,
                    restaurante_id=RID,
                    nome="Admin Reject",
                    email="reject-admin@koma.test",
                    cargo="admin",
                    role="admin",
                    status="ativo",
                )
            )
        db.flush()
        db.add(CaixaTurno(
            restaurante_id=RID, aberto_por_id=ADMIN_ID, saldo_inicial=0, status="aberto",
        ))
        db.commit()
    finally:
        current_restaurante_id.reset(marker)
        db.close()


def _order(order_id: str, phone: str = "11998887777") -> str:
    db = SessionLocal()
    try:
        with tenant_session_scope(db, RID):
            db.add(
                Comanda(
                    id=order_id,
                    restaurante_id=RID,
                    garcom_id=ADMIN_ID,
                    numero_pedido=db.query(Comanda).filter(Comanda.restaurante_id == RID).count() + 1,
                    identificador="Cliente Reject",
                    tipo="Retirada",
                    delivery_status="pendente",
                    delivery_telefone=phone,
                    fechada=False,
                )
            )
            db.flush()
            _conversation, tracking_token = create_conversation_for_order(db, RID, order_id)
            assert tracking_token
            db.commit()
            return tracking_token
    finally:
        db.close()


def test_reasoned_rejection_uses_canonical_lifecycle():
    _reset()
    _order("reject-reason-1")
    reason = "Cozinha sem capacidade para atender no prazo"
    response = client.post(
        "/api/online-orders/orders/reject-reason-1/reject",
        headers=_headers(),
        json={
            "reason": reason,
            "block_customer": False,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["reason"] == reason
    assert response.json()["customer_block_id"] is None

    db = SessionLocal()
    try:
        with tenant_session_scope(db, RID):
            order = db.query(Comanda).filter(Comanda.id == "reject-reason-1").one()
            assert order.delivery_status == "recusado"
            assert order.fechada is True
            notice = (
                db.query(OrderConversationEvent)
                .filter(
                    OrderConversationEvent.restaurante_id == RID,
                    OrderConversationEvent.pedido_id == order.id,
                    OrderConversationEvent.event_key == "rejection_reason",
                )
                .one()
            )
            assert notice.event_key == "rejection_reason"
            assert notice.body == f"Motivo informado pelo restaurante: {reason}"
    finally:
        db.close()


def test_acceptance_cannot_be_rejected_by_initial_rejection_endpoint():
    _reset()
    _order("reject-after-accept-1")
    pending_before = client.get("/comandas/delivery/pendentes", headers=_headers())
    assert pending_before.status_code == 200, pending_before.text
    assert "reject-after-accept-1" in {row["id"] for row in pending_before.json()}
    accepted = client.put(
        "/comandas/reject-after-accept-1/delivery/status",
        params={"status_novo": "producao"},
        headers=_headers(),
    )
    assert accepted.status_code == 200, accepted.text
    repeated_accept = client.put(
        "/comandas/reject-after-accept-1/delivery/status",
        params={"status_novo": "producao"}, headers=_headers(),
    )
    assert repeated_accept.status_code == 200, repeated_accept.text
    active = client.get("/comandas/delivery/ativos", headers=_headers())
    assert active.status_code == 200, active.text
    assert next(row for row in active.json() if row["id"] == "reject-after-accept-1")["delivery_status"] == "producao"
    pending_after = client.get("/comandas/delivery/pendentes", headers=_headers())
    assert pending_after.status_code == 200, pending_after.text
    assert "reject-after-accept-1" not in {row["id"] for row in pending_after.json()}

    rejected = client.post(
        "/api/online-orders/orders/reject-after-accept-1/reject",
        headers=_headers(),
        json={"reason": "Tentativa após aceite", "block_customer": True},
    )
    assert rejected.status_code == 409, rejected.text
    assert rejected.json()["detail"]["current_status"] == "preparing"

    db = SessionLocal()
    try:
        with tenant_session_scope(db, RID):
            order = db.query(Comanda).filter(Comanda.id == "reject-after-accept-1").one()
            assert order.delivery_status == "producao"
            assert db.query(OrderConversationEvent).filter(
                OrderConversationEvent.pedido_id == order.id,
                OrderConversationEvent.event_key == "rejection_reason",
            ).count() == 0
            assert db.query(OnlineOrderCustomerBlock).filter(
                OnlineOrderCustomerBlock.restaurante_id == RID,
            ).count() == 0
    finally:
        db.close()


def test_replayed_rejection_does_not_repeat_notice_or_block():
    _reset()
    _order("reject-replay-1")
    payload = {"reason": "Pedido indisponível", "block_customer": True}
    first = client.post(
        "/api/online-orders/orders/reject-replay-1/reject", headers=_headers(), json=payload,
    )
    assert first.status_code == 200, first.text
    second = client.post(
        "/api/online-orders/orders/reject-replay-1/reject", headers=_headers(), json=payload,
    )
    assert second.status_code == 409, second.text
    assert second.json()["detail"]["current_status"] == "rejected"
    pending_after = client.get("/comandas/delivery/pendentes", headers=_headers())
    assert pending_after.status_code == 200, pending_after.text
    assert "reject-replay-1" not in {row["id"] for row in pending_after.json()}
    attempted_accept = client.put(
        "/comandas/reject-replay-1/delivery/status",
        params={"status_novo": "producao"}, headers=_headers(),
    )
    assert attempted_accept.status_code == 409, attempted_accept.text

    db = SessionLocal()
    try:
        with tenant_session_scope(db, RID):
            assert db.query(OrderConversationEvent).filter(
                OrderConversationEvent.pedido_id == "reject-replay-1",
                OrderConversationEvent.event_key == "rejection_reason",
            ).count() == 1
            assert db.query(OnlineOrderCustomerBlock).filter(
                OnlineOrderCustomerBlock.restaurante_id == RID,
            ).count() == 1
    finally:
        db.close()


@pytest.mark.skipif(engine.dialect.name != "postgresql", reason="FOR UPDATE requires PostgreSQL")
def test_concurrent_accept_and_reject_only_one_transition_wins():
    _reset()
    _order("reject-race-1")
    barrier = Barrier(2)

    def accept():
        barrier.wait()
        concurrent_client = TestClient(app)
        return concurrent_client.put(
            "/comandas/reject-race-1/delivery/status",
            params={"status_novo": "producao"}, headers=_headers(),
        )

    def reject():
        barrier.wait()
        concurrent_client = TestClient(app)
        return concurrent_client.post(
            "/api/online-orders/orders/reject-race-1/reject",
            headers=_headers(), json={"reason": "Pedido indisponível"},
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        accept_future = pool.submit(accept)
        reject_future = pool.submit(reject)
        responses = [accept_future.result(), reject_future.result()]
    assert sorted(response.status_code for response in responses) == [200, 409]

    db = SessionLocal()
    try:
        with tenant_session_scope(db, RID):
            order = db.query(Comanda).filter(Comanda.id == "reject-race-1").one()
            assert order.delivery_status in {"producao", "recusado"}
            notice_count = db.query(OrderConversationEvent).filter(
                OrderConversationEvent.pedido_id == order.id,
                OrderConversationEvent.event_key == "rejection_reason",
            ).count()
            assert notice_count == (1 if order.delivery_status == "recusado" else 0)
    finally:
        db.close()


def test_rejection_can_block_future_orders_and_secure_tracking_explains_why():
    _reset()
    tracking_token = _order("reject-block-1", "11997776666")
    reason = "Spam confirmado pela operação"
    response = client.post(
        "/api/online-orders/orders/reject-block-1/reject",
        headers=_headers(),
        json={
            "reason": reason,
            "block_customer": True,
            "block_duration_hours": 24,
        },
    )
    assert response.status_code == 200, response.text
    block_id = response.json()["customer_block_id"]
    assert block_id

    db = SessionLocal()
    try:
        with tenant_session_scope(db, RID):
            block = db.query(OnlineOrderCustomerBlock).filter(
                OnlineOrderCustomerBlock.id == block_id
            ).one()
            assert block.active is True
            assert block.reason == reason
            assert block.phone_hash
            assert "11997776666" not in block.phone_hash
    finally:
        db.close()

    tracked = client.get(f"/api/cardapio/pedidos/acompanhar/{tracking_token}")
    assert tracked.status_code == 200, tracked.text
    ordering_block = tracked.json()["ordering_block"]
    assert ordering_block["active"] is True
    assert ordering_block["reason"] == reason
    assert ordering_block["created_at"]
    assert ordering_block["expires_at"]
    assert "phone" not in ordering_block
    assert "cliente_id" not in ordering_block

    db = SessionLocal()
    try:
        with tenant_session_scope(db, RID):
            block = db.query(OnlineOrderCustomerBlock).filter(
                OnlineOrderCustomerBlock.id == block_id
            ).one()
            block.expires_at = (
                datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=1)
            )
            db.commit()
    finally:
        db.close()

    expired = client.get(f"/api/cardapio/pedidos/acompanhar/{tracking_token}")
    assert expired.status_code == 200, expired.text
    assert expired.json()["ordering_block"] is None

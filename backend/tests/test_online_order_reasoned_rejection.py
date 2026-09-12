import datetime

from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, current_restaurante_id, engine, tenant_session_scope
from app.main import app
from app.models import Comanda, Restaurante, Usuario
from app.online_order_control_models import OnlineOrderCustomerBlock, OnlineOrderOperationalAudit
from app.order_chat_models import OrderMessage
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
        db.query(Comanda).filter(Comanda.restaurante_id == RID).delete(synchronize_session=False)
        db.query(Usuario).filter(Usuario.restaurante_id == RID).delete(synchronize_session=False)
        db.query(Restaurante).filter(Restaurante.id == RID).delete(synchronize_session=False)
        db.commit()
        db.add(
            Restaurante(id=RID, nome="Reject Safety", plano="pro", slug="reject-safety")
        )
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
                db.query(OrderMessage)
                .filter(
                    OrderMessage.restaurante_id == RID,
                    OrderMessage.pedido_id == order.id,
                    OrderMessage.event_key == "rejection_reason",
                )
                .one()
            )
            assert notice.sender_type == "system"
            assert notice.body == f"Motivo informado pelo restaurante: {reason}"
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

    tracked = client.get(
        f"/api/cardapio/pedidos/acompanhar/{tracking_token}"
    )
    assert tracked.status_code == 200, tracked.text
    ordering_block = tracked.json()["ordering_block"]
    assert ordering_block["active"] is True
    assert ordering_block["reason"] == reason
    assert ordering_block["created_at"]
    assert ordering_block["expires_at"]

    db = SessionLocal()
    try:
        with tenant_session_scope(db, RID):
            block = db.query(OnlineOrderCustomerBlock).filter(
                OnlineOrderCustomerBlock.id == block_id
            ).one()
            block.expires_at = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=1)
            db.commit()
    finally:
        db.close()

    expired = client.get(
        f"/api/cardapio/pedidos/acompanhar/{tracking_token}"
    )
    assert expired.status_code == 200, expired.text
    assert expired.json()["ordering_block"] is None

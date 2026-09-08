from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, current_restaurante_id, engine, tenant_session_scope
from app.main import app
from app.models import Comanda, Restaurante, Usuario
from app.online_order_control_models import OnlineOrderCustomerBlock, OnlineOrderOperationalAudit
from app.routes.auth import create_access_token

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


def _order(order_id: str, phone: str = "11998887777"):
    db = SessionLocal()
    try:
        with tenant_session_scope(db, RID):
            db.add(
                Comanda(
                    id=order_id,
                    restaurante_id=RID,
                    identificador="Cliente Reject",
                    tipo="Retirada",
                    delivery_status="pendente",
                    delivery_telefone=phone,
                    fechada=False,
                )
            )
            db.commit()
    finally:
        db.close()


def test_reasoned_rejection_uses_canonical_lifecycle():
    _reset()
    _order("reject-reason-1")
    response = client.post(
        "/api/online-orders/orders/reject-reason-1/reject",
        headers=_headers(),
        json={
            "reason": "Cozinha sem capacidade para atender no prazo",
            "block_customer": False,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["reason"] == "Cozinha sem capacidade para atender no prazo"
    assert response.json()["customer_block_id"] is None

    db = SessionLocal()
    try:
        with tenant_session_scope(db, RID):
            order = db.query(Comanda).filter(Comanda.id == "reject-reason-1").one()
            assert order.delivery_status == "recusado"
            assert order.fechada is True
    finally:
        db.close()


def test_rejection_can_block_future_orders_in_same_transaction():
    _reset()
    _order("reject-block-1", "11997776666")
    response = client.post(
        "/api/online-orders/orders/reject-block-1/reject",
        headers=_headers(),
        json={
            "reason": "Spam confirmado pela operação",
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
            assert block.reason == "Spam confirmado pela operação"
            assert block.phone_hash
            assert "11997776666" not in block.phone_hash
    finally:
        db.close()

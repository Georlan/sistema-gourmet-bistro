import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, current_restaurante_id, engine, tenant_session_scope
from app.main import app
from app.models import Comanda, Restaurante, Usuario
from app.online_order_control_models import OnlineOrderControl
from app.routes.auth import create_access_token
from app.services.online_order_control import operational_counts

client = TestClient(app)
RID = 8891
ADMIN_ID = "online-count-admin-8891"


@pytest.fixture(autouse=True)
def setup_operational_count_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    token = current_restaurante_id.set(RID)
    try:
        db.query(OnlineOrderControl).filter(OnlineOrderControl.restaurante_id == RID).delete(
            synchronize_session=False
        )
        db.query(Comanda).filter(Comanda.restaurante_id == RID).delete(synchronize_session=False)
        db.query(Usuario).filter(Usuario.restaurante_id == RID).delete(synchronize_session=False)
        db.query(Restaurante).filter(Restaurante.id == RID).delete(synchronize_session=False)
        db.commit()

        db.add(Restaurante(id=RID, nome="KOMA Count", plano="pro", slug="koma-count"))
        db.add(
            Usuario(
                id=ADMIN_ID,
                restaurante_id=RID,
                nome="Gerente Count",
                email="count-admin@koma.test",
                cargo="admin",
                role="admin",
                status="ativo",
            )
        )
        db.commit()
        yield
    finally:
        current_restaurante_id.reset(token)
        db.close()


def _add_order(db, *, order_id: str, delivery_status: str, online_payment_status):
    order = Comanda(
        id=order_id,
        restaurante_id=RID,
        garcom_id=ADMIN_ID,
        numero_pedido=db.query(Comanda).filter(Comanda.restaurante_id == RID).count() + 1,
        tipo="Retirada",
        identificador="Cliente Count",
        delivery_status=delivery_status,
        delivery_telefone="11999990000",
        online_payment_status=online_payment_status,
        fechada=False,
    )
    db.add(order)
    db.flush()
    return order


def _admin_headers():
    token = create_access_token(subject=ADMIN_ID, restaurante_id=RID, role="admin")
    return {"Authorization": f"Bearer {token}"}


def test_operational_counts_ignore_online_payments_not_released_to_operation():
    db = SessionLocal()
    try:
        with tenant_session_scope(db, RID):
            _add_order(
                db,
                order_id="count-null-payment",
                delivery_status="pendente",
                online_payment_status=None,
            )
            _add_order(
                db,
                order_id="count-approved-analysis",
                delivery_status="analise",
                online_payment_status="approved",
            )
            _add_order(
                db,
                order_id="count-approved-ready",
                delivery_status="pronto",
                online_payment_status="approved",
            )

            for payment_status in ("pending", "rejected", "cancelled", "expired", "error"):
                _add_order(
                    db,
                    order_id=f"count-{payment_status}",
                    delivery_status="pendente",
                    online_payment_status=payment_status,
                )

            db.commit()

            counts = operational_counts(db, RID)
            assert counts == {
                "analise": 1,
                "pendente": 1,
                "producao": 0,
                "pronto": 1,
                "active": 3,
            }
    finally:
        db.close()


def test_operational_control_endpoint_uses_the_same_filtered_counts():
    db = SessionLocal()
    try:
        with tenant_session_scope(db, RID):
            _add_order(
                db,
                order_id="count-api-valid",
                delivery_status="pendente",
                online_payment_status="approved",
            )
            _add_order(
                db,
                order_id="count-api-unpaid",
                delivery_status="pendente",
                online_payment_status="pending",
            )
            db.commit()
    finally:
        db.close()

    response = client.get("/api/online-orders/control", headers=_admin_headers())
    assert response.status_code == 200, response.text
    assert response.json()["counts"] == {
        "analise": 0,
        "pendente": 1,
        "producao": 0,
        "pronto": 0,
        "active": 1,
    }

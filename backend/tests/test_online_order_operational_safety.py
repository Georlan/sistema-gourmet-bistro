import datetime

import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, current_restaurante_id, engine, tenant_session_scope
from app.main import app
from app.models import Comanda, Restaurante, Usuario
from app.online_order_control_models import (
    OnlineOrderControl,
    OnlineOrderCustomerBlock,
    OnlineOrderOperationalAudit,
)
from app.routes.auth import create_access_token
from app.scheduled_models import ScheduledOrder
from app.services.online_order_control import (
    block_from_order,
    capacity_gate_before_order,
    customer_is_blocked,
    operational_counts,
)
from app.services.online_order_policy import evaluate_online_order_policy

client = TestClient(app)
RID = 8811
RID_OTHER = 8812
ADMIN_ID = "online-order-admin-8811"


@pytest.fixture(autouse=True)
def setup_operational_safety_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    token = current_restaurante_id.set(RID)
    try:
        # Limpa filhos primeiro para manter a fixture idempotente em SQLite/PG de teste.
        db.query(OnlineOrderOperationalAudit).filter(
            OnlineOrderOperationalAudit.restaurante_id.in_([RID, RID_OTHER])
        ).delete(synchronize_session=False)
        db.query(OnlineOrderCustomerBlock).filter(
            OnlineOrderCustomerBlock.restaurante_id.in_([RID, RID_OTHER])
        ).delete(synchronize_session=False)
        db.query(OnlineOrderControl).filter(
            OnlineOrderControl.restaurante_id.in_([RID, RID_OTHER])
        ).delete(synchronize_session=False)
        db.query(ScheduledOrder).filter(
            ScheduledOrder.restaurante_id.in_([RID, RID_OTHER])
        ).delete(synchronize_session=False)
        db.query(Comanda).filter(Comanda.restaurante_id.in_([RID, RID_OTHER])).delete(
            synchronize_session=False
        )
        db.query(Usuario).filter(Usuario.restaurante_id.in_([RID, RID_OTHER])).delete(
            synchronize_session=False
        )
        db.query(Restaurante).filter(Restaurante.id.in_([RID, RID_OTHER])).delete(
            synchronize_session=False
        )
        db.commit()

        db.add_all(
            [
                Restaurante(id=RID, nome="KOMA Safety A", plano="pro", slug="koma-safety-a"),
                Restaurante(id=RID_OTHER, nome="KOMA Safety B", plano="pro", slug="koma-safety-b"),
                Usuario(
                    id=ADMIN_ID,
                    restaurante_id=RID,
                    nome="Gerente Safety",
                    email="safety-admin@koma.test",
                    cargo="admin",
                    role="admin",
                    status="ativo",
                ),
            ]
        )
        db.commit()
        yield
    finally:
        current_restaurante_id.reset(token)
        db.close()


def _admin_headers():
    token = create_access_token(subject=ADMIN_ID, restaurante_id=RID, role="admin")
    return {"Authorization": f"Bearer {token}"}


def _add_order(
    db,
    *,
    order_id: str,
    status_value: str = "pendente",
    phone: str = "11999990000",
):
    order = Comanda(
        id=order_id,
        restaurante_id=RID,
        tipo="Retirada",
        identificador="Cliente Safety",
        delivery_status=status_value,
        delivery_telefone=phone,
        fechada=False,
    )
    db.add(order)
    db.flush()
    return order


def test_emergency_pause_is_authoritative_and_audited():
    response = client.post(
        "/api/online-orders/pause",
        headers=_admin_headers(),
        json={"reason": "Cozinha lotada", "duration_minutes": 30},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["paused"] is True
    assert payload["pause_reason"] == "Cozinha lotada"
    assert payload["pause_until"]

    db = SessionLocal()
    try:
        with tenant_session_scope(db, RID):
            restaurant = db.query(Restaurante).filter(Restaurante.id == RID).one()
            policy = evaluate_online_order_policy(restaurant)
            assert policy.accepting_orders is False
            assert policy.source == "operational_pause"
            # Motivo interno não deve vazar pela política pública.
            assert "Cozinha lotada" not in (policy.reason or "")
            assert db.query(OnlineOrderOperationalAudit).filter(
                OnlineOrderOperationalAudit.restaurante_id == RID,
                OnlineOrderOperationalAudit.action == "online_orders_paused",
            ).count() == 1
    finally:
        db.close()

    resumed = client.post(
        "/api/online-orders/resume",
        headers=_admin_headers(),
        json={"reason": "Operação normalizada"},
    )
    assert resumed.status_code == 200
    assert resumed.json()["paused"] is False


def test_capacity_gate_auto_pauses_at_configured_limit_but_manual_mode_only_warns():
    db = SessionLocal()
    try:
        with tenant_session_scope(db, RID):
            db.add(
                OnlineOrderControl(
                    restaurante_id=RID,
                    max_active_orders=1,
                    auto_pause=True,
                )
            )
            _add_order(db, order_id="safety-capacity-1")
            db.commit()

            gate = capacity_gate_before_order(db, restaurante_id=RID)
            assert gate.blocked is True
            assert gate.state_changed is True
            assert gate.reason == "capacity"
            db.commit()

            control = db.query(OnlineOrderControl).filter(
                OnlineOrderControl.restaurante_id == RID
            ).one()
            assert control.paused is True
            assert control.pause_reason == "Capacidade operacional atingida"

            control.paused = False
            control.pause_reason = None
            control.auto_pause = False
            db.commit()
            warning_only = capacity_gate_before_order(db, restaurante_id=RID)
            assert warning_only.blocked is False
    finally:
        db.close()


def test_future_scheduled_orders_do_not_consume_current_operational_capacity():
    db = SessionLocal()
    try:
        with tenant_session_scope(db, RID):
            released = _add_order(db, order_id="safety-live-1", status_value="producao")
            scheduled = _add_order(db, order_id="safety-scheduled-1", status_value="pendente")
            db.add(
                ScheduledOrder(
                    restaurante_id=RID,
                    comanda_id=scheduled.id,
                    scheduled_for=datetime.datetime.now(datetime.timezone.utc)
                    + datetime.timedelta(hours=3),
                    released_at=None,
                )
            )
            db.commit()
            counts = operational_counts(db, RID)
            assert counts["producao"] == 1
            assert counts["pendente"] == 0
            assert counts["active"] == 1
            assert released.id != scheduled.id
    finally:
        db.close()


def test_customer_block_keeps_phone_out_of_storage_and_expires():
    db = SessionLocal()
    try:
        with tenant_session_scope(db, RID):
            order = _add_order(
                db,
                order_id="safety-block-1",
                phone="11988887777",
            )
            block = block_from_order(
                db,
                restaurante_id=RID,
                comanda=order,
                actor_user_id=ADMIN_ID,
                reason="Comportamento abusivo",
                duration_hours=24,
            )
            db.commit()
            assert block.phone_hash
            assert block.phone_hash != "11988887777"
            assert "11988887777" not in block.phone_hash
            assert customer_is_blocked(
                db,
                restaurante_id=RID,
                telefone="(11) 98888-7777",
            ) is True

            block.expires_at = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=1)
            db.commit()
            assert customer_is_blocked(
                db,
                restaurante_id=RID,
                telefone="11988887777",
            ) is False
    finally:
        db.close()


def test_block_list_does_not_expose_phone_fingerprint_and_is_tenant_scoped():
    db = SessionLocal()
    try:
        with tenant_session_scope(db, RID):
            order = _add_order(db, order_id="safety-block-api-1", phone="11977776666")
            block_from_order(
                db,
                restaurante_id=RID,
                comanda=order,
                actor_user_id=ADMIN_ID,
                reason="Spam de pedidos",
                duration_hours=None,
            )
            db.commit()
    finally:
        db.close()

    response = client.get("/api/online-orders/blocks", headers=_admin_headers())
    assert response.status_code == 200
    assert len(response.json()) == 1
    serialized = response.json()[0]
    assert "phone_hash" not in serialized
    assert "telefone" not in serialized
    assert serialized["reason"] == "Spam de pedidos"


def test_operational_control_rejects_unauthenticated_callers():
    response = client.post(
        "/api/online-orders/pause",
        json={"reason": "Não autorizado", "duration_minutes": 15},
    )
    assert response.status_code in (401, 403)

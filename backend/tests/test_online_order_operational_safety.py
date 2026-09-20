import datetime
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, current_restaurante_id, engine, tenant_session_scope
from app.main import app
from app.models import CaixaTurno, Comanda, Lancamento, Restaurante, Usuario
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
    auto_accept_online_order_if_enabled,
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
        db.commit()

        # Preserve os pais: outras suítes podem manter FKs legítimas para estes
        # tenants no banco SQLite compartilhado do CI. Esta fixture só é dona
        # dos registros operacionais que limpa acima.
        restaurant = db.query(Restaurante).filter(Restaurante.id == RID).first()
        if restaurant is None:
            restaurant = Restaurante(id=RID, nome="KOMA Safety A", plano="pro", slug="koma-safety-a")
            db.add(restaurant)
        else:
            restaurant.nome = "KOMA Safety A"
            restaurant.plano = "pro"
            restaurant.slug = "koma-safety-a"

        other = db.query(Restaurante).filter(Restaurante.id == RID_OTHER).first()
        if other is None:
            other = Restaurante(id=RID_OTHER, nome="KOMA Safety B", plano="pro", slug="koma-safety-b")
            db.add(other)
        else:
            other.nome = "KOMA Safety B"
            other.plano = "pro"
            other.slug = "koma-safety-b"

        admin = db.query(Usuario).filter(Usuario.id == ADMIN_ID).first()
        if admin is None:
            admin = Usuario(
                id=ADMIN_ID,
                restaurante_id=RID,
                nome="Gerente Safety",
                email="safety-admin@koma.test",
                cargo="admin",
                role="admin",
                status="ativo",
            )
            db.add(admin)
        else:
            admin.restaurante_id = RID
            admin.nome = "Gerente Safety"
            admin.email = "safety-admin@koma.test"
            admin.cargo = "admin"
            admin.role = "admin"
            admin.status = "ativo"
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
        garcom_id=ADMIN_ID,
        numero_pedido=db.query(Comanda).filter(Comanda.restaurante_id == RID).count() + 1,
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


def test_block_list_keeps_history_without_exposing_phone_fingerprint():
    db = SessionLocal()
    try:
        with tenant_session_scope(db, RID):
            order = _add_order(db, order_id="safety-block-api-1", phone="11977776666")
            block = block_from_order(
                db,
                restaurante_id=RID,
                comanda=order,
                actor_user_id=ADMIN_ID,
                reason="Spam de pedidos",
                duration_hours=None,
            )
            db.commit()
            block_id = block.id
    finally:
        db.close()

    response = client.get("/api/online-orders/blocks", headers=_admin_headers())
    assert response.status_code == 200
    serialized = next(item for item in response.json() if item["id"] == block_id)
    assert "phone_hash" not in serialized
    assert "telefone" not in serialized
    assert serialized["reason"] == "Spam de pedidos"
    assert serialized["active"] is True
    assert serialized["status"] == "active"

    released = client.post(
        f"/api/online-orders/blocks/{block_id}/release",
        headers=_admin_headers(),
        json={"reason": "Operação revisou o bloqueio"},
    )
    assert released.status_code == 200

    history = client.get("/api/online-orders/blocks", headers=_admin_headers())
    assert history.status_code == 200
    historical = next(item for item in history.json() if item["id"] == block_id)
    assert historical["active"] is False
    assert historical["status"] == "released"


def test_operational_control_rejects_unauthenticated_callers():
    response = client.post(
        "/api/online-orders/pause",
        json={"reason": "Não autorizado", "duration_minutes": 15},
    )
    assert response.status_code in (401, 403)


def test_auto_accept_policy_is_persisted_and_audited():
    enabled = client.put(
        "/api/online-orders/auto-accept",
        headers=_admin_headers(),
        json={"enabled": True},
    )
    assert enabled.status_code == 200, enabled.text
    assert enabled.json()["auto_accept"] is True

    persisted = client.get("/api/online-orders/control", headers=_admin_headers())
    assert persisted.status_code == 200
    assert persisted.json()["auto_accept"] is True

    db = SessionLocal()
    try:
        with tenant_session_scope(db, RID):
            control = db.query(OnlineOrderControl).filter(
                OnlineOrderControl.restaurante_id == RID
            ).one()
            assert control.auto_accept is True
            assert db.query(OnlineOrderOperationalAudit).filter(
                OnlineOrderOperationalAudit.restaurante_id == RID,
                OnlineOrderOperationalAudit.action == "online_orders_auto_accept_updated",
            ).count() == 1
    finally:
        db.close()

    disabled = client.put(
        "/api/online-orders/auto-accept",
        headers=_admin_headers(),
        json={"enabled": False},
    )
    assert disabled.status_code == 200
    assert disabled.json()["auto_accept"] is False


@pytest.mark.parametrize("order_type", ["Retirada", "Delivery", "Consumo no Local"])
def test_backend_auto_accept_applies_to_every_online_fulfillment(monkeypatch, order_type):
    db = SessionLocal()
    try:
        with tenant_session_scope(db, RID):
            db.add(OnlineOrderControl(restaurante_id=RID, auto_accept=True))
            db.add(
                CaixaTurno(
                    restaurante_id=RID,
                    aberto_por_id=ADMIN_ID,
                    saldo_inicial=0,
                    status="aberto",
                )
            )
            order = _add_order(
                db,
                order_id=f"auto-all-{order_type.lower().replace(' ', '-')}",
            )
            order.tipo = order_type
            launch = Lancamento(
                id=f"launch-{order.id}",
                restaurante_id=RID,
                comanda_id=order.id,
                garcom_id=ADMIN_ID,
                origem="cardapio",
                status="pendente",
                timestamp=datetime.datetime.now(datetime.timezone.utc),
            )
            db.add(launch)
            db.commit()

            calls = []

            def fake_transition(_db, **kwargs):
                calls.append(kwargs)
                return SimpleNamespace(
                    changed=True,
                    first_accept=False,
                    comanda=order,
                )

            monkeypatch.setattr(
                "app.services.online_order_control.OrderLifecycleCoordinator.transition_check_status",
                fake_transition,
            )
            assert auto_accept_online_order_if_enabled(
                db,
                restaurante_id=RID,
                comanda_id=order.id,
            ) is True
            assert len(calls) == 1
            assert calls[0]["target_status"].value == "preparing"
    finally:
        db.rollback()
        db.close()


def test_backend_auto_accept_waits_for_pix_and_scheduled_release(monkeypatch):
    db = SessionLocal()
    try:
        with tenant_session_scope(db, RID):
            db.add(OnlineOrderControl(restaurante_id=RID, auto_accept=True))
            db.add(
                CaixaTurno(
                    restaurante_id=RID,
                    aberto_por_id=ADMIN_ID,
                    saldo_inicial=0,
                    status="aberto",
                )
            )
            order = _add_order(db, order_id="auto-barrier-1")
            order.online_payment_status = "pending"
            db.add(
                Lancamento(
                    id="launch-auto-barrier-1",
                    restaurante_id=RID,
                    comanda_id=order.id,
                    garcom_id=ADMIN_ID,
                    origem="cardapio",
                    status="pendente",
                    timestamp=datetime.datetime.now(datetime.timezone.utc),
                )
            )
            db.commit()

            monkeypatch.setattr(
                "app.services.online_order_control.OrderLifecycleCoordinator.transition_check_status",
                lambda *_args, **_kwargs: (_ for _ in ()).throw(
                    AssertionError("barrier must prevent transition")
                ),
            )
            assert auto_accept_online_order_if_enabled(
                db,
                restaurante_id=RID,
                comanda_id=order.id,
            ) is False

            order.online_payment_status = None
            db.add(
                ScheduledOrder(
                    restaurante_id=RID,
                    comanda_id=order.id,
                    scheduled_for=datetime.datetime.now(datetime.timezone.utc)
                    + datetime.timedelta(hours=2),
                    released_at=None,
                )
            )
            db.commit()
            assert auto_accept_online_order_if_enabled(
                db,
                restaurante_id=RID,
                comanda_id=order.id,
            ) is False
    finally:
        db.rollback()
        db.close()

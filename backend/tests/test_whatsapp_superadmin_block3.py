"""Block 3 platform rollout and diagnostics. Only SQLite/synthetic data; no sends."""
import datetime as dt
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import ConfiguracaoRestaurante, IntegrationOutbox, Restaurante, SuperAdminAuditLog
from app.routes import super_admin_whatsapp as admin_wa
from app.services import central_whatsapp as central
from app.services import customer_whatsapp_dispatch as customer


@pytest.fixture
def sample(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path}/block3-wa.db")
    Base.metadata.create_all(engine)
    monkeypatch.setenv("KOMA_CENTRAL_WA_ENABLED", "true")
    monkeypatch.setenv("KOMA_CENTRAL_WA_ALLOWED_RESTAURANT_IDS", "701")
    monkeypatch.setenv("KOMA_CENTRAL_WA_SENDER_PHONE", "5511888888888")
    monkeypatch.setenv("KOMA_CENTRAL_WA_INSTANCE_NAME", "synthetic-business")
    monkeypatch.setenv("KOMA_CUSTOMER_WA_ENABLED", "true")
    monkeypatch.setenv("KOMA_CUSTOMER_WA_ALLOWED_RESTAURANT_IDS", "701")
    monkeypatch.setattr(admin_wa, "SessionLocal", lambda: Session(engine, expire_on_commit=False))
    with Session(engine) as session:
        for rid in (701, 702):
            session.add(Restaurante(id=rid, nome=f"Synthetic tenant {rid}"))
            session.add(ConfiguracaoRestaurante(
                restaurante_id=rid,
                whatsapp_instance_name=central.CENTRAL_INSTANCE_MARKER,
                whatsapp_recipient_phone="5511999999999" if rid == 701 else "5521999999999",
                whatsapp_customer_notices_enabled=True,
            ))
        session.commit()
    yield engine, monkeypatch
    engine.dispose()


def test_unmanaged_rollout_stays_legacy_and_db_override_is_independent(sample):
    engine, _ = sample
    with Session(engine) as db:
        old, second = (db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=rid).one() for rid in (701, 702))
        assert central.enabled_for(701, old)
        assert customer.customer_notices_enabled(701, old)
        assert not central.enabled_for(702, second)
        assert not customer.customer_notices_enabled(702, second)
        old.whatsapp_platform_managed = True
        old.whatsapp_platform_operator_allowed = False
        old.whatsapp_platform_customer_allowed = True
        second.whatsapp_platform_managed = True
        second.whatsapp_platform_operator_allowed = True
        second.whatsapp_platform_customer_allowed = False
        db.commit()
        assert not central.enabled_for(701, old)
        assert customer.customer_notices_enabled(701, old)
        assert central.enabled_for(702, second)
        assert not customer.customer_notices_enabled(702, second)
        # The shared Business is the same; there is no new per-restaurant instance.
        assert central.pilot_configuration().instance == "synthetic-business"


def test_platform_suspension_is_scoped_audited_and_cancels_only_affected_queue(sample):
    engine, _ = sample
    with Session(engine) as db:
        for rid in (701, 702):
            for event in ("koma.whatsapp.central_operator_order", "koma.whatsapp.customer_status"):
                db.add(IntegrationOutbox(
                    id=str(uuid.uuid4()), restaurante_id=rid, event_id=str(uuid.uuid4()),
                    event_name=event, aggregate_type="order", aggregate_id=str(uuid.uuid4()),
                    payload={"restaurant_id": rid, "kind": "customer_received"}, status="pending",
                ))
        db.commit()

    result = admin_wa.update_platform_permissions(
        701, admin_wa.PlatformPermissionUpdate(reason="Suspensão autorizada de homologação",
                                             customer_allowed=False), {"user": "test-super-admin"},
    )
    assert result["permissions"]["operator_allowed"] is True
    assert result["permissions"]["customer_allowed"] is False
    with Session(engine) as db:
        statuses = {(x.restaurante_id, x.event_name): x.status for x in db.query(IntegrationOutbox).all()}
        assert statuses[(701, "koma.whatsapp.customer_status")] == "dead_letter"
        assert statuses[(701, "koma.whatsapp.central_operator_order")] == "pending"
        assert statuses[(702, "koma.whatsapp.customer_status")] == "pending"
        audit = db.query(SuperAdminAuditLog).filter_by(restaurante_id=701).one()
        assert audit.reason == "Suspensão autorizada de homologação"
        assert audit.actor == "test-super-admin"
        assert audit.before_data["customer_allowed"] is True
        assert audit.after_data["customer_allowed"] is False

    admin_wa.update_platform_permissions(
        701, admin_wa.PlatformPermissionUpdate(reason="Reativação controlada", customer_allowed=True),
        {"user": "test-super-admin"},
    )
    with Session(engine) as db:
        assert db.query(SuperAdminAuditLog).filter_by(restaurante_id=701).count() == 2
        assert db.query(IntegrationOutbox).filter_by(
            restaurante_id=701, event_name="koma.whatsapp.customer_status", status="dead_letter",
        ).count() == 1  # Never revive old messages by reauthorizing.


def test_disable_global_sender_does_not_clear_saved_permissions(sample):
    engine, monkeypatch = sample
    monkeypatch.setenv("KOMA_CENTRAL_WA_ENABLED", "false")
    # Changing only the operator must preserve prior customer authority.
    admin_wa.update_platform_permissions(
        701, admin_wa.PlatformPermissionUpdate(reason="Manutenção global", operator_allowed=False),
        {"user": "test-super-admin"},
    )
    with Session(engine) as db:
        cfg = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=701).one()
        assert cfg.whatsapp_platform_customer_allowed is True
        assert not customer.customer_notices_enabled(701, cfg)
    monkeypatch.setenv("KOMA_CENTRAL_WA_ENABLED", "true")
    with Session(engine) as db:
        cfg = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=701).one()
        assert customer.customer_notices_enabled(701, cfg)


def test_overview_is_bounded_and_never_exposes_private_contacts(sample):
    engine, _ = sample
    result = admin_wa.whatsapp_platform_overview(
        limit=25, offset=0, verify_sender=False, admin={"user": "test-super-admin"},
    )
    assert result["total_restaurants"] == 2
    assert result["sender"]["connection"] == "not_verified"
    assert result["page_totals"]["waiting"] == 0
    assert len(result["tenants"]) == 2
    assert "5511999999999" not in str(result)
    assert "5511888888888" not in str(result)
    assert "apikey" not in str(result).lower()


def test_invalid_update_requires_reason_and_channel():
    with pytest.raises(Exception):
        admin_wa.PlatformPermissionUpdate(reason="ok", customer_allowed=True)
    with pytest.raises(Exception):
        admin_wa.PlatformPermissionUpdate(reason="Valid reason but no action")
    with pytest.raises(HTTPException):
        admin_wa.update_platform_permissions(
            0, admin_wa.PlatformPermissionUpdate(reason="Valid reason", operator_allowed=True),
            {"user": "test-super-admin"},
        )

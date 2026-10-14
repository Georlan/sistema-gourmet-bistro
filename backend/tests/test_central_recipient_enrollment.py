"""Tenant-controlled recipient enrollment is a DB-only, fail-closed operation."""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.database import SessionLocal
from app.models import ConfiguracaoRestaurante
from app.routes import tenant_whatsapp as routes
from app.services.central_whatsapp import CENTRAL_INSTANCE_MARKER
from tests.characterization.orders.fixtures import CHAR_RESTAURANT_ID, char_client, char_setup


def test_central_recipient_enrollment_never_contacts_evolution(char_setup, monkeypatch):
    rid = CHAR_RESTAURANT_ID
    db = SessionLocal(restaurante_id=rid)
    user = SimpleNamespace(restaurante_id=rid)

    def forbidden(*args, **kwargs):
        raise AssertionError("O cadastro central jamais deve consultar a Evolution")

    for name in ("create_instance", "connect_instance", "connection_state", "owner_phone",
                 "delete_instance", "logout_instance"):
        monkeypatch.setattr(routes.wa, name, forbidden)

    try:
        with pytest.raises(HTTPException) as no_consent:
            routes.register_central_recipient(
                routes.RecipientRegistrationRequest(phone="11987654321"), db, user
            )
        assert no_consent.value.status_code == 422

        response = routes.register_central_recipient(
            routes.RecipientRegistrationRequest(
                phone="11987654321", confirm_receiving=True,
            ), db, user,
        )
        assert response == {
            "state": "registered", "mode": "central",
            "enabled": False, "phone_ending": "4321",
        }
        stored = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=rid).one()
        assert stored.whatsapp_instance_name == CENTRAL_INSTANCE_MARKER
        assert stored.whatsapp_recipient_phone == "5511987654321"
        assert stored.whatsapp_alerts_enabled is False

        assert routes.get_status(db, user)["state"] == "registered"
        assert routes.get_status(db, user)["mode"] == "central"
        assert routes.get_status(db, user)["enabled"] is False
        with pytest.raises(HTTPException) as cannot_enable:
            routes.enable(db, user)
        assert cannot_enable.value.status_code == 409

        result = routes.remove_central_recipient(db, user)
        assert result["state"] == "not_configured"
        db.refresh(stored)
        assert stored.whatsapp_instance_name is None
        assert stored.whatsapp_recipient_phone is None
    finally:
        db.rollback()
        db.close()


def test_existing_individual_session_cannot_be_overwritten(char_setup):
    rid = CHAR_RESTAURANT_ID
    db = SessionLocal(restaurante_id=rid)
    user = SimpleNamespace(restaurante_id=rid)
    try:
        config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=rid).one()
        config.whatsapp_instance_name = routes.wa.instance_name(rid)
        config.whatsapp_recipient_phone = "5511987654321"
        config.whatsapp_alerts_enabled = True
        db.commit()
        with pytest.raises(HTTPException) as existing:
            routes.register_central_recipient(
                routes.RecipientRegistrationRequest(
                    phone="21987654321", confirm_receiving=True,
                ), db, user,
            )
        assert existing.value.status_code == 409
        db.refresh(config)
        assert config.whatsapp_alerts_enabled
        assert config.whatsapp_instance_name == routes.wa.instance_name(rid)
    finally:
        db.rollback()
        db.close()


def test_individual_qr_configuration_rejected_for_central_enrollment(char_setup):
    rid = CHAR_RESTAURANT_ID
    db = SessionLocal(restaurante_id=rid)
    user = SimpleNamespace(restaurante_id=rid)
    try:
        routes.register_central_recipient(
            routes.RecipientRegistrationRequest(phone="11987654321", confirm_receiving=True),
            db, user,
        )
        with pytest.raises(HTTPException) as rejected:
            routes.configure(routes.ConfigureRequest(phone="11987654321", mode="qr"), db, user)
        assert rejected.value.status_code == 409
    finally:
        db.rollback()
        db.close()

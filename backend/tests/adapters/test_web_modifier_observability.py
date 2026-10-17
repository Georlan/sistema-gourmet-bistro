import hashlib
import json
import logging

from fastapi import Request

from app.adapters.orders.web_adapter import _log_validation_rejection
from app.domain.orders.errors import (
    ModifierGroupMismatchError,
    ModifierInactiveError,
    ModifierNotFoundError,
)


def test_public_modifier_rejections_include_safe_tenant_scoped_diagnostics(caplog):
    req = Request({"type": "http"})
    req.state.request_id = "support-code-123"
    raw_id = "private-modifier-id"
    with caplog.at_level(logging.INFO, logger="koma.adapters.web"):
        _log_validation_rejection(req, 6, "delivery", ModifierInactiveError(raw_id), status_code=404)
    event = json.loads(caplog.records[-1].message)
    assert event["event"] == "public_order_validation_rejected"
    assert event["restaurante_id"] == 6
    assert event["request_id"] == "support-code-123"
    assert event["status_code"] == 404
    assert event["validation_type"] == "ModifierInactiveError"
    assert event["modifier_id_hash"] == hashlib.sha256(raw_id.encode()).hexdigest()[:16]
    assert raw_id not in caplog.records[-1].message


def test_public_modifier_rejection_types_are_distinguishable(caplog):
    req = Request({"type": "http"})
    for error in (
        ModifierNotFoundError("missing"),
        ModifierGroupMismatchError("option", "product"),
    ):
        with caplog.at_level(logging.INFO, logger="koma.adapters.web"):
            _log_validation_rejection(req, 6, "retirada", error, status_code=404)
        event = json.loads(caplog.records[-1].message)
        assert event["validation_type"] == type(error).__name__
        assert event["status_code"] == 404
        if isinstance(error, ModifierGroupMismatchError):
            assert event["product_id_hash"] == hashlib.sha256(b"product").hexdigest()[:16]
        else:
            assert "product_id_hash" not in event

from pathlib import Path

import pytest
from pydantic import ValidationError

from app.routes.auth import GdprOptOutRequest


ROOT = Path(__file__).resolve().parents[2]


def test_privacy_request_rejects_empty_or_implausible_phone():
    with pytest.raises(ValidationError):
        GdprOptOutRequest(telefone="")
    with pytest.raises(ValidationError):
        GdprOptOutRequest(telefone="123")


def test_privacy_request_does_not_reintroduce_phone_in_audit_log():
    source = (ROOT / "backend/app/routes/auth.py").read_text(encoding="utf-8")
    handler = source.split("def gdpr_opt_out(", 1)[1].split(
        "@router.post(\"/usuarios/{user_id}/reenviar-convite\")",
        1,
    )[0]

    activity_log = handler.split("log = ActivityLog(", 1)[1].split("db.add(log)", 1)[0]
    assert "target_phone" not in activity_log
    assert 'action="PRIVACY_REQUEST"' in activity_log
    assert '"manual_review_required": True' in handler
    assert '"automated_scope"' in handler

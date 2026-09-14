import pytest
from pydantic import ValidationError

from app.routes.super_admin_support import (
    SupportSessionEndRequest,
    SupportSessionStartRequest,
)


def test_support_session_start_reason_rejects_whitespace_only_value():
    with pytest.raises(ValidationError):
        SupportSessionStartRequest(reason="     ")


def test_support_session_start_reason_validates_normalized_length():
    with pytest.raises(ValidationError):
        SupportSessionStartRequest(reason="   abcd   ")


def test_support_session_start_reason_is_normalized_before_audit_use():
    payload = SupportSessionStartRequest(reason="   Incidente confirmado   ")
    assert payload.reason == "Incidente confirmado"


def test_support_session_end_reason_rejects_whitespace_only_value():
    with pytest.raises(ValidationError):
        SupportSessionEndRequest(reason="   ")


def test_support_session_end_reason_is_normalized_before_audit_use():
    payload = SupportSessionEndRequest(reason="   Encerrar suporte   ")
    assert payload.reason == "Encerrar suporte"

import pytest
from pydantic import ValidationError

from app.routes.super_admin_incidents import IncidentActionRequest


def _payload(reason: str) -> dict:
    return {
        "tenant_id": 1,
        "action_type": "retry_print_job",
        "target_id": "job-123",
        "reason": reason,
    }


def test_incident_action_reason_rejects_whitespace_only():
    with pytest.raises(ValidationError):
        IncidentActionRequest(**_payload("   "))


def test_incident_action_reason_validates_trimmed_length():
    with pytest.raises(ValidationError):
        IncidentActionRequest(**_payload("  ab  "))


def test_incident_action_reason_is_normalized():
    request = IncidentActionRequest(**_payload("  motivo operacional  "))
    assert request.reason == "motivo operacional"

"""No engine or real tenant is used by reset protection tests."""
from unittest.mock import Mock
import pytest
from app.services.tenant_first_day_reset import apply_tenant_first_day_reset, build_tenant_first_day_plan


def test_retired_reset_refuses_before_opening_any_connection():
    engine = Mock()
    with pytest.raises(RuntimeError, match="desativado"):
        apply_tenant_first_day_reset(engine, tenant_id=900001,
                                    expected_name="QA synthetic", confirmation="RESET_TENANT_FIRST_DAY")
    engine.begin.assert_not_called()


def test_protected_id_is_rejected_before_any_database_access():
    connection = Mock()
    with pytest.raises(RuntimeError, match="protegido"):
        build_tenant_first_day_plan(connection, tenant_id=6, expected_name="")
    assert connection.mock_calls == []

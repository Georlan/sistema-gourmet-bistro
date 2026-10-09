from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.exc import OperationalError
from app.routes import atendimentos as routes


@pytest.mark.parametrize("sqlstate", ["40P01", "40001", "23505", None])
def test_transfer_rolls_back_database_conflicts_without_masking_other_errors(monkeypatch, sqlstate):
    db = Mock()
    original = SimpleNamespace(pgcode=sqlstate)
    error = OperationalError("test query", {}, original)
    monkeypatch.setattr(routes, "require_waiter_permission", lambda *args: None)
    monkeypatch.setattr(routes, "require_tenant_id", lambda: 99001)
    monkeypatch.setattr(routes, "lock_tables_for_command_transfer", Mock(side_effect=error))
    tasks = BackgroundTasks()
    if sqlstate in {"40P01", "40001"}:
        with pytest.raises(HTTPException) as conflict:
            routes.transferir_atendimento_compativel("synthetic-command", 2, tasks, db, SimpleNamespace(id="actor"))
        assert conflict.value.status_code == 409
        assert "selecione novamente" in conflict.value.detail
    else:
        with pytest.raises(OperationalError) as failure:
            routes.transferir_atendimento_compativel("synthetic-command", 2, tasks, db, SimpleNamespace(id="actor"))
        assert failure.value is error
    db.rollback.assert_called_once()
    db.commit.assert_not_called()
    assert not tasks.tasks

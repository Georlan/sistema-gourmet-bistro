import datetime
from types import SimpleNamespace
from unittest.mock import Mock, patch
import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.exc import OperationalError

from app.routes import atendimentos as routes
from app.routes.atendimentos import TransferItemsBatchRequest
from app.services.billing_service import resolve_tenant_entitlement
from app.saas_billing_models import SaaSSubscription
from app.models import Item, Comanda, Mesa, Restaurante


@pytest.mark.parametrize("sqlstate", ["40P01", "40001", "23505", None])
def test_batch_transfer_rolls_back_database_conflicts(monkeypatch, sqlstate):
    """Garante que deadlock ou falha de serialização em lote retorna 409 sem 500 genérico."""
    db = Mock()
    original = SimpleNamespace(pgcode=sqlstate, sqlstate=sqlstate)
    error = OperationalError("test query", {}, original)

    monkeypatch.setattr(routes, "require_waiter_permission", lambda *args: None)
    monkeypatch.setattr(routes, "require_tenant_id", lambda: 99001)
    monkeypatch.setattr(routes, "materialize_table_accounts_for_write", lambda *args, **kwargs: None)
    monkeypatch.setattr(routes, "_item_already_at_table", lambda *args: None)
    monkeypatch.setattr(routes, "transfer_items_batch", Mock(side_effect=error))

    tasks = BackgroundTasks()
    payload = TransferItemsBatchRequest(item_ids=["item-1", "item-2"])
    actor = SimpleNamespace(id="actor-test")

    if sqlstate in {"40P01", "40001"}:
        with pytest.raises(HTTPException) as conflict:
            routes.transferir_itens_em_lote(3, payload, tasks, db, actor)
        assert conflict.value.status_code == 409
        assert "selecione novamente" in conflict.value.detail
    else:
        with pytest.raises(OperationalError) as failure:
            routes.transferir_itens_em_lote(3, payload, tasks, db, actor)
        assert failure.value is error

    db.rollback.assert_called_once()
    db.commit.assert_not_called()
    assert not tasks.tasks


def test_batch_transfer_idempotent_when_already_at_target_table(monkeypatch):
    """Se todos os itens do lote já foram transferidos para a mesa destino, retorna sucesso idempotente."""
    db = Mock()
    monkeypatch.setattr(routes, "require_waiter_permission", lambda *args: None)
    monkeypatch.setattr(routes, "require_tenant_id", lambda: 99001)
    monkeypatch.setattr(routes, "materialize_table_accounts_for_write", lambda *args, **kwargs: None)

    fake_item_1 = SimpleNamespace(id="item-1", comanda_id="cmd-tgt")
    fake_item_2 = SimpleNamespace(id="item-2", comanda_id="cmd-tgt")
    items_map = {"item-1": fake_item_1, "item-2": fake_item_2}
    monkeypatch.setattr(routes, "_item_already_at_table", lambda _db, _rid, iid, _tid: items_map.get(iid))

    mock_transfer = Mock()
    monkeypatch.setattr(routes, "transfer_items_batch", mock_transfer)

    tasks = BackgroundTasks()
    payload = TransferItemsBatchRequest(item_ids=["item-1", "item-2"])
    actor = SimpleNamespace(id="actor-test")

    result = routes.transferir_itens_em_lote(5, payload, tasks, db, actor)
    assert result == [fake_item_1, fake_item_2]
    mock_transfer.assert_not_called()
    db.commit.assert_not_called()


def test_batch_transfer_mixed_batch_conflict_returns_409(monkeypatch):
    """Se o lote mistura itens já na mesa de destino com itens ainda na origem, retorna 409."""
    db = Mock()
    monkeypatch.setattr(routes, "require_waiter_permission", lambda *args: None)
    monkeypatch.setattr(routes, "require_tenant_id", lambda: 99001)
    monkeypatch.setattr(routes, "materialize_table_accounts_for_write", lambda *args, **kwargs: None)

    fake_item_1 = SimpleNamespace(id="item-1", comanda_id="cmd-tgt")
    monkeypatch.setattr(
        routes,
        "_item_already_at_table",
        lambda _db, _rid, iid, _tid: fake_item_1 if iid == "item-1" else None,
    )

    tasks = BackgroundTasks()
    payload = TransferItemsBatchRequest(item_ids=["item-1", "item-2"])
    actor = SimpleNamespace(id="actor-test")

    with pytest.raises(HTTPException) as conflict:
        routes.transferir_itens_em_lote(5, payload, tasks, db, actor)

    assert conflict.value.status_code == 409
    assert "mistura itens já transferidos" in conflict.value.detail
    db.rollback.assert_called_once()


def test_single_item_transfer_already_at_table_is_idempotent(monkeypatch):
    """Transferência individual de item já na mesa retorna sucesso idempotente."""
    db = Mock()
    monkeypatch.setattr(routes, "require_waiter_permission", lambda *args: None)
    monkeypatch.setattr(routes, "require_tenant_id", lambda: 99001)

    fake_item = SimpleNamespace(id="item-1", comanda_id="cmd-tgt")
    monkeypatch.setattr(routes, "_item_already_at_table", lambda _db, _rid, iid, _tid: fake_item)

    mock_transfer = Mock()
    monkeypatch.setattr(routes, "transfer_items_batch", mock_transfer)

    tasks = BackgroundTasks()
    actor = SimpleNamespace(id="actor-test")

    result = routes.transferir_item_compativel("item-1", 5, tasks, db, actor)
    assert result is fake_item
    mock_transfer.assert_not_called()


def test_expired_trial_loses_entitlement_even_if_status_is_trialing():
    """Confirma que assinatura com status persistido 'trialing', mas trial_ends_at expirado, perde o direito de acesso."""
    past_date = datetime.datetime(2026, 10, 19, 0, 0, tzinfo=datetime.timezone.utc)

    mock_restaurant = SimpleNamespace(
        id=8,
        saas_status="active",
        billing_mode="subscription",
    )
    mock_sub = SimpleNamespace(
        id="sub-123",
        restaurante_id=8,
        status="trialing",
        trial_ends_at=past_date,
        current_period_end=None,
        current_period_start=None,
        trial_started_at=datetime.datetime(2026, 10, 5, 0, 0, tzinfo=datetime.timezone.utc),
        grace_until=None,
    )

    db = Mock()
    def mock_query(model):
        q = Mock()
        if model is Restaurante:
            q.filter.return_value.one_or_none.return_value = mock_restaurant
        elif model is SaaSSubscription:
            q.filter.return_value.one_or_none.return_value = mock_sub
        else:
            q.filter.return_value.one_or_none.return_value = None
        return q

    db.query.side_effect = mock_query

    entitlement = resolve_tenant_entitlement(db, 8)
    assert entitlement.allowed is False
    assert entitlement.reason == "trial_expired"
    assert entitlement.billing_status == "past_due"

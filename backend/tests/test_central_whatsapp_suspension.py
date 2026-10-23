"""Central-only activation, no-provider fast paths and new-events-only recovery."""
import datetime as dt
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.models import CentralWhatsAppSenderState, IntegrationOutbox
from app.routes import super_admin_whatsapp as admin, tenant_whatsapp as tenant_routes
from app.services import central_whatsapp as central
from app.services.whatsapp_sender_gate import sender_available, suspend_sender
from app.services.outbox.dispatcher import dispatch_single_outbox_event
from tests.test_whatsapp_registered_flow import flow, order, provider, config


def test_disabled_transport_does_not_even_query_database(monkeypatch):
    monkeypatch.setenv('KOMA_CENTRAL_WA_ENABLED', 'false')
    db = MagicMock()
    assert central.enqueue_operator_alert(db, SimpleNamespace(channel=central.OrderChannel.WEB_CARDAPIO)) is None
    assert not db.mock_calls


@pytest.mark.parametrize('change', ['missing_phone', 'individual', 'not_allowed'])
def test_unregistered_tenant_never_queues_or_calls_provider(flow, change):
    db, patch = flow
    _, _, event = order(db)
    cfg = config(db)
    if change == 'missing_phone': cfg.whatsapp_recipient_phone = None
    if change == 'individual': cfg.whatsapp_instance_name = 'koma-restaurant-701'
    if change == 'not_allowed': patch.setenv('KOMA_CENTRAL_WA_ALLOWED_RESTAURANT_IDS', '')
    db.commit()
    transport = MagicMock(side_effect=AssertionError('no provider call'))
    patch.setattr(central.httpx, 'Client', transport)
    assert central.enqueue_operator_alert(db, event) is None
    assert db.query(IntegrationOutbox).filter_by(event_name=central.EVENT_NAME).count() == 0
    transport.assert_not_called()


def test_disconnect_suspends_once_and_never_replays_old_notices(flow):
    db, patch = flow
    _, _, event = order(db, suffix='1')
    first = central.enqueue_operator_alert(db, event)
    _, _, second = order(db, suffix='2')
    queued_before_loss = central.enqueue_operator_alert(db, second)
    db.commit()
    probes = []
    calls = provider(patch, verify=lambda *args: probes.append('probe') or 'not_open')
    assert not dispatch_single_outbox_event(db, first)
    assert db.query(CentralWhatsAppSenderState).one().suspended_at is not None
    assert first.status == 'dead_letter'
    assert probes == ['probe'] and not calls
    _, _, third = order(db, suffix='3')
    assert central.enqueue_operator_alert(db, third) is None
    assert not dispatch_single_outbox_event(db, queued_before_loss)
    assert probes == ['probe'] and not calls
    assert not sender_available(db, central.transport_configuration())


def test_explicit_resume_requires_fresh_identity_and_only_new_events(flow):
    db, patch = flow
    _, _, event = order(db, suffix='1')
    old = central.enqueue_operator_alert(db, event)
    old.created_at = dt.datetime.now(dt.timezone.utc)-dt.timedelta(minutes=1)
    suspend_sender(db, central.transport_configuration())
    db.commit()
    # Handler must own an independent session; the test factory uses the same DB.
    from sqlalchemy.orm import Session
    patch.setattr(admin, 'SessionLocal', lambda: Session(db.get_bind()))
    patch.setattr(admin, '_probe_connection', lambda cfg: 'mismatch')
    with pytest.raises(HTTPException) as error:
        admin.resume_central_sender({'user': 'fixture-admin'})
    assert error.value.status_code == 409
    assert not sender_available(db, central.transport_configuration())
    patch.setattr(admin, '_probe_connection', lambda cfg: 'matched')
    assert admin.resume_central_sender({'user': 'fixture-admin'})['new_events_only']
    db.expire_all()
    calls = provider(patch)
    assert not dispatch_single_outbox_event(db, old)
    assert not calls
    _, _, event = order(db, suffix='2')
    fresh = central.enqueue_operator_alert(db, event)
    db.commit()
    assert dispatch_single_outbox_event(db, fresh)
    assert len(calls) == 1
    cutoff = db.query(CentralWhatsAppSenderState).one().accept_events_after
    db.rollback()
    assert not admin.resume_central_sender({'user': 'fixture-admin'})['resumed']
    db.expire_all()
    assert db.query(CentralWhatsAppSenderState).one().accept_events_after == cutoff
    assert calls[0]['number'] == config(db).whatsapp_recipient_phone


def test_old_individual_configuration_status_does_not_probe_evolution(flow):
    db, patch = flow
    cfg = config(db)
    cfg.whatsapp_instance_name = 'koma-restaurant-701'
    db.commit()
    probe = MagicMock(side_effect=AssertionError('no tenant device probe'))
    patch.setattr(tenant_routes.wa, 'connection_state', probe)
    result = tenant_routes.get_status(db, SimpleNamespace(restaurante_id=701))
    assert result['mode'] == 'central' and result['state'] == 'not_configured'
    probe.assert_not_called()


def test_no_individual_activation_endpoints_remain():
    paths = {route.path for route in tenant_routes.router.routes}
    assert not paths.intersection({f'/caixa/configuracoes/whatsapp/{action}' for action in ('configure','qr','pairing-code','enable')})


def test_legacy_scheduler_allocates_no_tasks_or_database_sessions(monkeypatch):
    from app.services import notificacoes
    background = MagicMock()
    db = MagicMock()
    factory = MagicMock(side_effect=AssertionError('no legacy database session'))
    monkeypatch.setattr(notificacoes, 'SessionLocal', factory)
    monkeypatch.setattr(notificacoes.settings, 'KOMA_WHATSAPP_AUTOMATION_ENABLED', True)
    notificacoes.agendar_notificacao_whatsapp_task(background, telefone='5511999999999', conteudo='fixture', tipo='atribuicao_motoboy', restaurante_id=701, db=db)
    notificacoes.agendar_notificacao_status_task(background, 'test', 'pronto', '5511999999999', 'Fixture', restaurante_id=701)
    assert not background.mock_calls and not db.mock_calls and not factory.mock_calls

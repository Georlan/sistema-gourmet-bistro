from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.database import SessionLocal
from app.models import ConfiguracaoRestaurante
from app.routes import tenant_whatsapp as routes
from tests.characterization.orders.fixtures import CHAR_RESTAURANT_ID, char_client, char_setup


@pytest.mark.parametrize('operation', ['status', 'configure', 'qr', 'pairing', 'enable', 'disconnect'])
@pytest.mark.parametrize('provider_fails', [False, True])
def test_provider_never_holds_read_connection(char_setup, monkeypatch, operation, provider_fails):
    rid = CHAR_RESTAURANT_ID
    db = SessionLocal(restaurante_id=rid)
    try:
        config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=rid).one()
        config.whatsapp_instance_name = routes.wa.instance_name(rid)
        config.whatsapp_recipient_phone = '5511999999999'
        config.whatsapp_alerts_enabled = False
        db.commit()
        calls = []

        def provider(result):
            def call(*args, **kwargs):
                calls.append(db.in_transaction())
                assert not db.in_transaction(), operation
                if provider_fails:
                    raise RuntimeError('test provider unavailable')
                return result
            return call

        for name, result in [('connection_state', 'open'), ('owner_phone', '5511999999999'),
                             ('connect_instance', {'qrcode': {'code': 'fixture-qr'}}),
                             ('recreate_instance_with_pairing_code', ({}, 'fixture-code')),
                             ('logout_instance', {}), ('delete_instance', {})]:
            monkeypatch.setattr(routes.wa, name, provider(result))
        user = SimpleNamespace(restaurante_id=rid)
        handlers = {
            'status': lambda: routes.get_status(db, user),
            'configure': lambda: routes.configure(routes.ConfigureRequest(phone='11999999999'), db, user),
            'qr': lambda: routes.refresh_qr(db, user),
            'pairing': lambda: routes.refresh_pairing_code(db, user),
            'enable': lambda: routes.enable(db, user),
            'disconnect': lambda: routes.disconnect(db, user),
        }
        if provider_fails and operation != 'status':
            with pytest.raises(HTTPException) as caught:
                handlers[operation]()
            assert caught.value.status_code == 502
        else:
            response = handlers[operation]()
            if operation == 'status':
                assert response['state'] == ('error' if provider_fails else 'connected')
        assert calls
        assert not any(calls)
        db.rollback()
        stored = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=rid).one()
        assert stored.whatsapp_alerts_enabled is (operation == 'enable' and not provider_fails)
        if operation == 'disconnect' and not provider_fails:
            assert stored.whatsapp_instance_name is None
    finally:
        db.close()

import json
from unittest.mock import Mock

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.pool import QueuePool
from starlette.requests import Request
from pydantic import BaseModel, ValidationError

from app import database_diagnostics
from app.main import _validation_diagnostic, _log_auth_rejection


def test_slow_checkout_is_reported_without_sql_or_values(monkeypatch, caplog):
    clock = [100.0]
    monkeypatch.setattr(database_diagnostics, 'monotonic', lambda: clock[0])
    engine = create_engine('sqlite://', poolclass=QueuePool, pool_size=1, max_overflow=0)
    database_diagnostics.install_pool_diagnostics(engine, lambda: 6)
    with engine.connect() as connection:
        connection.execute(text("SELECT :value"), {'value': 'SECRET_SENTINEL'})
        clock[0] += 6
    record = json.loads(caplog.records[-1].message)
    assert record['event'] == 'sql_connection_held'
    assert record['duration_ms'] == 6000
    assert record['restaurante_id'] == 6
    assert record['pool_size'] == 1
    assert engine.pool.checkedout() == 0
    assert 'SECRET_SENTINEL' not in caplog.text
    assert 'SELECT' not in caplog.text
    caplog.clear()
    with engine.connect() as connection:
        connection.execute(text('SELECT 1'))
        clock[0] += 1
    assert not caplog.records
    engine.dispose()


def test_exception_returns_slot_and_clears_metadata(monkeypatch, caplog):
    clock = [0.0]
    monkeypatch.setattr(database_diagnostics, 'monotonic', lambda: clock[0])
    engine = create_engine('sqlite://', poolclass=QueuePool, pool_size=1, max_overflow=0)
    database_diagnostics.install_pool_diagnostics(engine, lambda: None)
    with pytest.raises(RuntimeError):
        with engine.begin() as connection:
            connection.execute(text('SELECT 1'))
            clock[0] = 7
            raise RuntimeError('SECRET_SENTINEL')
    assert engine.pool.checkedout() == 0
    assert len(caplog.records) == 1
    assert 'SECRET_SENTINEL' not in caplog.text
    engine.dispose()


def test_validation_details_never_include_input_or_dynamic_locations():
    class ArbitraryResponse(BaseModel):
        private_customer_key: int
    with pytest.raises(ValidationError) as caught:
        ArbitraryResponse(private_customer_key='SECRET_SENTINEL')
    diagnostic = _validation_diagnostic(caught.value)
    assert diagnostic == {'validation_error_count': 1, 'validation_errors': [
        {'field': '<redacted>', 'type': 'int_parsing'}
    ]}
    assert 'SECRET_SENTINEL' not in json.dumps(diagnostic)


def test_config_validation_reports_only_known_schema_field():
    error = ValidationError.from_exception_data('ConfiguracaoRestauranteResponse', [
        {'type': 'int_parsing', 'loc': ('restaurante_id',), 'input': 'SECRET_SENTINEL'},
    ])
    diagnostic = _validation_diagnostic(error)
    assert diagnostic['validation_errors'] == [{'field': 'restaurante_id', 'type': 'int_parsing'}]
    assert 'SECRET_SENTINEL' not in json.dumps(diagnostic)


def test_auth_rejection_uses_route_template_without_token(monkeypatch):
    logger = Mock()
    monkeypatch.setattr('app.main.request_logger', logger)
    request = Request({'type': 'http', 'method': 'GET', 'path': '/private/SECRET_SENTINEL',
                       'headers': [(b'authorization', b'Bearer SECRET_SENTINEL')]})
    _log_auth_rejection(request, 'expired_token')
    payload = json.loads(logger.warning.call_args.args[0])
    assert payload['reason'] == 'expired_token'
    assert payload['path'] == '<unmatched>'
    assert 'SECRET_SENTINEL' not in logger.warning.call_args.args[0]


@pytest.mark.parametrize('failure,reason', [
    ('expired', 'expired_token'), ('signature', 'invalid_signature'), ('decode', 'invalid_token'),
])
def test_middleware_preserves_rejection_and_classifies_jwt(monkeypatch, failure, reason):
    import jwt
    from app.main import add_sentry_context_and_tenant
    errors = {'expired': jwt.ExpiredSignatureError, 'signature': jwt.InvalidSignatureError,
              'decode': jwt.DecodeError}
    monkeypatch.setattr(jwt, 'decode', Mock(side_effect=errors[failure]('SECRET_SENTINEL')))
    logger = Mock()
    monkeypatch.setattr('app.main.request_logger', logger)
    request = Request({'type': 'http', 'method': 'GET', 'path': '/private',
                       'headers': [(b'authorization', b'Bearer SECRET_SENTINEL')]})
    next_handler = Mock()
    import asyncio
    response = asyncio.run(add_sentry_context_and_tenant(request, next_handler))
    assert response.status_code == 401
    next_handler.assert_not_called()
    assert json.loads(logger.warning.call_args.args[0])['reason'] == reason
    assert 'SECRET_SENTINEL' not in logger.warning.call_args.args[0]

import asyncio
import io
import json
import urllib.error
from contextlib import contextmanager
from types import SimpleNamespace

import pytest
import sentry_sdk
from sentry_sdk.integrations.stdlib import StdlibIntegration
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app.main import app
from app.routes import super_admin
from app.routes import super_admin_services as services
from app.security import create_access_token


def probe(monkeypatch, replies):
    requests = []
    def open_url(url, **kwargs):
        requests.append(url)
        assert kwargs['timeout'] == 5
        reply = replies[len(requests) - 1]
        if isinstance(reply, Exception):
            raise reply
        return io.BytesIO(json.dumps({'ok': True, 'result': reply}).encode())
    monkeypatch.setattr(services.urllib.request, 'urlopen', open_url)
    return requests


def test_telegram_reads_bot_destination_and_membership_without_exposing_secrets(monkeypatch):
    requests = probe(monkeypatch, [{'is_bot': True, 'id': 5}, {'id': -42, 'title': 'Private destination'}, {'status': 'member'}])
    health = asyncio.run(services.TelegramService('synthetic-token', '-42').get_health())
    assert health['status'] == 'verified'
    assert health['delivery_status'] == 'not_tested'
    assert health['checks'] == {'bot': 'verified', 'destination': 'verified', 'membership': 'verified'}
    assert [url.split('?')[0].rsplit('/', 1)[-1] for url in requests] == ['getMe', 'getChat', 'getChatMember']
    serialized = json.dumps(health)
    for secret in ['synthetic-token', '-42', 'Private destination']:
        assert secret not in serialized
    assert health['checked_at']


@pytest.mark.parametrize('status', ['left', 'kicked', 'restricted'])
def test_telegram_missing_membership_is_not_verified(monkeypatch, status):
    probe(monkeypatch, [{'is_bot': True, 'id': 5}, {'id': -42}, {'status': status, 'is_member': False}])
    health = asyncio.run(services.TelegramService('token', '-42').get_health())
    assert health['status'] == 'unavailable'
    assert health['checks']['membership'] == 'unavailable'


@pytest.mark.parametrize('error,expected', [
    (urllib.error.HTTPError('https://token-secret', 401, 'secret', {}, None), 'unavailable'),
    (urllib.error.HTTPError('https://token-secret', 429, 'secret', {}, None), 'unverified'),
    (OSError('token-secret private-chat'), 'unverified'),
])
def test_telegram_partial_failure_preserves_checks_and_sanitizes_errors(monkeypatch, error, expected):
    probe(monkeypatch, [{'is_bot': True, 'id': 5}, error])
    health = asyncio.run(services.TelegramService('token-secret', 'private-chat').get_health())
    assert health['status'] == expected
    assert health['checks']['bot'] == 'verified'
    assert health['checks']['destination'] == expected
    assert 'token-secret' not in json.dumps(health)
    assert 'private-chat' not in json.dumps(health)


def test_telegram_missing_configuration_does_not_query(monkeypatch):
    monkeypatch.delenv('TELEGRAM_BOT_TOKEN', raising=False)
    monkeypatch.delenv('TELEGRAM_CHAT_ID', raising=False)
    requests = probe(monkeypatch, [])
    assert asyncio.run(services.TelegramService().get_health())['status'] == 'not_configured'
    assert requests == []


def test_telegram_explicit_send_restriction_is_reported(monkeypatch):
    probe(monkeypatch, [{'is_bot': True, 'id': 5}, {'id': -42}, {'status': 'restricted', 'is_member': True, 'can_send_messages': False}])
    health = asyncio.run(services.TelegramService('token', '-42').get_health())
    assert health['status'] == 'unavailable'
    assert health['checks']['membership'] == 'restricted'


def test_telegram_invalid_response_is_not_verified(monkeypatch):
    probe(monkeypatch, [{'is_bot': False, 'id': 5}])
    assert asyncio.run(services.TelegramService('token', '-42').get_health())['status'] == 'unverified'


def test_telegram_secret_urls_are_not_recorded_by_active_sentry_integration(monkeypatch):
    outer_client = sentry_sdk.Client(dsn='', default_integrations=False, integrations=[StdlibIntegration()])
    requests = probe(monkeypatch, [{'is_bot': True, 'id': 5}, {'id': -42}, {'status': 'member'}])
    open_url = services.urllib.request.urlopen
    def private_read(*args, **kwargs):
        client = sentry_sdk.get_client()
        assert client is not outer_client
        assert not client.dsn
        assert client.get_integration(StdlibIntegration) is None
        return open_url(*args, **kwargs)
    monkeypatch.setattr(services.urllib.request, 'urlopen', private_read)
    with sentry_sdk.new_scope() as scope:
        scope.set_client(outer_client)
        health = asyncio.run(services.TelegramService('token', '-42').get_health())
        assert sentry_sdk.get_client() is outer_client
    assert health['status'] == 'verified'
    assert len(requests) == 3


def test_telegram_health_requires_superadmin():
    client = TestClient(app)
    assert client.get('/api/super-admin/telegram/health').status_code == 401
    token = create_access_token(subject='staff', restaurante_id=1, role='garcom')
    assert client.get('/api/super-admin/telegram/health', headers={'Authorization': f'Bearer {token}'}).status_code == 403


def test_public_github_workflows_do_not_require_token(monkeypatch):
    monkeypatch.delenv('GITHUB_TOKEN', raising=False)
    calls = []
    class Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def get(self, url, **kwargs):
            calls.append((url, kwargs))
            return SimpleNamespace(status_code=200, json=lambda: {'workflow_runs': [{'id': 7}]})
    monkeypatch.setattr(super_admin.httpx, 'AsyncClient', Client)
    assert asyncio.run(super_admin.get_github_runs({})) == {'workflow_runs': [{'id': 7}]}
    assert len(calls) == 1
    assert 'Authorization' not in calls[0][1]['headers']


def test_github_rate_limit_is_explicitly_unavailable(monkeypatch):
    class Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def get(self, *args, **kwargs): return SimpleNamespace(status_code=403)
    monkeypatch.setattr(super_admin.httpx, 'AsyncClient', Client)
    with pytest.raises(HTTPException) as failure:
        asyncio.run(super_admin.get_github_runs({}))
    assert failure.value.status_code == 503


def test_database_latency_excludes_evolution_and_railway_identity_is_not_health(monkeypatch):
    clock = [10]
    monkeypatch.setattr(super_admin.time, 'perf_counter', lambda: clock[0])
    def query(*args):
        clock[0] = 10.125
    def evolution():
        clock[0] = 20
        return {'configured': False}
    @contextmanager
    def connect():
        yield SimpleNamespace(execute=query)
    monkeypatch.setattr(super_admin, 'engine', SimpleNamespace(connect=connect))
    monkeypatch.setattr(super_admin, 'obter_status_evolution', evolution)
    monkeypatch.setenv('RAILWAY_ENVIRONMENT_ID', 'environment-id')
    monkeypatch.setenv('RAILWAY_SERVICE_ID', 'service-id')
    monkeypatch.delenv('RAILWAY_API_TOKEN', raising=False)
    health = super_admin.get_integrations_health({})
    assert health['database']['latency_ms'] == 125
    assert health['railway']['hosting_detected'] is True
    assert health['railway']['status'] == 'not_configured'
    assert 'service-id' not in json.dumps(health)

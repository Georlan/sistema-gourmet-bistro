"""Pure sanitizer tests with invented data; never Sandbox evidence."""
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('pagbank_evidence', Path(__file__).resolve().parents[2] / 'scripts/pagbank-sandbox-evidence.py')
evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evidence)


def test_secrets_and_card_fields_are_excluded_but_bank_error_codes_remain(monkeypatch):
    monkeypatch.setenv('INTERNAL_TEST_TOKEN', 'internal-fixture-token')
    sanitized = evidence.sanitize({
        'access_token': 'internal-fixture-token', 'code': 'oauth-code', 'state': 'oauth-state',
        'card': {'number': '4111111111111111', 'security_code': '123'},
        'security_code': '123', 'cvv': '123',
        'error_messages': [{'code': 'forbidden', 'description': 'Denied'}],
        'payment_response': {'code': '20000'},
        'url': 'https://example.test/?code=oauth-code&state=nonce',
        'description': 'internal-fixture-token email@example.test',
        'charges': [{'id': 'CHAR_INTERNAL_FIXTURE', 'payment_method': {'type': 'PIX'},
                     'qr_code': {'text': 'internal-qr-value'}}],
        'customer': {'name': 'Private name', 'tax_id': '12345678901'},
    })
    text = json.dumps(sanitized)
    for secret in ('4111111111111111', 'security_code', 'cvv', 'oauth-code', 'oauth-state',
                   'internal-fixture-token', 'email@example.test', 'Private name', '12345678901', 'internal-qr-value'):
        assert secret not in text
    assert sanitized['error_messages'][0]['code'] == 'forbidden'
    assert sanitized['payment_response']['code'] == '20000'
    assert sanitized['charges'][0]['id'] == 'CHAR_INTERNAL_FIXTURE'
    assert sanitized['charges'][0]['payment_method']['type'] == 'PIX'


def test_aliases_formatted_documents_and_free_text_cannot_leak():
    sanitized = evidence.sanitize({
        'clientSecret': 'unregistered-secret', 'X-Client-Secret': 'header-secret',
        'accessToken': 'unregistered-token', 'Set-Cookie': 'private-session',
        'password': 'fixture-pw',
        'error_messages': [{'code': 'FORBIDDEN', 'description': 'CVV 123; nome privado'}],
        'payment_response': {'code': '20000', 'message': 'cartão 4111 1111 1111 1111'},
        'diagnostic': 'CPF 123.456.789-01 CNPJ 12.345.678/0001-90 Bearer unknown-token',
        'id': 'ORDE_INTERNAL_FIXTURE',
    })
    text = json.dumps(sanitized)
    for secret in ('unregistered-secret', 'header-secret', 'unregistered-token',
                   'private-session', 'fixture-pw', '123.456.789-01',
                   '12.345.678/0001-90', 'unknown-token', '4111', 'CVV', 'nome privado'):
        assert secret not in text
    assert sanitized['error_messages'][0]['code'] == 'FORBIDDEN'
    assert sanitized['payment_response']['code'] == '20000'
    assert sanitized['id'] == 'ORDE_INTERNAL_FIXTURE'


def test_cli_refuses_synthetic_authorization_callback_and_duplicate_exchange(monkeypatch, tmp_path):
    import pytest

    for command in ('authorize', 'callback', 'token'):
        monkeypatch.setattr('sys.argv', ['evidence', command, '--output', str(tmp_path / 'out.json')])
        with pytest.raises(SystemExit) as exc:
            evidence.main()
        assert exc.value.code == 2
    assert not (tmp_path / 'out.json').exists()


def test_real_oauth_exchange_is_logged_once_with_strict_redaction(monkeypatch, caplog):
    """Mocked response proves telemetry safety; NOT genuine bank evidence."""
    import httpx
    from app.services.online_payments.pagbank import oauth

    monkeypatch.setenv('PAGBANK_ENV', 'sandbox')
    monkeypatch.setenv('PAGBANK_SANDBOX_OAUTH_EVIDENCE_RESTAURANT_IDS', '9')
    monkeypatch.setenv('PAGBANK_CLIENT_ID', 'fixture-client-id')
    monkeypatch.setenv('PAGBANK_CLIENT_SECRET', 'fixture-client-secret')
    monkeypatch.setenv('PAGBANK_APP_TOKEN', 'fixture-app-token')
    monkeypatch.setenv('PAGBANK_OAUTH_REDIRECT_URI',
                       'https://api.example.test/payments/pagbank/oauth/callback')

    state = 'fixture-raw-state-that-must-never-appear'
    code = 'fixture-one-time-authorization-code'
    body = {
        'access_token': 'fixture-seller-access-token',
        'refresh_token': 'fixture-seller-refresh-token',
        'account_id': 'ACCO_TEST_SELLER',
        'expires_in': 3600,
        'token_type': 'Bearer',
        'description': 'private free-form banking response',
    }
    calls = []

    def handle(req):
        calls.append(req)
        assert req.url.host == 'sandbox.api.pagseguro.com'
        assert req.url.path == '/oauth2/token'
        assert req.headers['Authorization'] == 'Bearer fixture-app-token'
        return httpx.Response(201, json=body, headers={'x-request-id': 'safe_request_123'})

    with caplog.at_level('WARNING', logger='koma.pagbank'):
        oauth.log_sandbox_oauth_evidence('authorization_url_issued', restaurant_id=9, state=state)
        oauth.log_sandbox_oauth_evidence('callback_received', restaurant_id=9, state=state,
                                        code_present=True, error_present=False)
        with httpx.Client(transport=httpx.MockTransport(handle)) as client:
            actual = oauth._post('/oauth2/token', {
                'grant_type': 'authorization_code',
                'code': code,
                'redirect_uri': 'https://api.example.test/payments/pagbank/oauth/callback',
            }, environment='sandbox', client=client,
                evidence_restaurant_id=9, evidence_state=state)
        oauth.log_sandbox_oauth_evidence('connection_completed', restaurant_id=9, state=state)

    assert actual == body
    assert len(calls) == 1
    records = [json.loads(r.message.removeprefix('PAGBANK_OAUTH_EVIDENCE '))
               for r in caplog.records if r.message.startswith('PAGBANK_OAUTH_EVIDENCE ')]
    assert [r['stage'] for r in records] == [
        'authorization_url_issued', 'callback_received', 'token_exchange', 'connection_completed']
    assert len({r['flow_id'] for r in records}) == 1
    assert records[2]['http_status'] == 201
    assert records[2]['result'] == 'http_success'
    assert records[2]['has_access_token'] is True
    assert records[2]['has_refresh_token'] is True
    assert records[2]['has_account_id'] is True
    assert records[2]['expires_in'] == 3600
    assert records[2]['pagbank_request_id'] == 'safe_request_123'
    assert records[0]['result'] == 'authorization_url_issued_by_koma'
    assert records[1]['code_present'] is True

    log_text = json.dumps(records)
    for secret in (state, code, 'fixture-app-token', 'fixture-client-secret',
                   'fixture-seller-access-token', 'fixture-seller-refresh-token',
                   'ACCO_TEST_SELLER', 'private free-form banking response'):
        assert secret not in log_text


def test_oauth_evidence_never_logs_production_or_unlisted_tenants(monkeypatch, caplog):
    from app.services.online_payments.pagbank import oauth

    monkeypatch.setenv('PAGBANK_ENV', 'sandbox')
    monkeypatch.setenv('PAGBANK_PRODUCTION_RESTAURANT_IDS', '8')
    monkeypatch.setenv('PAGBANK_SANDBOX_OAUTH_EVIDENCE_RESTAURANT_IDS', '9')
    with caplog.at_level('WARNING', logger='koma.pagbank'):
        oauth.log_sandbox_oauth_evidence('callback_received', restaurant_id=8,
                                        state='production-state', code_present=True)
        oauth.log_sandbox_oauth_evidence('callback_received', restaurant_id=7,
                                        state='other-tenant-state', code_present=True)
    assert not any('PAGBANK_OAUTH_EVIDENCE' in r.message for r in caplog.records)


def test_sandbox_exchange_rejection_logs_status_without_bank_body(monkeypatch, caplog):
    import httpx
    import pytest
    from app.services.online_payments.pagbank import oauth

    monkeypatch.setenv('PAGBANK_ENV', 'sandbox')
    monkeypatch.setenv('PAGBANK_SANDBOX_OAUTH_EVIDENCE_RESTAURANT_IDS', '9')
    monkeypatch.setenv('PAGBANK_CLIENT_ID', 'fixture-client-id')
    monkeypatch.setenv('PAGBANK_CLIENT_SECRET', 'fixture-client-secret')
    monkeypatch.setenv('PAGBANK_APP_TOKEN', 'fixture-app-token')
    monkeypatch.setenv('PAGBANK_OAUTH_REDIRECT_URI',
                       'https://api.example.test/payments/pagbank/oauth/callback')

    def handle(_req):
        return httpx.Response(400, json={'error_description': 'private bank error and fixture-secret'},
                              headers={'x-request-id': 'unsafe secret private value'})
    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        with caplog.at_level('WARNING', logger='koma.pagbank'):
            with pytest.raises(oauth.PagBankOAuthError):
                oauth._post('/oauth2/token', {'code': 'private-auth-code'},
                            environment='sandbox', client=client,
                            evidence_restaurant_id=9, evidence_state='private-state')
    log_text = '\n'.join(r.message for r in caplog.records)
    assert '400' in log_text
    for secret in ('private bank error', 'fixture-secret', 'private-auth-code',
                   'private-state', 'unsafe secret private value'):
        assert secret not in log_text

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


def test_authorize_and_callback_evidence_sanitization(tmp_path, monkeypatch):
    monkeypatch.setenv('PAGBANK_CLIENT_ID', 'test-client-id')
    monkeypatch.setenv('PAGBANK_OAUTH_STATE', 'signed-state-data-not-to-be-leaked')
    monkeypatch.setenv('PAGBANK_AUTHORIZATION_CODE', 'real-oauth-code-12345')

    out_auth = tmp_path / 'auth.json'
    monkeypatch.setattr('sys.argv', ['evidence', 'authorize', '--output', str(out_auth)])
    evidence.main()

    data_auth = json.loads(out_auth.read_text())
    assert data_auth['operation'] == 'initiate_authorization'
    assert data_auth['environment'] == 'sandbox'
    assert 'signed-state-data-not-to-be-leaked' not in json.dumps(data_auth)
    assert 'test-client-id' in json.dumps(data_auth)
    assert data_auth['request']['query_params']['scope'] == 'payments.read payments.create payments.refund accounts.read'

    out_cb = tmp_path / 'callback.json'
    monkeypatch.setattr('sys.argv', ['evidence', 'callback', '--output', str(out_cb)])
    evidence.main()

    data_cb = json.loads(out_cb.read_text())
    assert data_cb['operation'] == 'seller_authorization_callback'
    assert data_cb['status'] == 'authorized'
    assert 'real-oauth-code-12345' not in json.dumps(data_cb)
    assert data_cb['callback']['code_present'] is True


def test_token_exchange_evidence_structure_and_masking(tmp_path, monkeypatch):
    monkeypatch.setenv('PAGBANK_APP_TOKEN', 'fixture-app-token')
    monkeypatch.setenv('PAGBANK_CLIENT_ID', 'fixture-client-id')
    monkeypatch.setenv('PAGBANK_CLIENT_SECRET', 'fixture-secret-value')
    monkeypatch.setenv('PAGBANK_AUTHORIZATION_CODE', 'fixture-auth-code')

    requests = []
    def mock_post(url, headers, json, **kwargs):
        requests.append((url, headers, json))
        import httpx
        return httpx.Response(201, json={
            'access_token': 'fixture-seller-access-token',
            'refresh_token': 'fixture-seller-refresh-token',
            'token_type': 'bearer',
            'expires_in': 3600,
            'account_id': 'ACCO_TEST_SELLER',
        })

    class FakeClient:
        def __init__(self, *args, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def request(self, method, url, headers=None, json=None, **kwargs):
            return mock_post(url, headers, json, **kwargs)

    monkeypatch.setattr(evidence.httpx, 'Client', FakeClient)

    out_token = tmp_path / 'token.json'
    monkeypatch.setattr('sys.argv', ['evidence', 'token', '--output', str(out_token)])
    evidence.main()

    data = json.loads(out_token.read_text())
    raw_text = out_token.read_text()
    assert 'fixture-seller-access-token' not in raw_text
    assert 'fixture-seller-refresh-token' not in raw_text
    assert 'fixture-secret-value' not in raw_text
    assert 'fixture-auth-code' not in raw_text

    assert data['operation'] == 'exchange_token'
    assert data['result'] == 'success'
    assert data['token_fields_returned']['has_access_token'] is True
    assert data['token_fields_returned']['has_refresh_token'] is True
    assert data['token_fields_returned']['token_type'] == 'bearer'
    assert data['token_fields_returned']['expires_in'] == 3600
    assert data['token_fields_returned']['account_id'] == 'ACCO_TEST_SELLER'


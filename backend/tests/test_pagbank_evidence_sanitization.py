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

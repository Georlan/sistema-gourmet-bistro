#!/usr/bin/env python3
"""Capture genuine Sandbox HTTP exchanges. No production hosts or app-token sales.
Use only after seller authorization. Credentials are environment variables, never CLI args.
"""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import uuid
import httpx

BASE = 'https://sandbox.api.pagseguro.com'
DROP = {'security_code', 'cvv', 'cvc', 'private_key', 'client_secret', 'x_client_secret',
        'authorization', 'access_token', 'refresh_token', 'state', 'token',
        'password', 'cookie', 'set_cookie', 'api_key', 'app_token', 'secret', 'client_assertion'}
PII = {'name', 'email', 'tax_id', 'phones', 'phone', 'address', 'holder', 'number', 'text'}
FREE_TEXT = {'description', 'message', 'error_description', 'details'}


def normalized_key(key):
    # Headers and OAuth responses can use hyphens or camelCase aliases.
    return re.sub(r'(?<=[a-z0-9])(?=[A-Z])', '_', key).lower().replace('-', '_')


def sanitize(value, *, parent=None):
    if isinstance(value, dict):
        return {k: ('[REDACTED]' if normalized_key(k) in PII | FREE_TEXT else sanitize(v, parent=normalized_key(k)))
                for k, v in value.items() if normalized_key(k) not in DROP and normalized_key(k) != 'card'
                and (normalized_key(k) != 'code' or parent in {'error_messages', 'payment_response'})}
    if isinstance(value, list):
        return [sanitize(v, parent=parent) for v in value]
    if isinstance(value, str):
        value = re.sub(r'(?i)([?&](?:token|code|state|access_token|client_secret)=)[^&\s]+', r'\1[REDACTED]', value)
        value = re.sub(r'(?i)\bBearer\s+[^\s,;]+', 'Bearer [REDACTED]', value)
        for key, secret in os.environ.items():
            if ('TOKEN' in key or 'SECRET' in key or key.endswith('_CODE')) and len(secret) >= 8:
                value = value.replace(secret, '[REDACTED]')
        value = re.sub(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', '[REDACTED_EMAIL]', value)
        if parent not in {'id', 'account_id', 'client_id', 'reference_id'}:
            value = re.sub(r'(?<!\d)\d{11,19}(?!\d)', '[REDACTED_NUMBER]', value)
            value = re.sub(r'(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)|(?<!\d)\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}(?!\d)', '[REDACTED_NUMBER]', value)
    return value


def capture(operation, method, path, token, payload, output, *, extra_headers=None):
    if not path.startswith(('/oauth2/application/', '/oauth2/token', '/orders')) or '..' in path:
        raise ValueError('Endpoint Sandbox inválido')
    headers = {'Authorization': f'Bearer {token}', **(extra_headers or {})}
    record = {'evidence_kind': 'genuine_sandbox_http', 'operation': operation, 'environment': 'sandbox',
              'timestamp_utc': dt.datetime.now(dt.timezone.utc).isoformat(), 'method': method,
              'endpoint': BASE + path, 'request': {'json': sanitize(payload), 'headers': {'Authorization': '[REDACTED]', **{k: ('[REDACTED]' if normalized_key(k) in DROP else sanitize(v)) for k, v in (extra_headers or {}).items()}}}}
    try:
        with httpx.Client(timeout=25, follow_redirects=False) as client:
            response = client.request(method, BASE + path, headers=headers, json=payload)
        try:
            body = response.json()
        except ValueError:
            body = {'non_json_response': '[OMITTED]'}
        record['response'] = {'http_status': response.status_code, 'json': sanitize(body),
                              'request_id': sanitize(response.headers.get('x-request-id', ''))}
        if operation == 'exchange_token' and response.is_success and isinstance(body, dict):
            record['token_fields_returned'] = {
                'has_access_token': bool(body.get('access_token')),
                'has_refresh_token': bool(body.get('refresh_token')),
                'token_type': body.get('token_type'),
                'expires_in': body.get('expires_in'),
                'account_id': body.get('account_id'),
            }
        record['result'] = 'success' if response.is_success else 'bank_rejected'
    except httpx.HTTPError as exc:
        record['result'] = 'transport_failure'
        record['error_type'] = type(exc).__name__
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('w', encoding='utf-8') as stream:
        json.dump(record, stream, ensure_ascii=False, indent=2)
    print(json.dumps({'file': str(output), 'result': record['result'],
                      'http_status': record.get('response', {}).get('http_status')}))
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['application', 'authorize', 'callback', 'token', 'create', 'get'])
    parser.add_argument('--output', required=True)
    parser.add_argument('--order-id')
    parser.add_argument('--request-file', help='Local private buyer payload, never add to Git')
    args = parser.parse_args()
    if args.operation == 'application':
        client_id = os.environ['PAGBANK_CLIENT_ID']
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', client_id):
            raise ValueError('client_id inválido')
        capture('consult_application', 'GET', '/oauth2/application/' + client_id,
                os.environ['PAGBANK_APP_TOKEN'], None, args.output)
    elif args.operation == 'authorize':
        client_id = os.environ['PAGBANK_CLIENT_ID']
        redirect_uri = os.environ.get('PAGBANK_OAUTH_REDIRECT_URI', 'https://sistema-gourmet-bistro-production.up.railway.app/payments/pagbank/oauth/callback')
        host = 'connect.sandbox.pagbank.com.br'
        endpoint = f'https://{host}/oauth2/authorize'
        scope = 'payments.read payments.create payments.refund accounts.read'
        state_val = os.environ.get('PAGBANK_OAUTH_STATE', '')
        record = {
            'evidence_kind': 'genuine_sandbox_oauth_initiation',
            'operation': 'initiate_authorization',
            'environment': 'sandbox',
            'timestamp_utc': dt.datetime.now(dt.timezone.utc).isoformat(),
            'method': 'GET',
            'endpoint': endpoint,
            'request': {
                'query_params': {
                    'response_type': 'code',
                    'client_id': client_id,
                    'redirect_uri': redirect_uri,
                    'scope': scope,
                    'state': f'[REDACTED_STATE:len={len(state_val)}]' if state_val else '[REDACTED_STATE]',
                }
            },
            'result': 'ready_for_seller_consent',
            'authorization_url_sanitized': f'{endpoint}?response_type=code&client_id={client_id}&redirect_uri={redirect_uri}&scope={scope.replace(" ", "+")}&state=[REDACTED]'
        }
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open('w', encoding='utf-8') as stream:
            json.dump(record, stream, ensure_ascii=False, indent=2)
        print(json.dumps({'file': str(output), 'result': record['result']}))
        return record
    elif args.operation == 'callback':
        code = os.environ.get('PAGBANK_AUTHORIZATION_CODE', '')
        error = os.environ.get('PAGBANK_OAUTH_ERROR', '')
        status_val = 'authorized' if not error and code else ('cancelled' if error else 'pending')
        record = {
            'evidence_kind': 'genuine_sandbox_oauth_callback',
            'operation': 'seller_authorization_callback',
            'environment': 'sandbox',
            'timestamp_utc': dt.datetime.now(dt.timezone.utc).isoformat(),
            'status': status_val,
            'callback': {
                'code_present': bool(code),
                'code': '[REDACTED_CODE]' if code else None,
                'error': error or None,
                'state': '[REDACTED_STATE]',
            },
            'result': 'consent_received' if status_val == 'authorized' else status_val
        }
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open('w', encoding='utf-8') as stream:
            json.dump(record, stream, ensure_ascii=False, indent=2)
        print(json.dumps({'file': str(output), 'result': record['result']}))
        return record
    elif args.operation == 'token':
        code = os.environ.get('PAGBANK_AUTHORIZATION_CODE', '')
        if not code:
            raise ValueError('PAGBANK_AUTHORIZATION_CODE é obrigatório no ambiente para exchange de token')
        payload = {
            'grant_type': 'authorization_code',
            'code': code,
            'redirect_uri': os.environ.get('PAGBANK_OAUTH_REDIRECT_URI', 'https://sistema-gourmet-bistro-production.up.railway.app/payments/pagbank/oauth/callback')
        }
        extra_headers = {
            'X_CLIENT_ID': os.environ['PAGBANK_CLIENT_ID'],
            'X_CLIENT_SECRET': os.environ['PAGBANK_CLIENT_SECRET'],
        }
        capture('exchange_token', 'POST', '/oauth2/token', os.environ['PAGBANK_APP_TOKEN'],
                payload, args.output, extra_headers=extra_headers)
    elif args.operation == 'create':
        payload = json.loads(Path(args.request_file).read_text())
        charges = payload.get('charges', [])
        if len(charges) != 1 or charges[0].get('payment_method', {}).get('type') != 'PIX':
            raise ValueError('Somente um Pix é permitido')
        if any(key in json.dumps(payload).lower() for key in ('splits', 'application_fee', 'security_code', 'card')):
            raise ValueError('Cartão/split não permitido')
        capture('create_pix_order', 'POST', '/orders', os.environ['PAGBANK_SANDBOX_SELLER_ACCESS_TOKEN'],
                payload, args.output, extra_headers={'x-idempotency-key': os.environ['PAGBANK_SANDBOX_IDEMPOTENCY_KEY']})
    else:
        if not re.fullmatch(r'ORDE_[A-Za-z0-9-]{1,64}', args.order_id or ''):
            raise ValueError('Use o ID real retornado pelo Sandbox')
        capture('get_pix_order', 'GET', '/orders/' + args.order_id,
                os.environ['PAGBANK_SANDBOX_SELLER_ACCESS_TOKEN'], None, args.output)


if __name__ == '__main__':
    main()

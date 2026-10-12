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
        'authorization', 'access_token', 'refresh_token', 'state', 'token'}
PII = {'name', 'email', 'tax_id', 'phones', 'phone', 'address', 'holder', 'number', 'text'}


def sanitize(value, *, parent=None):
    if isinstance(value, dict):
        return {k: ('[REDACTED]' if k.lower() in PII else sanitize(v, parent=k.lower()))
                for k, v in value.items() if k.lower() not in DROP and k.lower() != 'card'
                and (k.lower() != 'code' or parent in {'error_messages', 'payment_response'})}
    if isinstance(value, list):
        return [sanitize(v, parent=parent) for v in value]
    if isinstance(value, str):
        value = re.sub(r'(?i)([?&](?:token|code|state|access_token|client_secret)=)[^&\s]+', r'\1[REDACTED]', value)
        for key, secret in os.environ.items():
            if ('TOKEN' in key or 'SECRET' in key or key.endswith('_CODE')) and len(secret) >= 8:
                value = value.replace(secret, '[REDACTED]')
        value = re.sub(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', '[REDACTED_EMAIL]', value)
        if parent not in {'id', 'account_id', 'client_id', 'reference_id'}:
            value = re.sub(r'(?<!\d)\d{11,19}(?!\d)', '[REDACTED_NUMBER]', value)
    return value


def capture(operation, method, path, token, payload, output, *, extra_headers=None):
    if not path.startswith(('/oauth2/application/', '/oauth2/token', '/orders')) or '..' in path:
        raise ValueError('Endpoint Sandbox inválido')
    headers = {'Authorization': f'Bearer {token}', **(extra_headers or {})}
    record = {'evidence_kind': 'genuine_sandbox_http', 'operation': operation, 'environment': 'sandbox',
              'timestamp_utc': dt.datetime.now(dt.timezone.utc).isoformat(), 'method': method,
              'endpoint': BASE + path, 'request': {'json': sanitize(payload), 'headers': {'Authorization': '[REDACTED]', **{k: ('[REDACTED]' if k.lower() in DROP else sanitize(v)) for k, v in (extra_headers or {}).items()}}}}
    try:
        with httpx.Client(timeout=25, follow_redirects=False) as client:
            response = client.request(method, BASE + path, headers=headers, json=payload)
        try:
            body = response.json()
        except ValueError:
            body = {'non_json_response': '[OMITTED]'}
        record['response'] = {'http_status': response.status_code, 'json': sanitize(body),
                              'request_id': sanitize(response.headers.get('x-request-id', ''))}
        record['result'] = 'success' if response.is_success else 'bank_rejected'
    except httpx.HTTPError as exc:
        record['result'] = 'transport_failure'
        record['error_type'] = type(exc).__name__
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x', encoding='utf-8') as stream:
        json.dump(record, stream, ensure_ascii=False, indent=2)
    print(json.dumps({'file': str(output), 'result': record['result'],
                      'http_status': record.get('response', {}).get('http_status')}))
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['application', 'create', 'get'])
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

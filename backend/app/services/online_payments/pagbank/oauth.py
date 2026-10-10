from __future__ import annotations

import base64
import hmac
import os
import secrets
import time
from urllib.parse import urlencode

import httpx

from ....config import settings
from ..oauth import MercadoPagoOAuthTokens


class PagBankOAuthError(RuntimeError):
    pass


def env(name: str) -> str:
    return os.getenv(name, '').strip()


def api_url() -> str:
    environment = env('PAGBANK_ENV') or 'sandbox'
    if environment not in {'sandbox', 'production'}:
        raise PagBankOAuthError('PAGBANK_ENV inválido.')
    return 'https://api.pagseguro.com' if environment == 'production' else 'https://sandbox.api.pagseguro.com'


def redirect_uri() -> str:
    uri = env('PAGBANK_OAUTH_REDIRECT_URI') or f'{settings.KOMA_PUBLIC_API_URL}/payments/pagbank/oauth/callback'
    if not uri.startswith('https://'):
        raise PagBankOAuthError('Configure a URL HTTPS de retorno do PagBank.')
    return uri


def configured() -> bool:
    return all(env(k) for k in ('PAGBANK_CLIENT_ID', 'PAGBANK_CLIENT_SECRET', 'PAGBANK_APP_TOKEN'))


def authorization(restaurant_id: int, user_id: str) -> tuple[str, str]:
    if not configured():
        raise PagBankOAuthError('A conexão PagBank ainda está sendo preparada pela KÔMA.')
    # Domain-separated MAC; compact state respects PagBank's 128 character limit.
    data = f'{int(restaurant_id)}:{user_id}:{int(time.time())}:{secrets.token_hex(8)}'.encode()
    mac = hmac.digest(settings.SECRET_KEY.encode(), b'pagbank-connect:' + api_url().encode() + b':' + data, 'sha256')[:16]
    state = base64.urlsafe_b64encode(data + mac).decode().rstrip('=')
    if len(state) > 128:
        raise PagBankOAuthError('Identificador OAuth excede o limite do PagBank.')
    host = 'connect.pagbank.com.br' if api_url() == 'https://api.pagseguro.com' else 'connect.sandbox.pagbank.com.br'
    query = urlencode(dict(response_type='code', client_id=env('PAGBANK_CLIENT_ID'), redirect_uri=redirect_uri(),
                          scope='payments.read payments.create payments.refund accounts.read', state=state))
    return f'https://{host}/oauth2/authorize?{query}', state


def decode_state(state: str, cookie: str) -> tuple[int, str]:
    try:
        if not state or not cookie or not hmac.compare_digest(state, cookie):
            raise ValueError()
        raw = base64.urlsafe_b64decode(state + '=' * (-len(state) % 4))
        data, mac = raw[:-16], raw[-16:]
        expected = hmac.digest(settings.SECRET_KEY.encode(), b'pagbank-connect:' + api_url().encode() + b':' + data, 'sha256')[:16]
        if not hmac.compare_digest(mac, expected):
            raise ValueError()
        rid, uid, issued, nonce = data.decode().split(':')
        if int(rid) <= 0 or not uid or not nonce or not -60 <= time.time() - int(issued) <= 600:
            raise ValueError()
        return int(rid), uid
    except (ValueError, TypeError, UnicodeError) as exc:
        raise PagBankOAuthError('Autorização inválida ou expirada. Inicie a conexão novamente.') from exc


def _post(path: str, payload: dict, *, client=None) -> dict:
    if not configured():
        raise PagBankOAuthError('A conexão PagBank ainda está sendo preparada pela KÔMA.')
    owned = client is None
    client = client or httpx.Client(timeout=settings.ONLINE_PAYMENT_REQUEST_TIMEOUT_SECONDS)
    try:
        response = client.post(api_url() + path, headers={
            'Authorization': f"Bearer {env('PAGBANK_APP_TOKEN')}",
            'X_CLIENT_ID': env('PAGBANK_CLIENT_ID'), 'X_CLIENT_SECRET': env('PAGBANK_CLIENT_SECRET'),
        }, json=payload)
        if response.is_error:
            raise PagBankOAuthError(f'PagBank recusou a autorização (HTTP {response.status_code}).')
        return response.json() if response.content else {}
    except (httpx.HTTPError, ValueError) as exc:
        raise PagBankOAuthError('Não foi possível comunicar com a autorização PagBank.') from exc
    finally:
        if owned:
            client.close()


def _tokens(data: dict) -> MercadoPagoOAuthTokens:
    if not data.get('access_token') or not data.get('account_id'):
        raise PagBankOAuthError('PagBank retornou credenciais incompletas.')
    return MercadoPagoOAuthTokens(access_token=data['access_token'], refresh_token=data.get('refresh_token'),
                                 provider_user_id=data['account_id'], public_key=None, expires_in=int(data.get('expires_in') or 0))


def exchange(code: str) -> MercadoPagoOAuthTokens:
    return _tokens(_post('/oauth2/token', dict(grant_type='authorization_code', code=code, redirect_uri=redirect_uri())))


def refresh_access_token(token: str) -> MercadoPagoOAuthTokens:
    return _tokens(_post('/oauth2/refresh', dict(grant_type='refresh_token', refresh_token=token)))


def revoke(token: str) -> None:
    _post('/oauth2/revoke', dict(token_type_hint='access_token', token=token))

from __future__ import annotations

import base64
import hmac
import os
import secrets
import time
from urllib.parse import urlencode

import httpx

from ....config import settings, OFFICIAL_PUBLIC_FRONTEND_ORIGINS
from ..oauth import MercadoPagoOAuthTokens


class PagBankOAuthError(RuntimeError):
    pass


def env(name: str) -> str:
    return os.getenv(name, '').strip()


def environment_for_restaurant(restaurant_id: int) -> str:
    # Opt-in is server-owned; tenants cannot select credentials or API hosts.
    allowed = {value.strip() for value in env('PAGBANK_PRODUCTION_RESTAURANT_IDS').split(',') if value.strip()}
    return 'production' if str(int(restaurant_id)) in allowed else default_environment()


def default_environment() -> str:
    value = env('PAGBANK_ENV') or 'sandbox'
    if value not in {'sandbox', 'production'}:
        raise PagBankOAuthError('PAGBANK_ENV inválido.')
    return value


def api_url(environment: str | None = None) -> str:
    value = environment or default_environment()
    if value not in {'sandbox', 'production'}:
        raise PagBankOAuthError('Ambiente PagBank inválido.')
    return 'https://api.pagseguro.com' if value == 'production' else 'https://sandbox.api.pagseguro.com'


def credential(name: str, environment: str | None = None) -> str:
    value = environment or default_environment()
    api_url(value)
    # A production pilot never falls back to Sandbox application credentials.
    prefix = 'PAGBANK_PRODUCTION_' if value == 'production' and default_environment() != 'production' else 'PAGBANK_'
    return env(prefix + name)


def redirect_uri(environment: str | None = None) -> str:
    uri = credential('OAUTH_REDIRECT_URI', environment) or env('PAGBANK_OAUTH_REDIRECT_URI') or f'{settings.KOMA_PUBLIC_API_URL}/payments/pagbank/oauth/callback'
    if not uri.startswith('https://'):
        raise PagBankOAuthError('Configure a URL HTTPS de retorno do PagBank.')
    return uri


def configured(environment: str | None = None) -> bool:
    return all(credential(k, environment) for k in ('CLIENT_ID', 'CLIENT_SECRET', 'APP_TOKEN'))


def _return_origins() -> dict[str, str]:
    # Short signed identifiers keep state within Connect's 128-character limit.
    return {**{str(i): value for i, value in enumerate(OFFICIAL_PUBLIC_FRONTEND_ORIGINS)}, 'c': settings.KOMA_PUBLIC_APP_URL}


def return_origin_for_state(state: str) -> str:
    decode_state(state, state)
    raw = base64.urlsafe_b64decode(state + '=' * (-len(state) % 4))
    parts = raw[:-16].decode().split(':')
    return _return_origins().get(parts[4], settings.KOMA_PUBLIC_APP_URL) if len(parts) == 5 else settings.KOMA_PUBLIC_APP_URL


def authorization(restaurant_id: int, user_id: str, *, return_origin: str | None = None) -> tuple[str, str]:
    environment = environment_for_restaurant(restaurant_id)
    if not configured(environment):
        raise PagBankOAuthError('A conexão PagBank ainda está sendo preparada pela KÔMA.')
    # Domain-separated MAC; compact state respects PagBank's 128 character limit.
    origin = return_origin or settings.KOMA_PUBLIC_APP_URL
    origin_key = next((key for key, value in _return_origins().items() if value == origin), None)
    if origin_key is None:
        raise PagBankOAuthError('Endereço de retorno PagBank não autorizado.')
    data = f'{int(restaurant_id)}:{user_id}:{int(time.time())}:{secrets.token_hex(8)}:{origin_key}'.encode()
    mac = hmac.digest(settings.SECRET_KEY.encode(), b'pagbank-connect:' + api_url(environment).encode() + b':' + data, 'sha256')[:16]
    state = base64.urlsafe_b64encode(data + mac).decode().rstrip('=')
    if len(state) > 128:
        raise PagBankOAuthError('Identificador OAuth excede o limite do PagBank.')
    host = 'connect.pagbank.com.br' if environment == 'production' else 'connect.sandbox.pagbank.com.br'
    query = urlencode(dict(response_type='code', client_id=credential('CLIENT_ID', environment), redirect_uri=redirect_uri(environment),
                          scope='payments.read payments.create payments.refund accounts.read', state=state))
    return f'https://{host}/oauth2/authorize?{query}', state


def decode_state(state: str, cookie: str) -> tuple[int, str]:
    try:
        if not state or not cookie or not hmac.compare_digest(state, cookie):
            raise ValueError()
        raw = base64.urlsafe_b64decode(state + '=' * (-len(state) % 4))
        data, mac = raw[:-16], raw[-16:]
        parts = data.decode().split(':')
        if len(parts) not in (4, 5) or (len(parts) == 5 and parts[4] not in _return_origins()):
            raise ValueError()
        rid, uid, issued, nonce = parts[:4]
        environment = environment_for_restaurant(int(rid))
        expected = hmac.digest(settings.SECRET_KEY.encode(), b'pagbank-connect:' + api_url(environment).encode() + b':' + data, 'sha256')[:16]
        if not hmac.compare_digest(mac, expected):
            raise ValueError()
        if int(rid) <= 0 or not uid or not nonce or not -60 <= time.time() - int(issued) <= 600:
            raise ValueError()
        return int(rid), uid
    except (ValueError, TypeError, UnicodeError) as exc:
        raise PagBankOAuthError('Autorização inválida ou expirada. Inicie a conexão novamente.') from exc


def _post(path: str, payload: dict, *, client=None, environment: str | None = None) -> dict:
    if not configured(environment):
        raise PagBankOAuthError('A conexão PagBank ainda está sendo preparada pela KÔMA.')
    owned = client is None
    client = client or httpx.Client(timeout=settings.ONLINE_PAYMENT_REQUEST_TIMEOUT_SECONDS)
    try:
        response = client.post(api_url(environment) + path, headers={
            'Authorization': f"Bearer {credential('APP_TOKEN', environment)}",
            'X_CLIENT_ID': credential('CLIENT_ID', environment), 'X_CLIENT_SECRET': credential('CLIENT_SECRET', environment),
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


def exchange(code: str, *, environment: str | None = None) -> MercadoPagoOAuthTokens:
    return _tokens(_post('/oauth2/token', dict(grant_type='authorization_code', code=code, redirect_uri=redirect_uri(environment)), environment=environment))


def refresh_access_token(token: str, *, environment: str | None = None) -> MercadoPagoOAuthTokens:
    return _tokens(_post('/oauth2/refresh', dict(grant_type='refresh_token', refresh_token=token), environment=environment))


def revoke(token: str, *, environment: str | None = None) -> None:
    _post('/oauth2/revoke', dict(token_type_hint='access_token', token=token), environment=environment)

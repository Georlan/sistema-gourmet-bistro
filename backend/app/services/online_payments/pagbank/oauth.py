from __future__ import annotations

import base64
import datetime
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import time
from urllib.parse import urlencode

import httpx

from ....config import settings, OFFICIAL_PUBLIC_FRONTEND_ORIGINS
from ..oauth import MercadoPagoOAuthTokens


class PagBankOAuthError(RuntimeError):
    def __init__(self, message: str, *, reason: str = 'unknown') -> None:
        super().__init__(message)
        self.reason = reason


logger = logging.getLogger('koma.pagbank')
OAUTH_SCOPES = 'payments.read payments.create payments.refund accounts.read'


def log_sandbox_oauth_evidence(
    stage: str, *, restaurant_id: int, state: str, http_status: int | None = None,
    token_response: dict | None = None, request_id: str | None = None,
    code_present: bool | None = None, error_present: bool | None = None,
) -> None:
    """Emit strictly allowlisted metadata from the actual QA OAuth flow.

    Never log the authorization code, state, tokens, seller identifiers, headers,
    free-form PagBank response bodies, or a full authorization URL. Railway logs
    are not a substitute for the bank's response: HTTP status is captured live.
    """
    allowed = {s.strip() for s in env('PAGBANK_SANDBOX_OAUTH_EVIDENCE_RESTAURANT_IDS').split(',') if s.strip()}
    rid = str(int(restaurant_id))
    if rid not in allowed or environment_for_restaurant(int(rid)) != 'sandbox':
        return
    if stage not in {'authorization_url_issued', 'callback_received', 'token_exchange', 'connection_completed', 'connection_rejected_owner', 'connection_evidence_only'}:
        raise ValueError('Etapa de evidência OAuth desconhecida.')
    flow_id = hmac.new(settings.SECRET_KEY.encode(), b'pagbank-evidence:' + state.encode(), hashlib.sha256).hexdigest()[:20]
    event = {
        'evidence_kind': 'koma_real_sandbox_oauth_flow',
        'stage': stage,
        'timestamp_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'restaurant_id': int(rid),
        'environment': 'sandbox',
        'flow_id': flow_id,
    }
    if stage == 'authorization_url_issued':
        event.update({
            'method': 'GET',
            'endpoint': 'https://connect.sandbox.pagbank.com.br/oauth2/authorize',
            'response_type': 'code',
            'scope': OAUTH_SCOPES,
            'redirect_uri': redirect_uri('sandbox'),
            'result': 'authorization_url_issued_by_koma',
        })
    elif stage == 'callback_received':
        event.update({'code_present': bool(code_present), 'error_present': bool(error_present),
                      'result': 'callback_received_by_koma'})
    elif stage == 'token_exchange':
        body = token_response if isinstance(token_response, dict) else {}
        event.update({
            'method': 'POST',
            'endpoint': 'https://sandbox.api.pagseguro.com/oauth2/token',
            'grant_type': 'authorization_code',
            'redirect_uri': redirect_uri('sandbox'),
            'http_status': http_status,
            'result': ('transport_failure' if http_status is None else
                       'http_success' if 200 <= http_status < 300 else 'bank_rejected'),
            'has_access_token': bool(body.get('access_token')),
            'has_refresh_token': bool(body.get('refresh_token')),
            'has_account_id': bool(body.get('account_id')),
            'expires_in': body.get('expires_in') if isinstance(body.get('expires_in'), int) else None,
        })
        if request_id and re.fullmatch(r'[A-Za-z0-9_-]{1,128}', request_id):
            event['pagbank_request_id'] = request_id
    else:
        event['result'] = stage
    # WARNING intentionally: the scoped, redacted QA evidence must be retained
    # even when application INFO-level logs are disabled in the runtime.
    logger.warning('PAGBANK_OAUTH_EVIDENCE %s', json.dumps(event, sort_keys=True))


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


def qa9_sandbox_evidence_only(restaurant_id: int) -> bool:
    """Explicitly opt into a *read-only OAuth evidence* run for QA tenant 9.

    The application owner's token may be exchanged once and inspected through
    sanitized evidence, but must never become a restaurant payment receiver.
    No environment variable can enable this for another tenant or production.
    """
    return (
        int(restaurant_id) == 9
        and environment_for_restaurant(9) == 'sandbox'
        and env('PAGBANK_SANDBOX_QA9_OAUTH_EVIDENCE_ONLY') == 'true'
        and '9' in {value.strip() for value in
                    env('PAGBANK_SANDBOX_OAUTH_EVIDENCE_RESTAURANT_IDS').split(',')}
    )


def is_application_owner(account_id: str | None, *, environment: str) -> bool:
    # Configure only with account_id verified through GET /oauth2/application/{client_id}.
    # Never infer ownership from token strings, buyer documents or display names.
    owner = credential('APPLICATION_OWNER_ACCOUNT_ID', environment)
    return bool(owner and account_id and hmac.compare_digest(owner, str(account_id)))


def owner_receiver_pilot_enabled(restaurant_id: int, *, environment: str) -> bool:
    """Opt-in exclusively for restaurant 8 in production, never for other tenants/Sandbox.

    This does NOT supply a seller token. The PagBank seller must independently
    authorize Connect and the account must stay bound to the same restaurant.
    """
    return (
        int(restaurant_id) == 8
        and environment == 'production'
        and environment_for_restaurant(8) == 'production'
        and env('PAGBANK_PRODUCTION_OWNER_RECEIVER_PILOT8') == 'true'
    )


def owner_receiver_blocked(restaurant_id: int, account_id: str | None, *, environment: str) -> bool:
    return is_application_owner(account_id, environment=environment) and not owner_receiver_pilot_enabled(
        restaurant_id, environment=environment,
    )


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
                          scope=OAUTH_SCOPES, state=state))
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


_SAFE_CONNECT_ERROR_CODES = frozenset({
    '41001', '41002', '41003', '41004', '41005', '41006', '41007',
    '41008', '41012', '41013', '41014', '41015', '41016',
    'invalid_request', 'invalid_redirect_uri', 'invalid_client',
    'invalid_grant', 'unsupported_grant_type', 'unauthorized_client',
    'invalid_token', 'token_is_no_longer_active',
})


def _safe_connect_failure_reason(response: httpx.Response) -> str:
    """Only return documented, allowlisted error codes; never log bank response text."""
    try:
        data = response.json()
    except (ValueError, TypeError):
        return 'unknown'
    if not isinstance(data, dict):
        return 'unknown'
    candidates = [data.get('error'), data.get('error_code'), data.get('code')]
    errors = data.get('errors')
    if isinstance(errors, list):
        candidates.extend(item.get('code') for item in errors[:3] if isinstance(item, dict))
    for candidate in candidates:
        if isinstance(candidate, (str, int)):
            safe_code = str(candidate).strip().lower()
            if safe_code in _SAFE_CONNECT_ERROR_CODES:
                return safe_code
    return 'unknown'


def _post(path: str, payload: dict, *, client=None, environment: str | None = None,
          evidence_restaurant_id: int | None = None, evidence_state: str | None = None) -> dict:
    if not configured(environment):
        raise PagBankOAuthError('A conexão PagBank ainda está sendo preparada pela KÔMA.')
    owned = client is None
    client = client or httpx.Client(timeout=settings.ONLINE_PAYMENT_REQUEST_TIMEOUT_SECONDS)
    capture = path == '/oauth2/token' and evidence_restaurant_id is not None and evidence_state is not None
    try:
        response = client.post(api_url(environment) + path, headers={
            'Authorization': f"Bearer {credential('APP_TOKEN', environment)}",
            'X_CLIENT_ID': credential('CLIENT_ID', environment), 'X_CLIENT_SECRET': credential('CLIENT_SECRET', environment),
        }, json=payload)
        if response.is_error:
            if capture:
                log_sandbox_oauth_evidence('token_exchange', restaurant_id=evidence_restaurant_id,
                    state=evidence_state, http_status=response.status_code,
                    request_id=response.headers.get('x-request-id'))
            reason = _safe_connect_failure_reason(response)
            logger.warning(
                'PagBank Connect request rejected endpoint=%s environment=%s http_status=%s error_code=%s',
                path, environment or default_environment(), response.status_code, reason,
            )
            raise PagBankOAuthError(
                f'PagBank recusou a autorização (HTTP {response.status_code}).',
                reason=reason,
            )
        data = response.json() if response.content else {}
        if capture:
            log_sandbox_oauth_evidence('token_exchange', restaurant_id=evidence_restaurant_id,
                state=evidence_state, http_status=response.status_code, token_response=data,
                request_id=response.headers.get('x-request-id'))
        return data
    except (httpx.HTTPError, ValueError) as exc:
        if capture:
            log_sandbox_oauth_evidence('token_exchange', restaurant_id=evidence_restaurant_id,
                state=evidence_state)
        raise PagBankOAuthError('Não foi possível comunicar com a autorização PagBank.') from exc
    finally:
        if owned:
            client.close()


def _tokens(data: dict) -> MercadoPagoOAuthTokens:
    if not data.get('access_token') or not data.get('account_id'):
        logger.warning(
            'PagBank Connect incomplete token response access_token_present=%s account_id_present=%s',
            bool(data.get('access_token')), bool(data.get('account_id')),
        )
        raise PagBankOAuthError(
            'PagBank retornou credenciais incompletas.', reason='incomplete_response',
        )
    return MercadoPagoOAuthTokens(access_token=data['access_token'], refresh_token=data.get('refresh_token'),
                                 provider_user_id=data['account_id'], public_key=None, expires_in=int(data.get('expires_in') or 0))


def exchange(code: str, *, environment: str | None = None,
             evidence_restaurant_id: int | None = None, evidence_state: str | None = None) -> MercadoPagoOAuthTokens:
    return _tokens(_post('/oauth2/token',
        dict(grant_type='authorization_code', code=code, redirect_uri=redirect_uri(environment)),
        environment=environment, evidence_restaurant_id=evidence_restaurant_id, evidence_state=evidence_state))


def refresh_access_token(token: str, *, environment: str | None = None) -> MercadoPagoOAuthTokens:
    return _tokens(_post('/oauth2/refresh', dict(grant_type='refresh_token', refresh_token=token), environment=environment))


def revoke(token: str, *, environment: str | None = None) -> None:
    _post('/oauth2/revoke', dict(token_type_hint='access_token', token=token), environment=environment)

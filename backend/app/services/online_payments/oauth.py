from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx

from ...config import settings
from ...crypt import decrypt_field, encrypt_field


MERCADO_PAGO_AUTHORIZATION_URL = "https://auth.mercadopago.com/authorization"
MERCADO_PAGO_TOKEN_URL = "https://api.mercadopago.com/oauth/token"
DEFAULT_STATE_TTL_SECONDS = 600


class MercadoPagoOAuthConfigurationError(RuntimeError):
    """Raised when marketplace OAuth credentials are not configured."""


class MercadoPagoOAuthStateError(ValueError):
    """Raised when an OAuth state is invalid, expired or was tampered with."""


class MercadoPagoOAuthError(RuntimeError):
    """Raised when Mercado Pago rejects an OAuth token operation."""


@dataclass(frozen=True)
class MercadoPagoOAuthState:
    restaurant_id: int
    user_id: str
    code_verifier: str
    issued_at: int


@dataclass(frozen=True)
class MercadoPagoOAuthTokens:
    access_token: str
    refresh_token: str | None
    public_key: str | None
    provider_user_id: str
    expires_in: int | None


def _env(name: str) -> str:
    return os.getenv(name, "").strip()


def _client_id() -> str:
    value = _env("MERCADO_PAGO_CLIENT_ID")
    if not value:
        raise MercadoPagoOAuthConfigurationError(
            "MERCADO_PAGO_CLIENT_ID não configurado."
        )
    return value


def _client_secret() -> str:
    value = _env("MERCADO_PAGO_CLIENT_SECRET")
    if not value:
        raise MercadoPagoOAuthConfigurationError(
            "MERCADO_PAGO_CLIENT_SECRET não configurado."
        )
    return value


def oauth_redirect_uri() -> str:
    explicit = _env("MERCADO_PAGO_OAUTH_REDIRECT_URI")
    if explicit:
        return explicit.rstrip("/")
    if settings.KOMA_PUBLIC_API_URL:
        return (
            f"{settings.KOMA_PUBLIC_API_URL}"
            "/payments/mercado-pago/oauth/callback"
        )
    raise MercadoPagoOAuthConfigurationError(
        "Configure MERCADO_PAGO_OAUTH_REDIRECT_URI ou KOMA_PUBLIC_API_URL."
    )


def _state_ttl_seconds() -> int:
    raw = _env("MERCADO_PAGO_OAUTH_STATE_TTL_SECONDS")
    if not raw:
        return DEFAULT_STATE_TTL_SECONDS
    try:
        value = int(raw)
    except ValueError as exc:
        raise MercadoPagoOAuthConfigurationError(
            "MERCADO_PAGO_OAUTH_STATE_TTL_SECONDS inválido."
        ) from exc
    return max(120, min(value, 900))


def _generate_code_verifier() -> str:
    # token_urlsafe uses only RFC 3986 unreserved URL-safe characters.
    # 64 random bytes produce an 86-character verifier, inside PKCE's 43–128 range.
    return secrets.token_urlsafe(64)


def _code_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _encode_state(*, restaurant_id: int, user_id: str, verifier: str) -> str:
    payload = {
        "v": 1,
        "rid": int(restaurant_id),
        "uid": str(user_id),
        "verifier": verifier,
        "iat": int(time.time()),
        "nonce": secrets.token_urlsafe(24),
    }
    # The verifier must not travel in plaintext. The existing Fernet layer gives
    # confidentiality and authenticated integrity while keeping the flow stateless.
    return encrypt_field(json.dumps(payload, separators=(",", ":")))


def decode_state(state: str, *, now: int | None = None) -> MercadoPagoOAuthState:
    if not state or not isinstance(state, str):
        raise MercadoPagoOAuthStateError("Estado OAuth ausente.")

    try:
        plain = decrypt_field(state)
        if plain == state and state.startswith("gAAAAA"):
            raise ValueError("encrypted state could not be decrypted")
        payload = json.loads(plain)
        restaurant_id = int(payload["rid"])
        user_id = str(payload["uid"])
        verifier = str(payload["verifier"])
        issued_at = int(payload["iat"])
        version = int(payload["v"])
        nonce = str(payload["nonce"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise MercadoPagoOAuthStateError("Estado OAuth inválido.") from exc

    current = int(time.time()) if now is None else int(now)
    age = current - issued_at
    if version != 1 or restaurant_id <= 0 or not user_id or not nonce:
        raise MercadoPagoOAuthStateError("Estado OAuth inválido.")
    if not 43 <= len(verifier) <= 128:
        raise MercadoPagoOAuthStateError("Estado OAuth inválido.")
    if age < -60 or age > _state_ttl_seconds():
        raise MercadoPagoOAuthStateError("Estado OAuth expirado.")

    return MercadoPagoOAuthState(
        restaurant_id=restaurant_id,
        user_id=user_id,
        code_verifier=verifier,
        issued_at=issued_at,
    )


def build_authorization_url(*, restaurant_id: int, user_id: str) -> str:
    if int(restaurant_id) <= 0:
        raise ValueError("restaurant_id inválido")
    if not str(user_id).strip():
        raise ValueError("user_id inválido")

    verifier = _generate_code_verifier()
    state = _encode_state(
        restaurant_id=int(restaurant_id),
        user_id=str(user_id),
        verifier=verifier,
    )
    query = urlencode(
        {
            "response_type": "code",
            "client_id": _client_id(),
            "platform_id": "mp",
            "redirect_uri": oauth_redirect_uri(),
            "state": state,
            "code_challenge": _code_challenge(verifier),
            "code_challenge_method": "S256",
        }
    )
    return f"{MERCADO_PAGO_AUTHORIZATION_URL}?{query}"


def _parse_tokens(payload: Any) -> MercadoPagoOAuthTokens:
    if not isinstance(payload, dict):
        raise MercadoPagoOAuthError("Resposta OAuth inválida do Mercado Pago.")

    access_token = payload.get("access_token")
    provider_user_id = payload.get("user_id")
    if not isinstance(access_token, str) or not access_token:
        raise MercadoPagoOAuthError("Mercado Pago não retornou access_token.")
    if provider_user_id is None or str(provider_user_id).strip() == "":
        raise MercadoPagoOAuthError("Mercado Pago não retornou user_id.")

    refresh_token = payload.get("refresh_token")
    public_key = payload.get("public_key")
    expires_in = payload.get("expires_in")
    try:
        normalized_expires = int(expires_in) if expires_in is not None else None
    except (TypeError, ValueError):
        normalized_expires = None

    return MercadoPagoOAuthTokens(
        access_token=access_token,
        refresh_token=refresh_token if isinstance(refresh_token, str) and refresh_token else None,
        public_key=public_key if isinstance(public_key, str) and public_key else None,
        provider_user_id=str(provider_user_id),
        expires_in=normalized_expires,
    )


def _post_token(payload: dict[str, Any], *, client: httpx.Client | None = None) -> MercadoPagoOAuthTokens:
    owned_client = client is None
    http_client = client or httpx.Client(
        timeout=settings.ONLINE_PAYMENT_REQUEST_TIMEOUT_SECONDS
    )
    try:
        response = http_client.post(
            MERCADO_PAGO_TOKEN_URL,
            headers={"Content-Type": "application/json"},
            json=payload,
        )
        if response.status_code >= 400:
            # Do not include provider bodies here: they may contain sensitive data.
            raise MercadoPagoOAuthError(
                f"Mercado Pago recusou OAuth (HTTP {response.status_code})."
            )
        try:
            data = response.json()
        except ValueError as exc:
            raise MercadoPagoOAuthError(
                "Mercado Pago retornou resposta OAuth inválida."
            ) from exc
        return _parse_tokens(data)
    except httpx.HTTPError as exc:
        raise MercadoPagoOAuthError(
            "Falha de comunicação com OAuth do Mercado Pago."
        ) from exc
    finally:
        if owned_client:
            http_client.close()


def exchange_authorization_code(
    *,
    code: str,
    state: str,
    client: httpx.Client | None = None,
) -> tuple[MercadoPagoOAuthState, MercadoPagoOAuthTokens]:
    if not code or not isinstance(code, str):
        raise MercadoPagoOAuthError("Código OAuth ausente.")

    decoded = decode_state(state)
    tokens = _post_token(
        {
            "client_id": _client_id(),
            "client_secret": _client_secret(),
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": oauth_redirect_uri(),
            "code_verifier": decoded.code_verifier,
        },
        client=client,
    )
    return decoded, tokens


def refresh_access_token(
    refresh_token: str,
    *,
    client: httpx.Client | None = None,
) -> MercadoPagoOAuthTokens:
    if not refresh_token or not isinstance(refresh_token, str):
        raise MercadoPagoOAuthError("Refresh token OAuth ausente.")
    return _post_token(
        {
            "client_id": _client_id(),
            "client_secret": _client_secret(),
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        },
        client=client,
    )

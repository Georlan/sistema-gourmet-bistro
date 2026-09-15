from __future__ import annotations

import os
import re
import threading
import time
from typing import Any

import httpx

from ..config import settings
from .saas_mercadopago import SaasMercadoPagoError, SaasMercadoPagoService


_TOKEN_URL = "https://api.mercadopago.com/oauth/token"
_CACHE_LOCK = threading.Lock()
_CACHED_ACCESS_TOKEN = ""
_CACHED_EXPIRES_AT = 0.0


class SaasMercadoPagoRuntimeAuthError(SaasMercadoPagoError):
    """Falha de autenticação com código operacional seguro para logs/diagnóstico."""

    def __init__(self, message: str, *, reason: str, status_code: int | None = None):
        super().__init__(message, status_code=status_code)
        self.reason = reason


def _auth_error(message: str, *, reason: str, status_code: int) -> SaasMercadoPagoRuntimeAuthError:
    return SaasMercadoPagoRuntimeAuthError(message, reason=reason, status_code=status_code)


def _flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def runtime_token_enabled() -> bool:
    return _flag("KOMA_SAAS_MP_RUNTIME_TOKEN_ENABLED")


def _configured_credentials() -> tuple[str, str, str]:
    client_id = os.getenv("MERCADO_PAGO_CLIENT_ID", "").strip()
    client_secret = os.getenv("MERCADO_PAGO_CLIENT_SECRET", "").strip()
    configured_public_key = settings.KOMA_SAAS_MERCADO_PAGO_PUBLIC_KEY.strip()

    if not client_id or not client_secret:
        raise _auth_error(
            "Credenciais Client ID/Client Secret do Mercado Pago não estão configuradas para renovar o token SaaS.",
            reason="missing_client_credentials",
            status_code=503,
        )
    if not configured_public_key:
        raise _auth_error(
            "A Public Key da aplicação SaaS Mercado Pago não está configurada.",
            reason="missing_public_key",
            status_code=503,
        )
    return client_id, client_secret, configured_public_key


def _safe_provider_error_code(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return "oauth_rejected"
    if not isinstance(payload, dict):
        return "oauth_rejected"
    raw = str(payload.get("error") or "").strip().lower()
    if raw in {
        "invalid_client",
        "invalid_grant",
        "invalid_request",
        "invalid_scope",
        "unauthorized_client",
        "forbidden",
    }:
        return f"oauth_{raw}"
    return "oauth_rejected"


def _mint_client_credentials_token(
    *,
    client_id: str,
    client_secret: str,
) -> dict[str, Any]:
    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.post(
                _TOKEN_URL,
                headers={"Content-Type": "application/json"},
                json={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "grant_type": "client_credentials",
                },
            )
    except httpx.RequestError as exc:
        raise _auth_error(
            "Falha de comunicação ao renovar a credencial SaaS do Mercado Pago.",
            reason="oauth_transport_error",
            status_code=502,
        ) from exc

    if response.status_code >= 400:
        raise _auth_error(
            f"Mercado Pago recusou a renovação da credencial SaaS (HTTP {response.status_code}).",
            reason=_safe_provider_error_code(response),
            status_code=502,
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise _auth_error(
            "Mercado Pago retornou uma resposta inválida ao renovar a credencial SaaS.",
            reason="oauth_invalid_response",
            status_code=502,
        ) from exc
    if not isinstance(payload, dict):
        raise _auth_error(
            "Mercado Pago retornou uma resposta inválida ao renovar a credencial SaaS.",
            reason="oauth_invalid_response",
            status_code=502,
        )
    return payload


def _token_embedded_client_id(access_token: str) -> str:
    match = re.match(r"^APP_USR-([0-9]+)-", access_token)
    return match.group(1) if match else ""


def _validate_oauth_identity(
    payload: dict[str, Any],
    *,
    client_id: str,
    configured_public_key: str,
) -> tuple[str, int]:
    access_token = str(payload.get("access_token") or "").strip()
    provider_user_id = str(payload.get("user_id") or "").strip()
    returned_public_key = str(payload.get("public_key") or "").strip()
    live_mode = payload.get("live_mode")

    if not access_token:
        raise _auth_error(
            "Mercado Pago não retornou um Access Token para a cobrança SaaS.",
            reason="missing_access_token",
            status_code=502,
        )
    if access_token.startswith("TEST-") or live_mode is False:
        raise _auth_error(
            "Mercado Pago retornou uma credencial de teste para o ambiente de produção.",
            reason="test_credential",
            status_code=409,
        )
    if not access_token.startswith("APP_USR-"):
        raise _auth_error(
            "Mercado Pago retornou um formato de credencial inesperado para produção.",
            reason="unexpected_token_type",
            status_code=409,
        )
    if not provider_user_id:
        raise _auth_error(
            "Mercado Pago não informou a conta vinculada à credencial renovada.",
            reason="missing_provider_user",
            status_code=502,
        )

    # O endpoint OAuth client_credentials nem sempre devolve `public_key`.
    # Quando ela vier, usamos como vínculo adicional. Quando não vier, a
    # identidade continua sendo provada pelo par Client ID/Secret que emitiu o
    # token e pelo Client ID embutido no token APP_USR.
    if returned_public_key and returned_public_key != configured_public_key:
        raise _auth_error(
            "A credencial renovada pertence a uma aplicação Mercado Pago diferente da aplicação KÔMA configurada.",
            reason="public_key_mismatch",
            status_code=409,
        )

    embedded_client_id = _token_embedded_client_id(access_token)
    if embedded_client_id and embedded_client_id != client_id:
        raise _auth_error(
            "O Access Token renovado pertence a uma aplicação diferente do Client ID usado na renovação.",
            reason="token_client_id_mismatch",
            status_code=409,
        )

    try:
        expires_in = int(payload.get("expires_in") or 21600)
    except (TypeError, ValueError):
        expires_in = 21600
    expires_in = max(600, min(expires_in, 21600))
    return access_token, expires_in


def resolve_saas_access_token(service: SaasMercadoPagoService) -> str:
    """Retorna o token efetivo sem persistir ou logar credenciais."""
    if not runtime_token_enabled():
        return service.access_token
    if service.environment != "production":
        return service.access_token

    client_id, client_secret, configured_public_key = _configured_credentials()

    global _CACHED_ACCESS_TOKEN, _CACHED_EXPIRES_AT
    now = time.monotonic()
    if _CACHED_ACCESS_TOKEN and now < _CACHED_EXPIRES_AT:
        return _CACHED_ACCESS_TOKEN

    with _CACHE_LOCK:
        now = time.monotonic()
        if _CACHED_ACCESS_TOKEN and now < _CACHED_EXPIRES_AT:
            return _CACHED_ACCESS_TOKEN

        payload = _mint_client_credentials_token(
            client_id=client_id,
            client_secret=client_secret,
        )
        access_token, expires_in = _validate_oauth_identity(
            payload,
            client_id=client_id,
            configured_public_key=configured_public_key,
        )
        _CACHED_ACCESS_TOKEN = access_token
        _CACHED_EXPIRES_AT = now + max(60, expires_in - 300)
        return access_token


def runtime_auth_reason(exc: BaseException) -> str:
    if isinstance(exc, SaasMercadoPagoRuntimeAuthError):
        return exc.reason
    return "provider_auth_error"


def public_runtime_auth_reason(exc: BaseException) -> str:
    reason = runtime_auth_reason(exc)
    if reason in {
        "missing_client_credentials",
        "oauth_invalid_client",
        "oauth_unauthorized_client",
    }:
        return "provider_credentials_invalid"
    if reason in {
        "missing_public_key",
        "public_key_mismatch",
        "token_client_id_mismatch",
        "test_credential",
        "unexpected_token_type",
        "missing_provider_user",
    }:
        return "provider_identity_not_ready"
    return "provider_temporarily_unavailable"


def build_runtime_client(service: SaasMercadoPagoService) -> httpx.Client:
    token = resolve_saas_access_token(service)
    return httpx.Client(
        base_url=service.API_URL,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        timeout=15.0,
    )


def clear_runtime_token_cache() -> None:
    global _CACHED_ACCESS_TOKEN, _CACHED_EXPIRES_AT
    with _CACHE_LOCK:
        _CACHED_ACCESS_TOKEN = ""
        _CACHED_EXPIRES_AT = 0.0

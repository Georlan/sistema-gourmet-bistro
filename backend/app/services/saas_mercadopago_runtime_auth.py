from __future__ import annotations

import os
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


def _flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def runtime_token_enabled() -> bool:
    return _flag("KOMA_SAAS_MP_RUNTIME_TOKEN_ENABLED")


def _required_identity() -> tuple[str, str, str, str]:
    client_id = os.getenv("MERCADO_PAGO_CLIENT_ID", "").strip()
    client_secret = os.getenv("MERCADO_PAGO_CLIENT_SECRET", "").strip()
    expected_application = os.getenv(
        "KOMA_SAAS_MERCADO_PAGO_EXPECTED_APPLICATION_ID", ""
    ).strip()
    expected_collector = os.getenv(
        "KOMA_SAAS_MERCADO_PAGO_EXPECTED_COLLECTOR_ID", ""
    ).strip()

    if not client_id or not client_secret:
        raise SaasMercadoPagoError(
            "Credenciais Client ID/Client Secret do Mercado Pago não estão configuradas para renovar o token SaaS.",
            status_code=503,
        )
    if not expected_application or not expected_collector:
        raise SaasMercadoPagoError(
            "A identidade esperada da aplicação KÔMA no Mercado Pago não está configurada; renovação automática bloqueada.",
            status_code=503,
        )
    if client_id != expected_application:
        raise SaasMercadoPagoError(
            "O Client ID configurado não pertence à aplicação Mercado Pago esperada para a cobrança SaaS KÔMA.",
            status_code=409,
        )
    return client_id, client_secret, expected_application, expected_collector


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
        raise SaasMercadoPagoError(
            "Falha de comunicação ao renovar a credencial SaaS do Mercado Pago.",
            status_code=502,
        ) from exc

    if response.status_code >= 400:
        # Nunca propagamos o corpo do OAuth: respostas de autenticação podem conter
        # dados que não devem aparecer em logs ou mensagens ao cliente.
        raise SaasMercadoPagoError(
            f"Mercado Pago recusou a renovação da credencial SaaS (HTTP {response.status_code}).",
            status_code=502,
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise SaasMercadoPagoError(
            "Mercado Pago retornou uma resposta inválida ao renovar a credencial SaaS.",
            status_code=502,
        ) from exc
    if not isinstance(payload, dict):
        raise SaasMercadoPagoError(
            "Mercado Pago retornou uma resposta inválida ao renovar a credencial SaaS.",
            status_code=502,
        )
    return payload


def _validate_oauth_identity(
    payload: dict[str, Any],
    *,
    expected_collector: str,
) -> tuple[str, int]:
    access_token = str(payload.get("access_token") or "").strip()
    provider_user_id = str(payload.get("user_id") or "").strip()
    returned_public_key = str(payload.get("public_key") or "").strip()
    configured_public_key = settings.KOMA_SAAS_MERCADO_PAGO_PUBLIC_KEY.strip()

    if not access_token:
        raise SaasMercadoPagoError(
            "Mercado Pago não retornou um Access Token para a cobrança SaaS.",
            status_code=502,
        )
    if access_token.startswith("TEST-"):
        raise SaasMercadoPagoError(
            "Mercado Pago retornou uma credencial de teste para o ambiente de produção.",
            status_code=409,
        )
    if provider_user_id != expected_collector:
        raise SaasMercadoPagoError(
            "A credencial renovada pertence a uma conta Mercado Pago diferente da conta KÔMA esperada.",
            status_code=409,
        )
    if returned_public_key and configured_public_key and returned_public_key != configured_public_key:
        raise SaasMercadoPagoError(
            "A credencial renovada pertence a uma aplicação Mercado Pago diferente da aplicação KÔMA configurada.",
            status_code=409,
        )

    try:
        expires_in = int(payload.get("expires_in") or 21600)
    except (TypeError, ValueError):
        expires_in = 21600
    expires_in = max(600, min(expires_in, 21600))
    return access_token, expires_in


def resolve_saas_access_token(service: SaasMercadoPagoService) -> str:
    """Retorna o token efetivo sem nunca persistir ou logar a credencial.

    Por padrão, preserva o Access Token estático já configurado. Quando a chave
    operacional `KOMA_SAAS_MP_RUNTIME_TOKEN_ENABLED` está ligada em produção,
    usa o fluxo oficial OAuth `client_credentials` para gerar um token de curta
    duração (6 h) e valida conta/aplicação antes de utilizá-lo.
    """
    if not runtime_token_enabled():
        return service.access_token
    if service.environment != "production":
        # Homologação permanece estritamente isolada nas credenciais TEST.
        return service.access_token

    client_id, client_secret, _expected_application, expected_collector = _required_identity()

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
            expected_collector=expected_collector,
        )
        # Renova antes do vencimento para evitar uma request cruzar a expiração.
        _CACHED_ACCESS_TOKEN = access_token
        _CACHED_EXPIRES_AT = now + max(60, expires_in - 300)
        return access_token


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

"""Transactional e-mail verification for public-menu customer registration."""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
from urllib.parse import quote

import httpx
from cryptography.fernet import InvalidToken

from ..config import settings
from ..crypt import cipher

logger = logging.getLogger("koma.customer_registration")
_PURPOSE = "customer_email_registration"


def registration_available() -> bool:
    return bool(
        settings.CUSTOMER_EMAIL_REGISTRATION_ENABLED
        and settings.RESEND_API_KEY
        and settings.EMAIL_FROM
    )


def issue_registration_token(*, restaurante_id: int, registration_id: str) -> str:
    payload = json.dumps(
        {
            "purpose": _PURPOSE,
            "restaurante_id": int(restaurante_id),
            "registration_id": str(registration_id),
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return cipher.encrypt(payload).decode("ascii")


def decode_registration_token(token: str) -> tuple[int, str]:
    raw_token = str(token or "").strip()
    if not raw_token:
        raise ValueError("Link de confirmação inválido.")
    try:
        payload = json.loads(cipher.decrypt(raw_token.encode("ascii")).decode("utf-8"))
    except (InvalidToken, UnicodeError, ValueError, json.JSONDecodeError) as exc:
        raise ValueError("Link de confirmação inválido.") from exc

    if payload.get("purpose") != _PURPOSE:
        raise ValueError("Link de confirmação inválido.")
    try:
        restaurante_id = int(payload.get("restaurante_id"))
    except (TypeError, ValueError) as exc:
        raise ValueError("Link de confirmação inválido.") from exc
    registration_id = str(payload.get("registration_id") or "").strip()
    if restaurante_id <= 0 or not registration_id:
        raise ValueError("Link de confirmação inválido.")
    return restaurante_id, registration_id


def hash_registration_token(restaurante_id: int, token: str) -> str:
    material = (
        f"koma:customer-registration-token:{int(restaurante_id)}:{token}"
    ).encode("utf-8")
    return hmac.new(
        settings.SECRET_KEY.encode("utf-8"),
        material,
        hashlib.sha256,
    ).hexdigest()


def registration_token_matches(
    restaurante_id: int,
    token: str,
    expected_hash: str,
) -> bool:
    return hmac.compare_digest(
        hash_registration_token(restaurante_id, token),
        str(expected_hash or ""),
    )


def _safe_restaurant_name(restaurant_name: str | None) -> str:
    normalized = " ".join(str(restaurant_name or "KÔMA").split()).strip()[:80]
    return normalized or "KÔMA"


def _registration_url(token: str) -> str:
    # Origem confiável configurada no servidor; fragmentos não chegam aos logs HTTP.
    return (
        f"{settings.KOMA_PUBLIC_APP_URL}/confirmar-cadastro"
        f"#token={quote(token, safe='')}"
    )


def send_registration_email(
    email: str,
    token: str,
    restaurant_name: str,
    *,
    delivery_id: str,
) -> bool:
    """Envia uma confirmação idempotente sem registrar destinatário ou segredo."""
    if not registration_available():
        return False

    display_restaurant = _safe_restaurant_name(restaurant_name)
    subject = "KÔMA — confirme seu cadastro"
    if display_restaurant.casefold() != "kôma".casefold():
        subject = f"{subject} — {display_restaurant}"
    text = (
        f"Restaurante: {display_restaurant}\n\n"
        "Confirme seu e-mail para concluir sua conta no KÔMA. Abra o link abaixo:\n\n"
        f"{_registration_url(token)}\n\n"
        f"O link é válido por até "
        f"{max(1, settings.CUSTOMER_EMAIL_VERIFICATION_TTL_SECONDS // 60)} minutos. "
        "Se você não solicitou este cadastro, ignore este e-mail."
    )

    try:
        # trust_env=False evita que proxy SOCKS local torne o transporte dependente
        # de uma biblioteca opcional; produção usa conexão HTTPS direta ao Resend.
        with httpx.Client(timeout=10, trust_env=False) as client:
            response = client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {settings.RESEND_API_KEY}",
                    "Idempotency-Key": delivery_id,
                },
                json={
                    "from": settings.EMAIL_FROM,
                    "to": [email],
                    "subject": subject,
                    "text": text,
                },
            )
        if response.is_success:
            return True
        logger.warning(
            "Customer registration e-mail delivery failed (status=%s)",
            response.status_code,
        )
    except httpx.HTTPError:
        logger.warning("Customer registration e-mail delivery unavailable")
    return False

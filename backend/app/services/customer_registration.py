"""Transactional customer registration by verified e-mail via Resend."""

from __future__ import annotations

import logging

import httpx

from ..config import settings


logger = logging.getLogger("koma.customer_registration")


def registration_email_available() -> bool:
    return bool(
        settings.CUSTOMER_EMAIL_REGISTRATION_ENABLED
        and settings.RESEND_API_KEY
        and settings.EMAIL_FROM
    )


def registration_confirmation_url(token: str) -> str:
    return f"{settings.KOMA_PUBLIC_APP_URL}/confirmar-cadastro#token={token}"


def send_registration_email(
    email: str,
    *,
    name: str,
    token: str,
    restaurant_name: str,
    idempotency_key: str,
) -> bool:
    """Send one registration confirmation without logging recipient or token."""
    if not registration_email_available():
        return False

    safe_name = " ".join(str(name or "cliente").split()).strip()[:100] or "cliente"
    safe_restaurant = " ".join(str(restaurant_name or "KÔMA").split()).strip()[:80] or "KÔMA"
    url = registration_confirmation_url(token)
    subject = f"KÔMA — confirme seu cadastro — {safe_restaurant}"
    text = (
        f"Olá, {safe_name}.\n\n"
        f"Confirme seu e-mail para concluir sua conta no {safe_restaurant}:\n\n"
        f"{url}\n\n"
        f"O link é válido por {max(1, settings.CUSTOMER_EMAIL_VERIFICATION_TTL_SECONDS // 60)} minutos "
        "e funciona uma única vez. Se você não solicitou este cadastro, ignore este e-mail."
    )
    try:
        response = httpx.post(
            "https://api.resend.com/emails",
            timeout=10,
            headers={
                "Authorization": f"Bearer {settings.RESEND_API_KEY}",
                "Idempotency-Key": idempotency_key[:256],
            },
            json={
                "from": settings.EMAIL_FROM,
                "to": [email],
                "subject": subject,
                "text": text,
            },
        )
    except httpx.HTTPError:
        logger.warning("Customer registration email delivery unavailable")
        return False

    if not response.is_success:
        logger.warning(
            "Customer registration email delivery failed (status=%s)",
            response.status_code,
        )
        return False
    return True

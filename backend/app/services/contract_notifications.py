from __future__ import annotations

import logging
import os
import time

from ..config import settings
from .whatsapp import enviar_texto_whatsapp_detalhado


logger = logging.getLogger("koma.contract_notifications")
_MAX_ATTEMPTS = 3
_RETRY_BASE_SECONDS = 0.5


def _send_with_retry(*, phone: str, message: str, context: str) -> bool:
    """Best-effort WhatsApp delivery isolated from the critical contract flow.

    The legal acceptance / tenant activation is always committed before this helper
    is scheduled. Any provider failure is swallowed and logged without phone or
    message contents, so WhatsApp can never roll back a contract or provisioning.
    """
    if not settings.KOMA_WHATSAPP_AUTOMATION_ENABLED:
        logger.debug("Contract WhatsApp notification skipped: automation disabled (%s).", context)
        return False

    last_error = "unknown"
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            result = enviar_texto_whatsapp_detalhado(
                phone,
                message,
                contexto=context,
            )
            if result.sucesso:
                logger.info(
                    "Contract WhatsApp notification delivered context=%s provider=%s attempt=%s",
                    context,
                    result.provider,
                    attempt,
                )
                return True
            last_error = result.error_message or "provider_rejected"
        except Exception as exc:  # defensive boundary: notification must never escape
            last_error = type(exc).__name__

        if attempt < _MAX_ATTEMPTS:
            time.sleep(_RETRY_BASE_SECONDS * (2 ** (attempt - 1)))

    logger.warning(
        "Contract WhatsApp notification failed context=%s attempts=%s reason=%s",
        context,
        _MAX_ATTEMPTS,
        last_error[:160],
    )
    return False


def notify_owner_new_contract(
    *,
    restaurant_name: str,
    representative_name: str,
    plan: str,
    billing_cycle: str,
    protocol: str,
) -> bool:
    """Alerts the KÔMA operator about a newly signed contract without tax IDs."""
    owner_phone = os.getenv("KOMA_OWNER_WHATSAPP_PHONE", "").strip()
    if not owner_phone:
        logger.warning(
            "Owner contract notification skipped: KOMA_OWNER_WHATSAPP_PHONE is not configured."
        )
        return False

    message = (
        "🟢 *Nova contratação KÔMA*\n\n"
        f"Restaurante: {restaurant_name}\n"
        f"Responsável: {representative_name}\n"
        f"Plano: {plan.upper()} · {billing_cycle}\n"
        f"Protocolo: {protocol}\n\n"
        "Aguardando ativação no Super Admin."
    )
    return _send_with_retry(
        phone=owner_phone,
        message=message,
        context="nova contratação para operador KÔMA",
    )


def notify_customer_contract_accepted(
    *,
    phone: str,
    representative_name: str,
    restaurant_name: str,
    plan: str,
    protocol: str,
) -> bool:
    """Confirms that the immutable clickwrap was registered successfully."""
    message = (
        f"✅ Olá, {representative_name}! Sua contratação do *KÔMA* foi registrada.\n\n"
        f"Restaurante: {restaurant_name}\n"
        f"Plano: {plan.upper()}\n"
        f"Protocolo: {protocol}\n\n"
        "Estamos preparando o acesso do restaurante. Você receberá outra mensagem quando ele estiver disponível."
    )
    return _send_with_retry(
        phone=phone,
        message=message,
        context="confirmação de contratação ao cliente",
    )


def notify_customer_activation(
    *,
    phone: str,
    representative_name: str,
    restaurant_name: str,
    protocol: str,
    invitation_token: str,
    invitation_ttl_hours: int,
) -> bool:
    """Delivers the one-time first-access link after tenant activation.

    The invitation token is used only to build the outbound link. It is never
    logged or returned by this module.
    """
    link = f"{settings.KOMA_PUBLIC_APP_URL}/ativar?token={invitation_token}"
    message = (
        f"🚀 Olá, {representative_name}! O *{restaurant_name}* já está ativo no KÔMA.\n\n"
        f"Protocolo: {protocol}\n"
        f"Crie sua senha e conclua o primeiro acesso: {link}\n\n"
        f"Este link expira em {invitation_ttl_hours} horas. Não encaminhe esta mensagem."
    )
    return _send_with_retry(
        phone=phone,
        message=message,
        context="entrega de primeiro acesso KÔMA",
    )

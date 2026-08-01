import logging
import re

import httpx

from ..config import settings

logger = logging.getLogger("koma.whatsapp")


def _normalizar_telefone(telefone: str) -> str:
    numero = re.sub(r"\D", "", telefone or "")
    if len(numero) in {10, 11}:
        return f"55{numero}"
    return numero


def enviar_notificacao_whatsapp_task(telefone: str, mensagem: str) -> None:
    """Envia pela Evolution API sem permitir que falhas afetem a rota principal."""
    try:
        evolution_url = settings.EVOLUTION_API_URL.strip()
        evolution_key = settings.EVOLUTION_API_KEY.strip()
        evolution_instance = settings.EVOLUTION_INSTANCE_NAME.strip()
        numero = _normalizar_telefone(telefone)

        if not evolution_url or not evolution_key or not evolution_instance:
            logger.warning(
                "[EVOLUTION API] Notificação não enviada: configuração incompleta."
            )
            return

        if not numero:
            logger.warning(
                "[EVOLUTION API] Notificação não enviada: telefone ausente."
            )
            return

        url = f"{evolution_url.rstrip('/')}/message/sendText/{evolution_instance}"
        headers = {
            "Content-Type": "application/json",
            "apikey": evolution_key,
        }
        payload = {
            "number": numero,
            "text": mensagem,
        }

        with httpx.Client(timeout=5.0) as client:
            response = client.post(url, headers=headers, json=payload)
            response.raise_for_status()
    except Exception as exc:
        logger.warning(
            "[EVOLUTION API] Falha ao enviar notificação de status: %s",
            type(exc).__name__,
        )

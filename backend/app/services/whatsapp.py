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


def enviar_texto_whatsapp(
    telefone: str,
    mensagem: str,
    *,
    contexto: str = "mensagem",
) -> bool:
    """Envia texto pela Evolution API e nunca registra telefone ou conteúdo."""
    try:
        evolution_url = settings.EVOLUTION_API_URL.strip()
        evolution_key = settings.EVOLUTION_API_KEY.strip()
        evolution_instance = settings.EVOLUTION_INSTANCE_NAME.strip()
        numero = _normalizar_telefone(telefone)

        if not evolution_url or not evolution_key or not evolution_instance:
            logger.warning(
                "[EVOLUTION API] %s não enviada: configuração incompleta.",
                contexto,
            )
            return False

        if not numero:
            logger.warning(
                "[EVOLUTION API] %s não enviada: telefone ausente.",
                contexto,
            )
            return False

        url = f"{evolution_url.rstrip('/')}/message/sendText/{evolution_instance}"
        headers = {
            "Content-Type": "application/json",
            "apikey": evolution_key,
        }
        payload = {
            "number": numero,
            "text": mensagem,
        }

        with httpx.Client(timeout=10.0) as client:
            response = client.post(url, headers=headers, json=payload)
            response.raise_for_status()
        return True
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "[EVOLUTION API] Falha HTTP %s ao enviar %s.",
            exc.response.status_code,
            contexto,
        )
        return False
    except Exception as exc:
        logger.warning(
            "[EVOLUTION API] Falha ao enviar %s: %s",
            contexto,
            type(exc).__name__,
        )
        return False
    except Exception as exc:
        logger.warning(
            "[EVOLUTION API] Falha ao enviar %s: %s",
            contexto,
            type(exc).__name__,
        )
        return False


def obter_status_evolution() -> dict[str, object]:
    """Diagnóstico sem segredos para a área autenticada de operações."""
    evolution_url = settings.EVOLUTION_API_URL.strip()
    evolution_key = settings.EVOLUTION_API_KEY.strip()
    evolution_instance = settings.EVOLUTION_INSTANCE_NAME.strip()

    if not evolution_url or not evolution_key or not evolution_instance:
        return {
            "status": "red",
            "configured": False,
            "connected": False,
            "details": "Evolution API não configurada",
        }

    url = (
        f"{evolution_url.rstrip('/')}/instance/connectionState/"
        f"{evolution_instance}"
    )
    try:
        with httpx.Client(timeout=5.0) as client:
            response = client.get(url, headers={"apikey": evolution_key})
            response.raise_for_status()
            data = response.json()
        instance = data.get("instance") if isinstance(data, dict) else None
        state = instance.get("state") if isinstance(instance, dict) else None
        connected = state == "open"
        return {
            "status": "green" if connected else "yellow",
            "configured": True,
            "connected": connected,
            "details": (
                "WhatsApp conectado"
                if connected
                else f"WhatsApp aguardando conexão ({state or 'desconhecido'})"
            ),
        }
    except Exception as exc:
        logger.warning(
            "[EVOLUTION API] Falha no diagnóstico: %s",
            type(exc).__name__,
        )
        return {
            "status": "red",
            "configured": True,
            "connected": False,
            "details": "Evolution API indisponível",
        }


def enviar_codigo_otp_whatsapp(telefone: str, codigo: str) -> bool:
    mensagem = (
        f"Seu código de acesso Kôma é {codigo}. "
        "Ele expira em poucos minutos. Não compartilhe este código."
    )
    return enviar_texto_whatsapp(
        telefone,
        mensagem,
        contexto="código de acesso",
    )


def enviar_notificacao_whatsapp_task(telefone: str, mensagem: str) -> None:
    """Envia sem permitir que falhas afetem a rota principal do pedido."""
    enviar_texto_whatsapp(
        telefone,
        mensagem,
        contexto="notificação de status",
    )


def enviar_otp_whatsapp_meta(telefone: str, nome_restaurante: str, codigo_otp: str) -> bool:
    """
    Envia código OTP por WhatsApp utilizando a Meta Cloud API oficial.
    Retorna True se enviado com sucesso, False se simulado/falha.
    """
    import os
    try:
        numero = _normalizar_telefone(telefone)
        if not numero:
            logger.warning("[META CLOUD API] Falha: Telefone inválido")
            return False

        meta_token = getattr(settings, "META_ACCESS_TOKEN", None) or os.getenv("META_ACCESS_TOKEN", "")
        phone_number_id = getattr(settings, "META_PHONE_NUMBER_ID", None) or os.getenv("META_PHONE_NUMBER_ID", "128608279268222")

        mensagem = f"Olá! Seu código de acesso para o *{nome_restaurante}* é: *{codigo_otp}*\n\nDigite no cardápio digital para continuar. Válido por 10 minutos."

        if not meta_token:
            logger.info(
                "[META CLOUD API SIMULADO] Token não configurado. Mensagem para %s: '%s'",
                numero,
                mensagem
            )
            return False

        url = f"https://graph.facebook.com/v25.0/{phone_number_id}/messages"
        headers = {
            "Authorization": f"Bearer {meta_token}",
            "Content-Type": "application/json",
        }
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": numero,
            "type": "text",
            "text": {
                "preview_url": False,
                "body": mensagem
            }
        }

        with httpx.Client(timeout=5.0) as client:
            res = client.post(url, headers=headers, json=payload)
            if res.status_code in (200, 201):
                logger.info("[META CLOUD API SUCCESS] OTP enviado para %s", numero)
                return True
            else:
                logger.warning("[META CLOUD API HTTP %s] Falha ao enviar OTP: %s", res.status_code, res.text)
                return False
    except Exception as exc:
        logger.warning("[META CLOUD API EXCEPTION] Erro ao enviar OTP: %s", exc)
        return False

>>>>>>> c226700 (feat(meta-webhook): implement Meta Cloud API webhook verification handshake and OTP sending)

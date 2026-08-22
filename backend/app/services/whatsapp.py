# INSTRUÇÕES PARA CRIAÇÃO DE TEMPLATE NA META:
# 1. Vá em Meta Developers > Kôma > WhatsApp > Message Templates
# 2. Crie template "koma_otp" com categoria AUTHENTICATION
# 3. Corpo: "Seu código de acesso {{1}} é: {{2}}. Válido por 10 minutos."
# 4. Aguarde aprovação (pode levar horas)
# 5. Altere META_USE_TEMPLATE para True no .env

import logging
import re

import httpx

from ..config import settings

logger = logging.getLogger("koma.whatsapp")



_META_LAST_ERROR: str | None = None
_META_COUNTRY_RESTRICTION: bool = False


def obter_diagnostico_whatsapp() -> dict[str, object]:
    """Retorna o estado de diagnóstico atual das integrações Meta Cloud API e Evolution API."""
    meta_token = getattr(settings, "META_ACCESS_TOKEN", "") or ""
    phone_id = getattr(settings, "META_PHONE_NUMBER_ID", "") or ""

    evolution_diag = obter_status_evolution()

    return {
        "meta": {
            "phone_number_id_configured": bool(phone_id.strip()),
            "access_token_configured": bool(meta_token.strip()),
            "last_error": _META_LAST_ERROR,
            "country_restriction": _META_COUNTRY_RESTRICTION,
        },
        "evolution": evolution_diag,
    }


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
    if not getattr(settings, "KOMA_WHATSAPP_AUTOMATION_ENABLED", False):
        logger.debug("[WHATSAPP DESATIVADO] Envio automático ignorado (KOMA_WHATSAPP_AUTOMATION_ENABLED=false).")
        return False

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
        status_code = exc.response.status_code
        if status_code == 401:
            logger.error("[EVOLUTION API 401] Apikey inválida ou não autorizada ao enviar %s.", contexto)
        elif status_code == 404:
            logger.error("[EVOLUTION API 404] Instância não encontrada ao enviar %s.", contexto)
        elif status_code == 429:
            logger.warning("[EVOLUTION API 429] Rate limit excedido ao enviar %s.", contexto)
        else:
            logger.warning("[EVOLUTION API HTTP %s] Falha ao enviar %s.", status_code, contexto)
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


def enviar_codigo_otp_whatsapp(telefone: str, codigo: str, nome_restaurante: str = "Kôma") -> bool:
    """Envia código OTP usando preferencialmente a Meta Cloud API com fallback para Evolution API."""
    if enviar_otp_whatsapp_meta(telefone, nome_restaurante, codigo):
        return True

    mensagem = (
        f"Seu código de acesso {nome_restaurante} é {codigo}. "
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
    Retorna True se enviado com sucesso e False quando indisponível ou com falha.
    """
    if not getattr(settings, "KOMA_WHATSAPP_AUTOMATION_ENABLED", False):
        logger.debug("[WHATSAPP DESATIVADO] Envio de OTP Meta ignorado (KOMA_WHATSAPP_AUTOMATION_ENABLED=false).")
        return False

    global _META_LAST_ERROR, _META_COUNTRY_RESTRICTION


    try:
        numero = _normalizar_telefone(telefone)
        if not numero:
            logger.warning("[META CLOUD API] Falha: Telefone inválido")
            return False

        meta_token = getattr(settings, "META_ACCESS_TOKEN", "") or ""
        phone_number_id = getattr(settings, "META_PHONE_NUMBER_ID", "") or ""

        mensagem = f"Olá! Seu código de acesso para o *{nome_restaurante}* é: *{codigo_otp}*\n\nDigite no cardápio digital para continuar. Válido por 10 minutos."

        if not meta_token:
            _META_LAST_ERROR = "Meta Cloud API não configurada."
            logger.warning("[META CLOUD API] OTP não enviado: configuração incompleta.")
            return False

        if not phone_number_id:
            _META_LAST_ERROR = "META_PHONE_NUMBER_ID não está configurado."
            logger.error("[META CLOUD API ERRO] META_PHONE_NUMBER_ID não está configurado.")
            return False

        url = f"https://graph.facebook.com/v20.0/{phone_number_id}/messages"
        headers = {
            "Authorization": f"Bearer {meta_token}",
            "Content-Type": "application/json",
        }

        use_template = getattr(settings, "META_USE_TEMPLATE", False)
        if isinstance(use_template, str):
            use_template = use_template.lower() == "true"

        if use_template:
            template_name = getattr(settings, "META_OTP_TEMPLATE_NAME", "koma_otp") or "koma_otp"
            payload = {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": numero,
                "type": "template",
                "template": {
                    "name": template_name,
                    "language": {"code": "pt_BR"},
                    "components": [
                        {
                            "type": "body",
                            "parameters": [
                                {"type": "text", "text": nome_restaurante},
                                {"type": "text", "text": codigo_otp}
                            ]
                        }
                    ]
                }
            }
        else:
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
            data = None
            try:
                data = res.json()
            except Exception:
                pass

            # Verifica se a Meta retornou payload de erro (mesmo com HTTP 200 ou 400+)
            if isinstance(data, dict) and "error" in data:
                err = data["error"]
                code = err.get("code")
                if code == 130497:
                    _META_COUNTRY_RESTRICTION = True
                    _META_LAST_ERROR = (
                        "130497: Conta restrita para enviar ao país do destinatário. "
                        "Vá para Etapa 2 (Configuração da produção) no Meta Developers "
                        "e adicione um número de telefone real do Brasil."
                    )
                    logger.error(
                        "[META 130497] Conta restrita para enviar ao país do destinatário. "
                        "Vá para Etapa 2 (Configuração da produção) no Meta Developers "
                        "e adicione um número de telefone real do Brasil."
                    )
                    return False
                elif code == 130429:
                    _META_LAST_ERROR = "130429: limite de envios excedido."
                    logger.error("[META CLOUD API] Limite de envios excedido (130429).")
                    return False
                elif code == 132000:
                    _META_LAST_ERROR = "132000: modelo de mensagem não encontrado."
                    logger.error("[META CLOUD API] Modelo de mensagem ausente (132000).")
                    return False
                else:
                    safe_code = code if isinstance(code, int) else "desconhecido"
                    _META_LAST_ERROR = f"Falha do provedor (código {safe_code})."
                    logger.error(
                        "[META CLOUD API] Falha do provedor (código=%s, http=%s).",
                        safe_code,
                        res.status_code,
                    )
                    return False

            if res.status_code in (200, 201):
                logger.info("[META CLOUD API] OTP aceito pelo provedor.")
                _META_LAST_ERROR = None
                return True
            else:
                _META_LAST_ERROR = f"Falha HTTP {res.status_code} ao enviar OTP."
                logger.warning(
                    "[META CLOUD API] Falha HTTP %s ao enviar OTP.",
                    res.status_code,
                )
                return False
    except Exception as exc:
        error_type = type(exc).__name__
        _META_LAST_ERROR = f"Falha local ao enviar OTP ({error_type})."
        logger.warning("[META CLOUD API] Falha local ao enviar OTP (%s).", error_type)
        return False

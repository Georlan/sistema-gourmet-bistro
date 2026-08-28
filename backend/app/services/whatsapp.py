from dataclasses import dataclass
import logging
import re
from typing import Any
from urllib.parse import quote

import httpx

from ..config import settings

logger = logging.getLogger("koma.whatsapp")



_META_LAST_ERROR: str | None = None
_META_COUNTRY_RESTRICTION: bool = False


@dataclass(frozen=True)
class ResultadoEnvioWhatsApp:
    """Resultado sanitizado de um envio, sem telefone ou conteúdo da mensagem."""

    sucesso: bool
    provider: str
    message_id: str | None = None
    recipient_id: str | None = None
    provider_status: str | None = None
    error_code: int | None = None
    error_message: str | None = None


def obter_diagnostico_whatsapp() -> dict[str, object]:
    """Retorna o estado de diagnóstico atual das integrações Meta Cloud API e Evolution API."""
    meta_token = getattr(settings, "META_ACCESS_TOKEN", "") or ""
    phone_id = getattr(settings, "META_PHONE_NUMBER_ID", "") or ""

    evolution_diag = obter_status_evolution()

    return {
        "provider": getattr(settings, "KOMA_WHATSAPP_PROVIDER", "evolution"),
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


def _configuracao_evolution() -> tuple[str, str, str] | None:
    evolution_url = settings.EVOLUTION_API_URL.strip().rstrip("/")
    evolution_key = settings.EVOLUTION_API_KEY.strip()
    evolution_instance = settings.EVOLUTION_INSTANCE_NAME.strip()
    if not evolution_url or not evolution_key or not evolution_instance:
        return None
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,100}", evolution_instance):
        return None
    return evolution_url, evolution_key, evolution_instance


def _texto_limitado(value: Any, limite: int) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value[:limite] if value else None


def _headers_evolution(api_key: str, *, json_content: bool = False) -> dict[str, str]:
    headers = {"Accept": "application/json", "apikey": api_key}
    origin = str(getattr(settings, "EVOLUTION_API_ORIGIN", "") or "").strip()
    if origin:
        headers["Origin"] = origin
    if json_content:
        headers["Content-Type"] = "application/json"
    return headers


def _resultado_evolution(response: httpx.Response) -> ResultadoEnvioWhatsApp:
    try:
        data = response.json()
    except Exception:
        data = None

    key = data.get("key") if isinstance(data, dict) else None
    message_id = _texto_limitado(
        key.get("id") if isinstance(key, dict) else None,
        255,
    )
    if message_id is None and isinstance(data, dict):
        message_id = _texto_limitado(data.get("id"), 255)

    recipient_id = _texto_limitado(
        key.get("remoteJid") if isinstance(key, dict) else None,
        50,
    )
    provider_status = _texto_limitado(
        data.get("status") if isinstance(data, dict) else None,
        50,
    )
    return ResultadoEnvioWhatsApp(
        sucesso=True,
        provider="evolution",
        message_id=message_id,
        recipient_id=recipient_id,
        provider_status=(provider_status or "accepted").lower(),
    )


def enviar_texto_whatsapp_detalhado(
    telefone: str,
    mensagem: str,
    *,
    contexto: str = "mensagem",
) -> ResultadoEnvioWhatsApp:
    """Envia texto pela Evolution e retorna somente metadados seguros do envio."""
    if not getattr(settings, "KOMA_WHATSAPP_AUTOMATION_ENABLED", False):
        logger.debug(
            "[WHATSAPP DESATIVADO] Envio automático ignorado "
            "(KOMA_WHATSAPP_AUTOMATION_ENABLED=false)."
        )
        return ResultadoEnvioWhatsApp(
            sucesso=False,
            provider="evolution",
            error_message="Automação de WhatsApp desativada.",
        )

    configuracao = _configuracao_evolution()
    numero = _normalizar_telefone(telefone)
    if configuracao is None:
        logger.warning(
            "[EVOLUTION API] %s não enviada: configuração inválida ou incompleta.",
            contexto,
        )
        return ResultadoEnvioWhatsApp(
            sucesso=False,
            provider="evolution",
            error_message="Configuração da Evolution inválida ou incompleta.",
        )
    if len(numero) not in {12, 13} or not numero.startswith("55"):
        logger.warning(
            "[EVOLUTION API] %s não enviada: telefone inválido.",
            contexto,
        )
        return ResultadoEnvioWhatsApp(
            sucesso=False,
            provider="evolution",
            error_message="Telefone inválido.",
        )
    if not isinstance(mensagem, str) or not mensagem.strip():
        logger.warning(
            "[EVOLUTION API] %s não enviada: mensagem vazia.",
            contexto,
        )
        return ResultadoEnvioWhatsApp(
            sucesso=False,
            provider="evolution",
            error_message="Mensagem vazia.",
        )

    evolution_url, evolution_key, evolution_instance = configuracao
    url = (
        f"{evolution_url}/message/sendText/"
        f"{quote(evolution_instance, safe='')}"
    )
    headers = _headers_evolution(evolution_key, json_content=True)
    payload = {
        "number": numero,
        "text": mensagem.strip(),
    }

    try:
        timeout = float(
            getattr(settings, "EVOLUTION_REQUEST_TIMEOUT_SECONDS", 10.0)
        )
        with httpx.Client(timeout=timeout) as client:
            response = client.post(url, headers=headers, json=payload)
            response.raise_for_status()
        return _resultado_evolution(response)
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code
        if status_code in {401, 403}:
            error_message = "Chave da Evolution inválida ou não autorizada."
            logger.error(
                "[EVOLUTION API %s] Autenticação rejeitada ao enviar %s.",
                status_code,
                contexto,
            )
        elif status_code == 404:
            error_message = "Instância da Evolution não encontrada."
            logger.error(
                "[EVOLUTION API 404] Instância não encontrada ao enviar %s.",
                contexto,
            )
        elif status_code == 429:
            error_message = "Limite de envios da Evolution excedido."
            logger.warning(
                "[EVOLUTION API 429] Limite de envios excedido ao enviar %s.",
                contexto,
            )
        else:
            error_message = f"Evolution respondeu HTTP {status_code}."
            logger.warning(
                "[EVOLUTION API HTTP %s] Falha ao enviar %s.",
                status_code,
                contexto,
            )
        return ResultadoEnvioWhatsApp(
            sucesso=False,
            provider="evolution",
            error_code=status_code,
            error_message=error_message,
        )
    except httpx.TimeoutException:
        logger.warning("[EVOLUTION API] Timeout ao enviar %s.", contexto)
        return ResultadoEnvioWhatsApp(
            sucesso=False,
            provider="evolution",
            error_message="Tempo limite da Evolution excedido.",
        )
    except httpx.RequestError as exc:
        logger.warning(
            "[EVOLUTION API] Falha de conexão ao enviar %s: %s.",
            contexto,
            type(exc).__name__,
        )
        return ResultadoEnvioWhatsApp(
            sucesso=False,
            provider="evolution",
            error_message="Evolution indisponível.",
        )
    except Exception as exc:
        logger.warning(
            "[EVOLUTION API] Falha local ao enviar %s: %s.",
            contexto,
            type(exc).__name__,
        )
        return ResultadoEnvioWhatsApp(
            sucesso=False,
            provider="evolution",
            error_message="Falha local ao enviar pela Evolution.",
        )


def enviar_texto_whatsapp(
    telefone: str,
    mensagem: str,
    *,
    contexto: str = "mensagem",
) -> bool:
    """Compatibilidade: envia pela Evolution e retorna apenas sucesso/falha."""
    return enviar_texto_whatsapp_detalhado(
        telefone,
        mensagem,
        contexto=contexto,
    ).sucesso


def obter_status_evolution() -> dict[str, object]:
    """Diagnóstico sem segredos para a área autenticada de operações."""
    configuracao = _configuracao_evolution()
    if configuracao is None:
        return {
            "status": "red",
            "configured": False,
            "connected": False,
            "details": "Evolution API não configurada",
        }

    evolution_url, evolution_key, evolution_instance = configuracao
    url = f"{evolution_url}/instance/connectionState/{quote(evolution_instance, safe='')}"
    try:
        timeout = min(
            float(getattr(settings, "EVOLUTION_REQUEST_TIMEOUT_SECONDS", 10.0)),
            5.0,
        )
        with httpx.Client(timeout=timeout) as client:
            response = client.get(url, headers=_headers_evolution(evolution_key))
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
    """Envia OTP exclusivamente pelo provedor explicitamente configurado."""
    provider = getattr(settings, "KOMA_WHATSAPP_PROVIDER", "evolution")
    if provider == "meta":
        return enviar_otp_whatsapp_meta(telefone, nome_restaurante, codigo)
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

import os
import logging
from fastapi import APIRouter, Request, Response, HTTPException, status
from ..config import settings

logger = logging.getLogger("koma.whatsapp_webhook")

router = APIRouter(
    prefix="/api/whatsapp",
    tags=["WhatsApp Webhook Meta"]
)


@router.get("/webhook")
def verify_meta_webhook(request: Request):
    """
    Handshake de validação do Webhook da Meta Cloud API.
    A Meta envia GET com hub.mode, hub.verify_token e hub.challenge.
    Se o token for válido, devemos retornar o hub.challenge em texto puro com HTTP 200.
    """
    params = request.query_params
    mode = params.get("hub.mode")
    token = params.get("hub.verify_token")
    challenge = params.get("hub.challenge")

    expected_token = getattr(settings, "META_VERIFY_TOKEN", None) or os.getenv("META_VERIFY_TOKEN", "1505")

    if mode == "subscribe" and token == expected_token:
        logger.info("[META WEBHOOK] Handshake de verificação validado com sucesso!")
        return Response(content=challenge or "", media_type="text/plain", status_code=200)

    logger.warning(
        "[META WEBHOOK FAIL] Falha na validação do token. Recebido: '%s', Esperado: '%s'",
        token,
        expected_token
    )
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Token de verificação inválido."
    )


@router.post("/webhook")
async def receive_meta_webhook(request: Request):
    """
    Recebe notificações de eventos da Meta Cloud API (mensagens recebidas, confirmações de entrega, status).
    """
    try:
        payload = await request.json()
        logger.info("[META WEBHOOK EVENT] Evento recebido da Meta: %s", payload)
        # Processamento assíncrono básico de eventos do webhook
    except Exception as err:
        logger.error("[META WEBHOOK ERROR] Erro ao processar payload: %s", err)

    return {"status": "EVENT_RECEIVED"}


@router.get("/diagnostico")
def get_whatsapp_diagnostic():
    """
    Retorna o diagnóstico completo das integrações com WhatsApp (Meta Cloud API e Evolution API).
    """
    from ..services.whatsapp import obter_diagnostico_whatsapp
    return obter_diagnostico_whatsapp()


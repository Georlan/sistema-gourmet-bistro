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
    Sempre retorna HTTP 200 para evitar que a Meta reenvie payloads repetidamente.
    """
    import json
    from ..database import SessionLocal
    from ..models import NotificacaoWhatsApp

    try:
        payload = await request.json()
        logger.info("[META WEBHOOK EVENT] Evento recebido da Meta: %s", payload)

        entries = payload.get("entry", []) if isinstance(payload, dict) else []
        for entry_item in entries:
            changes = entry_item.get("changes", []) if isinstance(entry_item, dict) else []
            for change in changes:
                value = change.get("value", {}) if isinstance(change, dict) else {}

                # 1. Processar 'statuses'
                statuses = value.get("statuses", []) if isinstance(value, dict) else []
                for st in statuses:
                    if not isinstance(st, dict):
                        continue
                    wamid = st.get("id")
                    msg_status = st.get("status", "unknown")
                    recipient = st.get("recipient_id")
                    errors = st.get("errors", [])
                    err_code = None
                    err_title = None

                    if isinstance(errors, list) and len(errors) > 0 and isinstance(errors[0], dict):
                        err_code = errors[0].get("code")
                        err_title = errors[0].get("title")

                    if msg_status == "failed":
                        logger.error(
                            "[META WEBHOOK FAILED] Mensagem %s para %s falhou (código %s): %s",
                            wamid,
                            recipient,
                            err_code,
                            err_title,
                        )
                        if err_code == 130497:
                            from ..services import whatsapp as whatsapp_service
                            whatsapp_service._META_COUNTRY_RESTRICTION = True
                            whatsapp_service._META_LAST_ERROR = (
                                "130497: Conta restrita para enviar ao país do destinatário. "
                                "Vá para Etapa 2 (Configuração da produção) no Meta Developers "
                                "e adicione um número de telefone real do Brasil."
                            )
                    else:
                        logger.info(
                            "[META WEBHOOK STATUS] Mensagem %s para %s: %s",
                            wamid,
                            recipient,
                            msg_status,
                        )

                    # Persistir no banco de dados
                    db = SessionLocal()
                    try:
                        notif = NotificacaoWhatsApp(
                            wamid=wamid,
                            recipient_id=recipient,
                            status=msg_status,
                            error_code=err_code,
                            error_title=err_title,
                            raw_payload=json.dumps(payload, ensure_ascii=False)
                        )
                        db.add(notif)
                        db.commit()
                    except Exception as db_err:
                        logger.error("[META WEBHOOK DB ERROR] Falha ao salvar notificação: %s", db_err)
                        db.rollback()
                    finally:
                        db.close()

                # 2. Processar 'messages' (mensagens recebidas dos clientes)
                messages = value.get("messages", []) if isinstance(value, dict) else []
                for msg in messages:
                    if not isinstance(msg, dict):
                        continue
                    sender = msg.get("from")
                    msg_type = msg.get("type")
                    text_body = ""
                    if msg_type == "text" and isinstance(msg.get("text"), dict):
                        text_body = msg.get("text", {}).get("body", "")

                    logger.info(
                        "[WHATSAPP IN] Mensagem de +%s (tipo %s): %s",
                        sender,
                        msg_type,
                        text_body,
                    )

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


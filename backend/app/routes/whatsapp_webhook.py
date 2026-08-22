import hashlib
import hmac
import json
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy.exc import MultipleResultsFound

from ..config import settings
from ..database import SessionLocal
from ..models import NotificacaoWhatsApp

logger = logging.getLogger("koma.whatsapp_webhook")

router = APIRouter(
    prefix="/api/whatsapp",
    tags=["WhatsApp Webhook Meta"],
)

_META_STATUS_TO_STATUS_ENVIO = {
    "sent": "enviado",
    "delivered": "entregue",
    "read": "entregue",
    "failed": "falhou",
}
_MAX_WEBHOOK_BODY_BYTES = 1_048_576


def _configured_value(name: str) -> str:
    return str(getattr(settings, name, "") or "").strip()


def _constant_time_equal(received: str, expected: str) -> bool:
    return hmac.compare_digest(
        received.encode("utf-8"),
        expected.encode("utf-8"),
    )


async def _read_limited_body(request: Request) -> bytes:
    raw_content_length = request.headers.get("content-length")
    if raw_content_length:
        try:
            content_length = int(raw_content_length)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Content-Length inválido.",
            ) from None
        if content_length < 0 or content_length > _MAX_WEBHOOK_BODY_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail="Payload do webhook excede o limite permitido.",
            )

    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > _MAX_WEBHOOK_BODY_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail="Payload do webhook excede o limite permitido.",
            )
    return bytes(body)


def _validate_event_payload(
    payload: Any,
    expected_phone_number_id: str,
) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payload do webhook inválido.",
        )
    if payload.get("object") != "whatsapp_business_account":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payload do webhook inválido.",
        )

    entries = payload.get("entry")
    if not isinstance(entries, list) or not entries:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payload do webhook inválido.",
        )

    values: list[dict[str, Any]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Payload do webhook inválido.",
            )

        changes = entry.get("changes")
        if not isinstance(changes, list) or not changes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Payload do webhook inválido.",
            )

        for change in changes:
            if not isinstance(change, dict) or change.get("field") != "messages":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Payload do webhook inválido.",
                )

            value = change.get("value")
            if not isinstance(value, dict) or value.get("messaging_product") != "whatsapp":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Payload do webhook inválido.",
                )

            metadata = value.get("metadata")
            phone_number_id = (
                metadata.get("phone_number_id")
                if isinstance(metadata, dict)
                else None
            )
            if not isinstance(phone_number_id, str) or not phone_number_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Payload do webhook inválido.",
                )
            if not _constant_time_equal(phone_number_id, expected_phone_number_id):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Origem do webhook não autorizada.",
                )

            event_fields = (value.get("statuses"), value.get("messages"))
            if all(event_field is None for event_field in event_fields):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Payload do webhook inválido.",
                )
            if any(
                event_field is not None
                and (
                    not isinstance(event_field, list)
                    or any(not isinstance(item, dict) for item in event_field)
                )
                for event_field in event_fields
            ):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Payload do webhook inválido.",
                )

            values.append(value)

    return values


def _status_error(status_payload: dict[str, Any]) -> tuple[int | None, str | None]:
    errors = status_payload.get("errors")
    if not isinstance(errors, list) or not errors or not isinstance(errors[0], dict):
        return None, None

    raw_code = errors[0].get("code")
    error_code = (
        raw_code
        if isinstance(raw_code, int) and not isinstance(raw_code, bool)
        else None
    )
    raw_title = errors[0].get("title")
    error_title = raw_title[:1000] if isinstance(raw_title, str) else None
    return error_code, error_title


def _update_known_statuses(values: list[dict[str, Any]]) -> None:
    status_payloads: list[dict[str, Any]] = []
    for value in values:
        raw_statuses = value.get("statuses")
        if isinstance(raw_statuses, list):
            status_payloads.extend(
                item for item in raw_statuses if isinstance(item, dict)
            )
    if not status_payloads:
        return

    db = SessionLocal()
    try:
        for status_payload in status_payloads:
            wamid = status_payload.get("id")
            meta_status = status_payload.get("status")
            if (
                not isinstance(wamid, str)
                or not wamid
                or len(wamid) > 255
                or not isinstance(meta_status, str)
                or meta_status not in _META_STATUS_TO_STATUS_ENVIO
            ):
                continue

            try:
                notification = (
                    db.query(NotificacaoWhatsApp)
                    .filter(
                        NotificacaoWhatsApp.wamid == wamid,
                        NotificacaoWhatsApp.restaurante_id.isnot(None),
                    )
                    .one_or_none()
                )
            except MultipleResultsFound:
                # Duplicidade impede determinar o tenant de forma segura.
                continue

            if notification is None:
                # Um status não cria uma notificação sem vínculo de tenant.
                continue

            error_code, error_title = _status_error(status_payload)
            notification.status = meta_status
            notification.status_envio = _META_STATUS_TO_STATUS_ENVIO[meta_status]
            notification.error_code = error_code
            notification.error_title = error_title
            # Remove conteúdo legado; o corpo integral do webhook não deve ser persistido.
            notification.raw_payload = None

            if meta_status == "failed" and error_code == 130497:
                from ..services import whatsapp as whatsapp_service

                whatsapp_service._META_COUNTRY_RESTRICTION = True
                whatsapp_service._META_LAST_ERROR = (
                    "130497: Conta restrita para enviar ao país do destinatário. "
                    "Vá para Etapa 2 (Configuração da produção) no Meta Developers "
                    "e adicione um número de telefone real do Brasil."
                )

        db.commit()
    except Exception:
        db.rollback()
        logger.error("Falha ao atualizar status autenticados do webhook Meta.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Falha ao processar o webhook.",
        ) from None
    finally:
        db.close()


@router.get("/webhook")
def verify_meta_webhook(request: Request):
    """Valida o handshake da Meta Cloud API sem fallback público."""
    expected_token = _configured_value("META_VERIFY_TOKEN")
    if not expected_token:
        logger.error("Webhook Meta indisponível por configuração incompleta.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Webhook Meta não configurado.",
        )

    params = request.query_params
    mode = params.get("hub.mode")
    token = params.get("hub.verify_token")
    challenge = params.get("hub.challenge")

    token_matches = isinstance(token, str) and _constant_time_equal(token, expected_token)
    if mode == "subscribe" and token_matches:
        if challenge is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Challenge de verificação ausente.",
            )
        logger.info("Handshake do webhook Meta validado.")
        return Response(content=challenge, media_type="text/plain", status_code=200)

    logger.warning("Handshake do webhook Meta rejeitado.")
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Token de verificação inválido.",
    )


@router.post("/webhook")
async def receive_meta_webhook(request: Request):
    """Processa somente eventos Meta autenticados e destinados ao número configurado."""
    app_secret = _configured_value("META_APP_SECRET")
    expected_phone_number_id = _configured_value("META_PHONE_NUMBER_ID")
    if not app_secret or not expected_phone_number_id:
        logger.error("Webhook Meta indisponível por configuração incompleta.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Webhook Meta não configurado.",
        )

    raw_body = await _read_limited_body(request)
    received_signature = request.headers.get("x-hub-signature-256", "")
    expected_signature = "sha256=" + hmac.new(
        app_secret.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    if not received_signature or not _constant_time_equal(received_signature, expected_signature):
        logger.warning("Evento do webhook Meta rejeitado por autenticação inválida.")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Assinatura do webhook inválida.",
        )

    try:
        payload = json.loads(raw_body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="JSON do webhook inválido.",
        ) from None

    values = _validate_event_payload(payload, expected_phone_number_id)
    _update_known_statuses(values)

    # Mensagens inbound são reconhecidas, mas não há fluxo de negócio autorizado
    # para armazenar ou processar seu conteúdo nesta fase.
    return {"status": "EVENT_RECEIVED"}

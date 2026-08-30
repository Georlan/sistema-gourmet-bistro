"""Assinatura HMAC-SHA256 e proteção contra replay/drift para webhooks do KÔMA."""

from __future__ import annotations

import hashlib
import hmac
import time
from typing import Any, MutableMapping, Optional, Set


def sign_webhook_payload(
    secret: str,
    payload_bytes: bytes,
    timestamp_str: str,
    event_id: str = "",
    event_name: str = "",
) -> str:
    """Gera a assinatura HMAC-SHA256 vinculando criptograficamente event_id, event_name, timestamp e payload."""
    if event_id or event_name:
        envelope = f"{event_id}:{event_name}:{timestamp_str}.".encode("utf-8")
    else:
        envelope = timestamp_str.encode("utf-8") + b"."
    message = envelope + payload_bytes
    signature = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()
    return f"v1={signature}"


def build_webhook_headers(
    secret: str,
    payload_bytes: bytes,
    event_id: str,
    event_name: str,
    timestamp_str: Optional[str] = None,
) -> dict[str, str]:
    """Constrói todos os cabeçalhos de segurança obrigatórios para entrega de webhooks."""
    ts = timestamp_str or str(int(time.time()))
    signature = sign_webhook_payload(
        secret=secret,
        payload_bytes=payload_bytes,
        timestamp_str=ts,
        event_id=str(event_id),
        event_name=str(event_name),
    )
    return {
        "Content-Type": "application/json",
        "X-Koma-Signature": signature,
        "X-Koma-Timestamp": ts,
        "X-Koma-Event-Id": str(event_id),
        "X-Koma-Event-Type": str(event_name),
    }


def verify_webhook_signature(
    secret: str,
    payload_bytes: bytes,
    signature_header: str,
    timestamp_str: str,
    event_id: str = "",
    event_name: str = "",
    max_drift_seconds: int = 300,
) -> bool:
    """Valida a assinatura do webhook em tempo constante e rejeita requisições fora da janela de drift."""
    if not secret or not signature_header or not timestamp_str:
        return False

    try:
        ts_int = int(timestamp_str)
    except ValueError:
        return False

    now_int = int(time.time())
    if abs(now_int - ts_int) > max_drift_seconds:
        return False

    expected_signature = sign_webhook_payload(
        secret=secret,
        payload_bytes=payload_bytes,
        timestamp_str=timestamp_str,
        event_id=event_id,
        event_name=event_name,
    )
    return hmac.compare_digest(signature_header, expected_signature)


def verify_webhook_envelope(
    secret: str,
    payload_bytes: bytes,
    headers: dict[str, str],
    *,
    processed_event_ids: Optional[Set[str] | MutableMapping[str, Any]] = None,
    max_drift_seconds: int = 300,
) -> tuple[bool, str]:
    """Verificação completa do webhook no receptor: autenticidade, frescor e proteção contra replay."""
    # Normaliza headers (case-insensitive)
    normalized_headers = {k.lower(): v for k, v in headers.items()}
    sig_header = normalized_headers.get("x-koma-signature", "")
    ts_header = normalized_headers.get("x-koma-timestamp", "")
    event_id = normalized_headers.get("x-koma-event-id", "")
    event_type = normalized_headers.get("x-koma-event-type", "")

    if not sig_header or not ts_header or not event_id or not event_type:
        return False, "Missing mandatory security headers (X-Koma-Signature, X-Koma-Timestamp, X-Koma-Event-Id, X-Koma-Event-Type)"

    try:
        ts_int = int(ts_header)
    except ValueError:
        return False, "Invalid timestamp format in X-Koma-Timestamp"

    now_int = int(time.time())
    if abs(now_int - ts_int) > max_drift_seconds:
        return False, f"Timestamp drift ({abs(now_int - ts_int)}s) exceeds max allowed window ({max_drift_seconds}s)"

    # Proteção contra Replay Attack baseada em event_id único
    if processed_event_ids is not None and event_id in processed_event_ids:
        return False, f"Replay attack detected: event_id '{event_id}' has already been processed"

    expected_sig = sign_webhook_payload(
        secret=secret,
        payload_bytes=payload_bytes,
        timestamp_str=ts_header,
        event_id=event_id,
        event_name=event_type,
    )
    if not hmac.compare_digest(sig_header, expected_sig):
        return False, "Invalid HMAC-SHA256 signature"

    if processed_event_ids is not None:
        if isinstance(processed_event_ids, set):
            processed_event_ids.add(event_id)
        else:
            processed_event_ids[event_id] = now_int

    return True, "OK"

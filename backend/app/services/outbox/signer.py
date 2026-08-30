"""Assinatura HMAC-SHA256 e proteção contra replay/drift para webhooks do KÔMA."""

from __future__ import annotations

import hashlib
import hmac
import time
from typing import Optional


def sign_webhook_payload(secret: str, payload_bytes: bytes, timestamp_str: str) -> str:
    """Gera a assinatura HMAC-SHA256 canonical do KÔMA sobre timestamp.payload."""
    message = timestamp_str.encode("utf-8") + b"." + payload_bytes
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
    signature = sign_webhook_payload(secret, payload_bytes, ts)
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
    max_drift_seconds: int = 300,
) -> bool:
    """Valida a assinatura do webhook em tempo constante e rejeita replays fora da janela de drift."""
    if not secret or not signature_header or not timestamp_str:
        return False

    try:
        ts_int = int(timestamp_str)
    except ValueError:
        return False

    now_int = int(time.time())
    if abs(now_int - ts_int) > max_drift_seconds:
        return False

    expected_signature = sign_webhook_payload(secret, payload_bytes, timestamp_str)
    return hmac.compare_digest(signature_header, expected_signature)

from __future__ import annotations

import hashlib
import hmac
import time


def verify_mercado_pago_signature(
    *,
    signature_header: str,
    request_id: str,
    data_id: str,
    secret: str,
    tolerance_seconds: int = 300,
) -> bool:
    """Valida o template oficial id/request-id/ts e limita replay temporal."""
    values: dict[str, str] = {}
    for part in (signature_header or "").split(","):
        key, separator, value = part.strip().partition("=")
        if separator:
            values[key.strip()] = value.strip()
    timestamp = values.get("ts", "")
    received = values.get("v1", "")
    if not timestamp.isdigit() or not received or not request_id or not data_id or not secret:
        return False
    if abs(int(time.time()) - int(timestamp)) > tolerance_seconds:
        return False
    manifest = f"id:{data_id.lower()};request-id:{request_id};ts:{timestamp};"
    expected = hmac.new(secret.encode(), manifest.encode(), hashlib.sha256).hexdigest()
    if hmac.compare_digest(received, expected):
        return True
    if data_id != data_id.lower():
        manifest_exact = f"id:{data_id};request-id:{request_id};ts:{timestamp};"
        expected_exact = hmac.new(secret.encode(), manifest_exact.encode(), hashlib.sha256).hexdigest()
        if hmac.compare_digest(received, expected_exact):
            return True
    return False

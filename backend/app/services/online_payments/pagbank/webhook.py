from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
from typing import Any

logger = logging.getLogger("koma.pagbank.webhook")


def safe_product_origin(value: str | None) -> str:
    """Only retain the provider's documented product category, never raw headers."""
    value = value.strip().upper() if isinstance(value, str) else ''
    return value if value in {'ORDER', 'CHECKOUT'} else 'unknown'


def authenticity_signature_format(value: str | None) -> str:
    """Classify an untrusted header without returning any signature content."""
    if not isinstance(value, str) or not value.strip():
        return 'absent'
    normalized = value.strip().strip('"').strip("'").lower()
    if len(normalized) == 64 and all(char in '0123456789abcdef' for char in normalized):
        return 'sha256_hex'
    return 'other'


def pilot8_ibanking_webhook_token(
    *, restaurant_id: int, environment: str, owner_receiver_pilot_enabled: bool,
) -> str | None:
    """Optional *seller's* iBanking token for legacy Order webhook verification.

    The PagBank Order documentation signs with the receiving account token.
    This credential must never be used for OAuth exchange or payment creation,
    and is intentionally opt-in for the single authorized production pilot.
    """
    if restaurant_id != 8 or environment != 'production' or not owner_receiver_pilot_enabled:
        return None
    return os.getenv('PAGBANK_PRODUCTION_PILOT8_WEBHOOK_IBANKING_TOKEN', '').strip() or None


def extract_webhook_identifiers(payload: Any) -> tuple[str | None, str | None]:
    """Extrai (payment_id, reference_id) de payloads de notificação do PagBank.

    Suporta os formatos documentados da API PagBank:
    - Pedido (Order): id iniciado em 'ORDE_', reference_id do pedido, charges[]
    - Cobrança (Charge): id iniciado em 'CHAR_', reference_id da cobrança, order.id
    - Lista de eventos ou envelope com campo 'data'
    """
    items = payload if isinstance(payload, list) else [payload]
    if not items or not isinstance(items[0], dict):
        return None, None
    item = items[0]

    # Identificador externo PagBank (Order ID ou Charge ID)
    payment_id = (
        item.get("id")
        or (item.get("order", {}).get("id") if isinstance(item.get("order"), dict) else None)
        or (
            item.get("charges", [{}])[0].get("id")
            if isinstance(item.get("charges"), list)
            and item.get("charges")
            and isinstance(item.get("charges")[0], dict)
            else None
        )
        or (item.get("data", {}).get("id") if isinstance(item.get("data"), dict) else None)
    )

    # Identificador de referência interna (external_reference / intent.id)
    reference_id = (
        item.get("reference_id")
        or (item.get("order", {}).get("reference_id") if isinstance(item.get("order"), dict) else None)
        or (
            item.get("charges", [{}])[0].get("reference_id")
            if isinstance(item.get("charges"), list)
            and item.get("charges")
            and isinstance(item.get("charges")[0], dict)
            else None
        )
        or (item.get("data", {}).get("reference_id") if isinstance(item.get("data"), dict) else None)
    )

    return (
        str(payment_id).strip() if payment_id else None,
        str(reference_id).strip() if reference_id else None,
    )


def verify_pagbank_signature(
    *,
    raw_body: bytes,
    authenticity_token: str = "",
    payload_signature: str = "",
    candidate_tokens: list[str] | None = None,
    public_key_b64: str | None = None,
) -> bool:
    """Valida a assinatura de notificações PagBank via SHA-256 ou ECDSA.

    Nunca loga tokens, chaves ou payloads completos.
    Usa hmac.compare_digest para prevenir ataques de tempo (timing attacks).
    """
    candidate_tokens = candidate_tokens or []

    # API Order: SHA256(token + b"-" + EXACT raw HTTP body).
    # Never accept speculative HMAC/no-hyphen algorithms or normalize the
    # signed body; an altered payload must fail authentication.
    if authenticity_token:
        sig = authenticity_token.strip().strip('"').strip("'").lower()
        if len(sig) == 64 and all(char in "0123456789abcdef" for char in sig):
            for token in candidate_tokens:
                if not token:
                    continue
                expected = hashlib.sha256(
                    token.encode("utf-8") + b"-" + raw_body
                ).hexdigest()
                if hmac.compare_digest(sig, expected):
                    return True

    # 2. Validação via header x-payload-signature (ECDSA com SHA-256)
    if payload_signature and public_key_b64:
        try:
            from cryptography.hazmat.primitives import hashes
            from cryptography.hazmat.primitives.asymmetric import ec
            from cryptography.hazmat.primitives.serialization import load_der_public_key, load_pem_public_key

            key_clean = public_key_b64.strip()
            key_bytes = base64.b64decode(key_clean, validate=True)
            try:
                public_key = load_der_public_key(key_bytes)
            except Exception:
                public_key = load_pem_public_key(key_bytes)

            signatures = [s.strip() for s in payload_signature.split(",") if s.strip()]
            for s in signatures:
                sig_bytes = base64.b64decode(s, validate=True)
                try:
                    public_key.verify(sig_bytes, raw_body, ec.ECDSA(hashes.SHA256()))
                    return True
                except Exception:
                    pass
        except Exception:
            logger.warning("Falha ao verificar assinatura assimétrica x-payload-signature PagBank", exc_info=True)

    return False

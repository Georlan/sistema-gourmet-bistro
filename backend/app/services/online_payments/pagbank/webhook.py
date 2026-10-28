from __future__ import annotations

import base64
import hashlib
import hmac
import logging
from typing import Any

logger = logging.getLogger("koma.pagbank.webhook")


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

    # 1. Validação via header x-authenticity-token (SHA-256)
    if authenticity_token:
        sig = authenticity_token.strip().strip('"').strip("'").lower()
        raw_stripped = raw_body.rstrip(b"\r\n")

        for token in candidate_tokens:
            if not token:
                continue
            tok_bytes = token.encode("utf-8")

            # Formato oficial documentado: {token}-{payload}
            h1 = hashlib.sha256(tok_bytes + b"-" + raw_body).hexdigest().lower()
            if hmac.compare_digest(sig, h1):
                return True
            if raw_stripped != raw_body:
                h1_strip = hashlib.sha256(tok_bytes + b"-" + raw_stripped).hexdigest().lower()
                if hmac.compare_digest(sig, h1_strip):
                    return True

            # Formato sem hífen: {token}{payload}
            h2 = hashlib.sha256(tok_bytes + raw_body).hexdigest().lower()
            if hmac.compare_digest(sig, h2):
                return True
            if raw_stripped != raw_body:
                h2_strip = hashlib.sha256(tok_bytes + raw_stripped).hexdigest().lower()
                if hmac.compare_digest(sig, h2_strip):
                    return True

            # Formato HMAC-SHA256
            hm = hmac.new(tok_bytes, raw_body, hashlib.sha256).hexdigest().lower()
            if hmac.compare_digest(sig, hm):
                return True
            if raw_stripped != raw_body:
                hm_strip = hmac.new(tok_bytes, raw_stripped, hashlib.sha256).hexdigest().lower()
                if hmac.compare_digest(sig, hm_strip):
                    return True

    # 2. Validação via header x-payload-signature (ECDSA com SHA-256)
    if payload_signature and public_key_b64:
        try:
            from cryptography.hazmat.primitives import hashes
            from cryptography.hazmat.primitives.asymmetric import ec
            from cryptography.hazmat.primitives.serialization import load_der_public_key, load_pem_public_key

            key_clean = public_key_b64.strip()
            raw_stripped = raw_body.rstrip(b"\r\n")
            key_bytes = base64.b64decode(key_clean)
            try:
                public_key = load_der_public_key(key_bytes)
            except Exception:
                public_key = load_pem_public_key(key_bytes)

            signatures = [s.strip() for s in payload_signature.split(",") if s.strip()]
            for s in signatures:
                sig_bytes = base64.b64decode(s)
                try:
                    public_key.verify(sig_bytes, raw_body, ec.ECDSA(hashes.SHA256()))
                    return True
                except Exception:
                    pass
                if raw_stripped != raw_body:
                    try:
                        public_key.verify(sig_bytes, raw_stripped, ec.ECDSA(hashes.SHA256()))
                        return True
                    except Exception:
                        pass
        except Exception:
            logger.warning("Falha ao verificar assinatura assimétrica x-payload-signature PagBank", exc_info=True)

    return False

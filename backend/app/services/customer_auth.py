"""Authentication primitives for digital-menu customers.

Knowing a phone number is not authentication. The helpers below only issue a
customer session after a one-time code has been verified, and keep the staff
JWT namespace separate through the mandatory ``type=customer`` claim.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import secrets

import jwt

from ..config import settings


CUSTOMER_TOKEN_TYPE = "customer"


@dataclass(frozen=True)
class CustomerTokenClaims:
    cliente_id: str
    restaurante_id: int


def _hmac_hex(purpose: str, value: str) -> str:
    material = f"koma:{purpose}:{value}".encode("utf-8")
    return hmac.new(
        settings.SECRET_KEY.encode("utf-8"),
        material,
        hashlib.sha256,
    ).hexdigest()


def hash_phone_for_otp(restaurante_id: int, telefone: str) -> str:
    return _hmac_hex("customer-otp-phone", f"{restaurante_id}:{telefone}")


def hash_public_rate_key(restaurante_id: int, scope: str, value: str) -> str:
    return _hmac_hex(
        "public-rate-limit",
        f"{restaurante_id}:{scope}:{value}",
    )


def hash_otp(restaurante_id: int, telefone: str, codigo: str) -> str:
    return _hmac_hex(
        "customer-otp-code",
        f"{restaurante_id}:{telefone}:{codigo}",
    )


def otp_matches(
    restaurante_id: int,
    telefone: str,
    codigo: str,
    expected_hash: str,
) -> bool:
    return hmac.compare_digest(
        hash_otp(restaurante_id, telefone, codigo),
        expected_hash,
    )


def generate_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def create_customer_access_token(
    *,
    cliente_id: str,
    restaurante_id: int,
) -> str:
    now = datetime.now(timezone.utc)
    expire_minutes = max(5, settings.CUSTOMER_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": cliente_id,
        "restaurante_id": restaurante_id,
        "type": CUSTOMER_TOKEN_TYPE,
        "role": CUSTOMER_TOKEN_TYPE,
        "iat": now,
        "exp": now + timedelta(minutes=expire_minutes),
        "jti": secrets.token_hex(16),
    }
    return jwt.encode(
        payload,
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )


def decode_customer_access_token(token: str) -> CustomerTokenClaims:
    if not token or not token.strip():
        raise ValueError("Sessão de cliente ausente.")

    try:
        payload = jwt.decode(
            token.strip(),
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
        )
    except jwt.PyJWTError as exc:
        raise ValueError("Sessão de cliente inválida ou expirada.") from exc

    if payload.get("type") != CUSTOMER_TOKEN_TYPE:
        raise ValueError("Tipo de sessão inválido.")

    cliente_id = str(payload.get("sub") or "").strip()
    try:
        restaurante_id = int(payload.get("restaurante_id"))
    except (TypeError, ValueError) as exc:
        raise ValueError("Sessão de cliente incompleta.") from exc

    if not cliente_id or restaurante_id <= 0:
        raise ValueError("Sessão de cliente incompleta.")

    return CustomerTokenClaims(
        cliente_id=cliente_id,
        restaurante_id=restaurante_id,
    )

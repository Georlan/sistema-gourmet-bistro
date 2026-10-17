"""Tenant-scoped, short unsubscribe capabilities.

The URL fragment is never sent to the web server. The signed compact capability
contains only a tenant ID, expiry and tenant-keyed contact digest. Legacy JWTs
remain valid until their original expiry so existing messages do not break.
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import re
import struct
from urllib.parse import quote

import jwt
from sqlalchemy.orm import Session

from ..config import settings
from ..models import WhatsAppContactOptOut
from .central_whatsapp import recipient_fingerprint


# Version + tenant uint32 + expiry unix seconds + 32-byte tenant-scoped digest.
# Truncated 128-bit MAC is domain-separated from login, OTP and other tokens.
_CAPABILITY = struct.Struct("!BII32s")
_CAPABILITY_VERSION = 1
_TAG_LENGTH = 16
_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{76}$")
_DOMAIN = b"koma:whatsapp:opt-out:v1\x00"


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def create_opt_out_token(restaurant_id: int, phone: str) -> str:
    if not 1 <= restaurant_id <= 0xFFFFFFFF:
        raise ValueError("Restaurante inválido.")
    digest = bytes.fromhex(recipient_fingerprint(restaurant_id, phone))
    expiry = int((_now() + dt.timedelta(days=90)).timestamp())
    body = _CAPABILITY.pack(_CAPABILITY_VERSION, restaurant_id, expiry, digest)
    tag = hmac.new(settings.SECRET_KEY.encode("utf-8"), _DOMAIN + body, hashlib.sha256).digest()[:_TAG_LENGTH]
    return base64.urlsafe_b64encode(body + tag).rstrip(b"=").decode("ascii")


def _resolve_compact(token: str) -> tuple[int, str]:
    if not _TOKEN_RE.fullmatch(token):
        raise ValueError
    payload = base64.urlsafe_b64decode(token.encode("ascii"))
    if len(payload) != _CAPABILITY.size + _TAG_LENGTH:
        raise ValueError
    # Accept only a canonical representation; avoid alternative encodings.
    if base64.urlsafe_b64encode(payload).rstrip(b"=").decode("ascii") != token:
        raise ValueError
    body, signature = payload[:-_TAG_LENGTH], payload[-_TAG_LENGTH:]
    expected = hmac.new(settings.SECRET_KEY.encode("utf-8"), _DOMAIN + body, hashlib.sha256).digest()[:_TAG_LENGTH]
    if not hmac.compare_digest(signature, expected):
        raise ValueError
    version, rid, expiry, digest = _CAPABILITY.unpack(body)
    if version != _CAPABILITY_VERSION or rid < 1 or expiry <= int(_now().timestamp()):
        raise ValueError
    return rid, digest.hex()


def _resolve_legacy(token: str) -> tuple[int, str]:
    claims = jwt.decode(
        token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM],
        options={"require": ["exp", "type", "rid", "contact"]},
    )
    rid, digest = int(claims["rid"]), str(claims["contact"])
    if (claims["type"] != "whatsapp_opt_out" or rid < 1 or
        len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest)):
        raise ValueError
    return rid, digest


def resolve_opt_out_token(token: str) -> tuple[int, str]:
    try:
        if not isinstance(token, str) or len(token) > 2048:
            raise ValueError
        return _resolve_legacy(token) if token.count(".") == 2 else _resolve_compact(token)
    except (jwt.PyJWTError, ValueError, TypeError, KeyError, OverflowError):
        raise ValueError("Link de descadastro inválido ou expirado.") from None


def opt_out_url(restaurant_id: int, phone: str) -> str:
    base = settings.KOMA_PUBLIC_APP_URL.rstrip("/")
    if not base.startswith("https://"):
        raise ValueError("URL pública segura não configurada.")
    return f"{base}/whatsapp/avisos#token={quote(create_opt_out_token(restaurant_id, phone), safe='')}"


def block_contact(db: Session, restaurant_id: int, digest: str) -> None:
    # Dialect-native idempotency also handles simultaneous unsubscribe clicks.
    table = WhatsAppContactOptOut.__table__
    if db.get_bind().dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    db.execute(insert(table).values(restaurante_id=restaurant_id, phone_hash=digest,
        created_at=dt.datetime.now(dt.timezone.utc)).on_conflict_do_nothing())

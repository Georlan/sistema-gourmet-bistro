"""Opaque unsubscribe capabilities in URL fragments; legacy signed links remain valid."""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import re
import struct
import secrets

import jwt
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import settings
from ..models import WhatsAppContactOptOut, WhatsAppOptOutCapability
from ..database import tenant_session_scope
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


def create_opt_out_token(restaurant_id: int, phone: str, db: Session, *, marketing_only: bool = False) -> str:
    """One random 192-bit capability per actual send, reusable for 90 days.

    No plaintext token is stored, so it cannot be recovered or reused for later
    messages. Confirmation is idempotent; opening/previewing never consumes it.
    The caller commits before sending and releases the SQL transaction.
    """
    if restaurant_id < 1:
        raise ValueError("Restaurante inválido.")
    token = secrets.token_urlsafe(24)
    db.add(WhatsAppOptOutCapability(
        token_hash=hashlib.sha256(token.encode("ascii")).hexdigest(),
        restaurante_id=restaurant_id,
        phone_hash=recipient_fingerprint(restaurant_id, phone),
        marketing_only=marketing_only,
        expires_at=_now() + dt.timedelta(days=90),
    ))
    db.flush()
    return token


def _resolve_opaque(token: str, db: Session) -> tuple[int, str]:
    digest = hashlib.sha256(token.encode("ascii")).hexdigest()
    if db.get_bind().dialect.name == "postgresql":
        # Discover only the tenant through a fixed-path, narrowly granted lookup;
        # the protected contact identity is read under FORCE RLS below.
        rid = db.execute(text("SELECT restaurante_id FROM koma_internal.lookup_whatsapp_opt_out(:digest)"), {"digest": digest}).scalar()
    else:
        rid = db.query(WhatsAppOptOutCapability.restaurante_id).filter_by(token_hash=digest).scalar()
    if rid is None:
        raise ValueError
    with tenant_session_scope(db, rid):
        row = db.query(WhatsAppOptOutCapability).filter_by(token_hash=digest, restaurante_id=rid).one_or_none()
        if row is None:
            raise ValueError
        expiry = row.expires_at
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=dt.timezone.utc)
        if expiry <= _now():
            raise ValueError
        return rid, row.phone_hash


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


def resolve_opt_out_token(token: str, db: Session | None = None) -> tuple[int, str]:
    try:
        if not isinstance(token, str) or len(token) > 2048:
            raise ValueError
        if re.fullmatch(r"[A-Za-z0-9_-]{32}", token):
            if db is None:
                raise ValueError
            return _resolve_opaque(token, db)
        return _resolve_legacy(token) if token.count(".") == 2 else _resolve_compact(token)
    except (jwt.PyJWTError, ValueError, TypeError, KeyError, OverflowError):
        raise ValueError("Link de descadastro inválido ou expirado.") from None


def opt_out_url(restaurant_id: int, phone: str, db: Session, *, marketing_only: bool = False) -> str:
    base = settings.KOMA_PUBLIC_APP_URL.rstrip("/")
    if not base.startswith("https://"):
        raise ValueError("URL pública segura não configurada.")
    return f"{base}/w/a#{create_opt_out_token(restaurant_id, phone, db, marketing_only=marketing_only)}"


def marketing_only_capability(token: str, db: Session, restaurant_id: int) -> bool:
    # Called only after signature/expiry/tenant resolution. Old compact/signed
    # capabilities retain their original all-notices meaning.
    if not re.fullmatch(r"[A-Za-z0-9_-]{32}", token):
        return False
    with tenant_session_scope(db, restaurant_id):
        return db.query(WhatsAppOptOutCapability.marketing_only).filter_by(
            token_hash=hashlib.sha256(token.encode("ascii")).hexdigest(),
            restaurante_id=restaurant_id).scalar() is True


def block_contact(db: Session, restaurant_id: int, digest: str, *, marketing_only: bool = False) -> None:
    # Dialect-native idempotency also handles simultaneous unsubscribe clicks.
    table = WhatsAppContactOptOut.__table__
    if db.get_bind().dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    statement = insert(table).values(restaurante_id=restaurant_id, phone_hash=digest,
        marketing_only=marketing_only, created_at=dt.datetime.now(dt.timezone.utc))
    # An existing broader cancellation can never be weakened by a promo link.
    db.execute(statement.on_conflict_do_update(
        index_elements=[table.c.restaurante_id, table.c.phone_hash],
        set_={"marketing_only": table.c.marketing_only & statement.excluded.marketing_only}))

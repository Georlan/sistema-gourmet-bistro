"""Scoped opt-out capabilities; no phone or staff/customer authentication tokens."""
from __future__ import annotations

import datetime as dt
from urllib.parse import quote

import jwt
from sqlalchemy.orm import Session

from ..config import settings
from ..models import WhatsAppContactOptOut
from .central_whatsapp import recipient_fingerprint


def create_opt_out_token(restaurant_id: int, phone: str) -> str:
    return jwt.encode({"type": "whatsapp_opt_out", "rid": restaurant_id,
        "contact": recipient_fingerprint(restaurant_id, phone),
        "exp": dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=90)},
        settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def resolve_opt_out_token(token: str) -> tuple[int, str]:
    try:
        claims = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM], options={"require": ["exp", "type", "rid", "contact"]})
        rid, digest = int(claims["rid"]), str(claims["contact"])
        if claims["type"] != "whatsapp_opt_out" or rid < 1 or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            raise ValueError
        return rid, digest
    except (jwt.PyJWTError, ValueError, TypeError, KeyError):
        raise ValueError("Link de descadastro inválido ou expirado.") from None


def opt_out_url(restaurant_id: int, phone: str) -> str:
    base = settings.KOMA_PUBLIC_APP_URL
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

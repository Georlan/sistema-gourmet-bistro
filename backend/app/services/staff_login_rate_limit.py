"""Persistent throttling for staff password authentication.

The login route resolves only minimal candidate identities before binding a
tenant. Rate-limit reads/writes deliberately reuse that request's SQLAlchemy
session instead of opening a second SessionLocal connection. This keeps login
throttling compatible with small PostgreSQL pools under burst concurrency.

The key combines the normalized identifier with the client IP. This blocks a
single source from brute-forcing a staff account without turning the limiter
into an easy global account-lockout primitive.
"""
from __future__ import annotations

import datetime
import os

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import tenant_session_scope
from ..models import PublicRateLimit
from .customer_auth import hash_public_rate_key


_SCOPE = "staff_login_failure_ip"
_MAX_FAILURES = max(3, int(os.getenv("STAFF_LOGIN_MAX_FAILURES", "8")))
_WINDOW_SECONDS = max(60, int(os.getenv("STAFF_LOGIN_WINDOW_SECONDS", "900")))


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _valid_restaurant_ids(restaurante_ids) -> list[int]:
    values: set[int] = set()
    for raw in restaurante_ids:
        if isinstance(raw, bool):
            continue
        try:
            rid = int(raw)
        except (TypeError, ValueError):
            continue
        if rid > 0:
            values.add(rid)
    return sorted(values)


def _key_hash(restaurante_id: int, identifier: str, client_ip: str) -> str:
    raw_key = f"{identifier.strip().lower()}|{client_ip.strip() or 'unknown'}"
    return hash_public_rate_key(restaurante_id, _SCOPE, raw_key)


def _window_is_current(rate: PublicRateLimit, now: datetime.datetime) -> bool:
    started = rate.janela_iniciada_em
    if started.tzinfo is None:
        started = started.replace(tzinfo=datetime.timezone.utc)
    return now - started < datetime.timedelta(seconds=_WINDOW_SECONDS)


def staff_login_is_blocked(
    db: Session,
    restaurante_ids,
    *,
    identifier: str,
    client_ip: str,
) -> bool:
    """Return True when any matching tenant/IP login bucket is exhausted.

    The caller's request session is reused sequentially across candidate tenants;
    ``tenant_session_scope`` releases each transaction before moving on.
    """
    now = _utcnow()
    for restaurante_id in _valid_restaurant_ids(restaurante_ids):
        with tenant_session_scope(db, restaurante_id):
            key_hash = _key_hash(restaurante_id, identifier, client_ip)
            rate = (
                db.query(PublicRateLimit)
                .filter(
                    PublicRateLimit.restaurante_id == restaurante_id,
                    PublicRateLimit.scope == _SCOPE,
                    PublicRateLimit.key_hash == key_hash,
                )
                .first()
            )
            if (
                rate is not None
                and _window_is_current(rate, now)
                and int(rate.requisicoes or 0) >= _MAX_FAILURES
            ):
                return True
    return False


def record_staff_login_failure(
    db: Session,
    restaurante_ids,
    *,
    identifier: str,
    client_ip: str,
) -> bool:
    """Persist one failed attempt and return True when the limit is reached."""
    now = _utcnow()
    blocked = False

    for restaurante_id in _valid_restaurant_ids(restaurante_ids):
        with tenant_session_scope(db, restaurante_id):
            key_hash = _key_hash(restaurante_id, identifier, client_ip)
            rate = (
                db.query(PublicRateLimit)
                .filter(
                    PublicRateLimit.restaurante_id == restaurante_id,
                    PublicRateLimit.scope == _SCOPE,
                    PublicRateLimit.key_hash == key_hash,
                )
                .with_for_update()
                .first()
            )
            created = False

            if rate is None:
                candidate = PublicRateLimit(
                    restaurante_id=restaurante_id,
                    scope=_SCOPE,
                    key_hash=key_hash,
                    janela_iniciada_em=now,
                    requisicoes=1,
                )
                try:
                    with db.begin_nested():
                        db.add(candidate)
                        db.flush([candidate])
                    rate = candidate
                    created = True
                except IntegrityError:
                    rate = (
                        db.query(PublicRateLimit)
                        .filter(
                            PublicRateLimit.restaurante_id == restaurante_id,
                            PublicRateLimit.scope == _SCOPE,
                            PublicRateLimit.key_hash == key_hash,
                        )
                        .with_for_update()
                        .one()
                    )

            if not created:
                if not _window_is_current(rate, now):
                    rate.janela_iniciada_em = now
                    rate.requisicoes = 1
                else:
                    rate.requisicoes = int(rate.requisicoes or 0) + 1

            blocked = blocked or int(rate.requisicoes or 0) >= _MAX_FAILURES
            db.commit()

    return blocked


def clear_staff_login_failures(
    db: Session,
    restaurante_id: int,
    *,
    identifier: str,
    client_ip: str,
) -> None:
    """Clear the successful tenant/IP bucket using the request session."""
    if restaurante_id <= 0:
        return

    with tenant_session_scope(db, restaurante_id):
        key_hash = _key_hash(restaurante_id, identifier, client_ip)
        rate = (
            db.query(PublicRateLimit)
            .filter(
                PublicRateLimit.restaurante_id == restaurante_id,
                PublicRateLimit.scope == _SCOPE,
                PublicRateLimit.key_hash == key_hash,
            )
            .first()
        )
        if rate is not None:
            db.delete(rate)
            db.commit()

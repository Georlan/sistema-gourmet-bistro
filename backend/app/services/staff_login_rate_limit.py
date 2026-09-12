"""Persistent throttling for staff password authentication.

The login route resolves only minimal candidate identities before binding a
tenant. Rate-limit reads/writes deliberately reuse that request's SQLAlchemy
session instead of opening a second SessionLocal connection. This keeps login
throttling compatible with small PostgreSQL pools under burst concurrency.

Two buckets are maintained per tenant and identifier:
- identifier + client IP: low threshold, limiting one source quickly;
- identifier only: higher threshold, limiting distributed/spoofed-source attacks.

The second bucket is intentionally more permissive to avoid turning the limiter
into an easy global account-lockout primitive while still bounding attempts when
the apparent source IP changes on every request.
"""
from __future__ import annotations

import datetime
import os

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import tenant_session_scope
from ..models import PublicRateLimit
from .customer_auth import hash_public_rate_key


_SCOPE_IP = "staff_login_failure_ip"
_SCOPE_ACCOUNT = "staff_login_failure_account"
_MAX_FAILURES_IP = max(3, int(os.getenv("STAFF_LOGIN_MAX_FAILURES", "8")))
_MAX_FAILURES_ACCOUNT = max(
    _MAX_FAILURES_IP,
    int(os.getenv("STAFF_LOGIN_ACCOUNT_MAX_FAILURES", "32")),
)
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


def _key_hash(
    restaurante_id: int,
    scope: str,
    identifier: str,
    client_ip: str | None = None,
) -> str:
    normalized_identifier = identifier.strip().lower()
    if scope == _SCOPE_IP:
        raw_key = f"{normalized_identifier}|{(client_ip or '').strip() or 'unknown'}"
    elif scope == _SCOPE_ACCOUNT:
        raw_key = normalized_identifier
    else:
        raise ValueError(f"Unsupported staff-login rate-limit scope: {scope}")
    return hash_public_rate_key(restaurante_id, scope, raw_key)


def _bucket_specs(restaurante_id: int, identifier: str, client_ip: str):
    return (
        (
            _SCOPE_IP,
            _key_hash(restaurante_id, _SCOPE_IP, identifier, client_ip),
            _MAX_FAILURES_IP,
        ),
        (
            _SCOPE_ACCOUNT,
            _key_hash(restaurante_id, _SCOPE_ACCOUNT, identifier),
            _MAX_FAILURES_ACCOUNT,
        ),
    )


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
    """Return True when any tenant/IP or tenant/account bucket is exhausted.

    The caller's request session is reused sequentially across candidate tenants;
    ``tenant_session_scope`` releases each transaction before moving on.
    """
    now = _utcnow()
    for restaurante_id in _valid_restaurant_ids(restaurante_ids):
        with tenant_session_scope(db, restaurante_id):
            for scope, key_hash, max_failures in _bucket_specs(
                restaurante_id,
                identifier,
                client_ip,
            ):
                rate = (
                    db.query(PublicRateLimit)
                    .filter(
                        PublicRateLimit.restaurante_id == restaurante_id,
                        PublicRateLimit.scope == scope,
                        PublicRateLimit.key_hash == key_hash,
                    )
                    .first()
                )
                if (
                    rate is not None
                    and _window_is_current(rate, now)
                    and int(rate.requisicoes or 0) >= max_failures
                ):
                    return True
    return False


def _increment_bucket(
    db: Session,
    *,
    restaurante_id: int,
    scope: str,
    key_hash: str,
    now: datetime.datetime,
) -> PublicRateLimit:
    rate = (
        db.query(PublicRateLimit)
        .filter(
            PublicRateLimit.restaurante_id == restaurante_id,
            PublicRateLimit.scope == scope,
            PublicRateLimit.key_hash == key_hash,
        )
        .with_for_update()
        .first()
    )
    created = False

    if rate is None:
        candidate = PublicRateLimit(
            restaurante_id=restaurante_id,
            scope=scope,
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
                    PublicRateLimit.scope == scope,
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

    return rate


def record_staff_login_failure(
    db: Session,
    restaurante_ids,
    *,
    identifier: str,
    client_ip: str,
) -> bool:
    """Persist one failed attempt and return True when either limit is reached."""
    now = _utcnow()
    blocked = False

    for restaurante_id in _valid_restaurant_ids(restaurante_ids):
        with tenant_session_scope(db, restaurante_id):
            for scope, key_hash, max_failures in _bucket_specs(
                restaurante_id,
                identifier,
                client_ip,
            ):
                rate = _increment_bucket(
                    db,
                    restaurante_id=restaurante_id,
                    scope=scope,
                    key_hash=key_hash,
                    now=now,
                )
                blocked = blocked or int(rate.requisicoes or 0) >= max_failures
            db.commit()

    return blocked


def clear_staff_login_failures(
    db: Session,
    restaurante_id: int,
    *,
    identifier: str,
    client_ip: str,
) -> None:
    """Clear both source and account buckets after a successful login."""
    if restaurante_id <= 0:
        return

    with tenant_session_scope(db, restaurante_id):
        for scope, key_hash, _max_failures in _bucket_specs(
            restaurante_id,
            identifier,
            client_ip,
        ):
            rate = (
                db.query(PublicRateLimit)
                .filter(
                    PublicRateLimit.restaurante_id == restaurante_id,
                    PublicRateLimit.scope == scope,
                    PublicRateLimit.key_hash == key_hash,
                )
                .first()
            )
            if rate is not None:
                db.delete(rate)
        db.commit()

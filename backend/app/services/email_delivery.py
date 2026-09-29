"""Resend transport and minimal delivery metadata shared by transactional emails."""
import datetime as dt
import hashlib
import json
import logging
import time
from uuid import UUID

import httpx
from sqlalchemy import text

from ..config import settings
from ..signup_models import EmailDeliveryReceipt

logger = logging.getLogger(__name__)
TERMINAL = {'delivered', 'bounced', 'complained', 'failed', 'suppressed'}


def send_email(payload, delivery_id, *, attempts=1, timeout=10):
    """Retry only temporary failures, always with the same provider idempotency key."""
    response = None
    for attempt in range(attempts):
        try:
            response = httpx.post('https://api.resend.com/emails', timeout=timeout,
                headers={'Authorization': f'Bearer {settings.RESEND_API_KEY}', 'Idempotency-Key': delivery_id},
                json=payload)
            if response.is_success or response.status_code not in (429, 500, 502, 503, 504):
                return response
        except httpx.HTTPError:
            if attempt + 1 == attempts:
                raise
        if attempt + 1 < attempts:
            time.sleep(0.25 * 2 ** attempt)
    return response


def message_key(prefix, payload):
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    return f'{prefix}:{digest}'


def provider_email_id(response):
    try:
        return str(UUID(response.json()['id']))
    except (ValueError, KeyError, TypeError, AttributeError):
        return None


def record_acceptance(db, email_id, notification_id):
    if not email_id:
        return
    if db.get_bind().dialect.name == 'postgresql':
        db.execute(text('SELECT koma_internal.record_email_acceptance(:email_id,:notification_id)'),
            {'email_id': email_id, 'notification_id': notification_id})
    else:
        row = db.get(EmailDeliveryReceipt, email_id)
        if row:
            row.notification_id = notification_id
        else:
            db.add(EmailDeliveryReceipt(email_id=email_id, notification_id=notification_id,
                status='sent', occurred_at=dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)))


def record_direct_acceptance(response, notification_id):
    email_id = provider_email_id(response)
    if not email_id:
        return
    from ..database import SessionLocal
    try:
        with SessionLocal() as db:
            record_acceptance(db, email_id, notification_id)
            db.commit()
    except Exception:
        # A delivered email must not cause rollback/replay of its registration.
        logger.warning('Email delivery metadata unavailable')


def record_event(db, email_id, state, occurred_at):
    if db.get_bind().dialect.name == 'postgresql':
        db.execute(text('SELECT koma_internal.record_email_delivery_event(:email_id,:state,:occurred_at)'),
            {'email_id': email_id, 'state': state, 'occurred_at': occurred_at})
        return
    row = db.get(EmailDeliveryReceipt, email_id)
    if not row:
        db.add(EmailDeliveryReceipt(email_id=email_id, status=state, occurred_at=occurred_at))
    else:
        previous = row.occurred_at
        if previous.tzinfo is None:
            previous = previous.replace(tzinfo=dt.timezone.utc)
        if occurred_at >= previous and (row.status not in TERMINAL or state in TERMINAL):
            row.status, row.occurred_at = state, occurred_at

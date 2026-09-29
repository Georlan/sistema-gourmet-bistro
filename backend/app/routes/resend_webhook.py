"""Signed delivery callbacks; discard recipients, subject and message contents."""
import datetime as dt
import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from svix.webhooks import Webhook, WebhookVerificationError

from ..config import settings
from ..database import get_db
from ..services.email_delivery import record_event

router = APIRouter(prefix='/api/webhooks/resend', tags=['Integrações'])
EVENTS = {'email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced',
          'email.complained', 'email.failed', 'email.suppressed'}


@router.post('')
async def receive(request: Request, db: Session = Depends(get_db)):
    if not settings.RESEND_WEBHOOK_SECRET:
        raise HTTPException(503, 'Not configured')
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 65536:
            raise HTTPException(413, 'Payload too large')
    try:
        Webhook(settings.RESEND_WEBHOOK_SECRET).verify(bytes(body), dict(request.headers))
    except (WebhookVerificationError, ValueError):
        raise HTTPException(400, 'Invalid signature') from None
    try:
        payload = json.loads(body)
        event = payload.get('type')
        if event not in EVENTS:
            return {'received': True}
        email_id = str(UUID(payload['data']['email_id']))
        occurred_at = dt.datetime.fromisoformat(payload['created_at'].replace('Z', '+00:00'))
        if occurred_at.tzinfo is None:
            raise ValueError('Missing timezone')
    except (ValueError, KeyError, TypeError, AttributeError):
        raise HTTPException(400, 'Invalid event') from None
    record_event(db, email_id, event.removeprefix('email.'), occurred_at)
    db.commit()
    return {'received': True}

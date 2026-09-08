"""Password recovery shared by staff and menu accounts. No phone-based claiming."""
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import logging
import secrets

import httpx
import jwt

from ..config import settings

logger = logging.getLogger(__name__)


def recovery_key():
    return hmac.new(settings.SECRET_KEY.encode(), b'koma:password-recovery:v1', hashlib.sha256).hexdigest()


def identity_proof(account):
    material = f"{account.restaurante_id}:{account.id}:{account.email}:{account.senha_hash}"
    return hmac.new(recovery_key().encode(), material.encode(), hashlib.sha256).hexdigest()


def issue_recovery_token(account, kind):
    now = datetime.now(timezone.utc)
    return jwt.encode({
        'sub': str(account.id), 'restaurante_id': account.restaurante_id,
        'kind': kind, 'purpose': 'password_recovery', 'proof': identity_proof(account),
        'iat': now, 'exp': now + timedelta(minutes=15), 'jti': secrets.token_hex(32),
    }, recovery_key(), algorithm='HS256')


def decode_recovery_token(token):
    payload = jwt.decode(token, recovery_key(), algorithms=['HS256'], options={'require': ['sub', 'exp', 'iat', 'jti', 'proof']})
    if payload.get('purpose') != 'password_recovery' or payload.get('kind') not in ('staff', 'customer'):
        raise ValueError('Invalid purpose')
    if type(payload.get('restaurante_id')) is not int or payload['restaurante_id'] <= 0:
        raise ValueError('Invalid tenant')
    return payload


def recovery_available():
    return bool(settings.PASSWORD_RECOVERY_ENABLED and settings.RESEND_API_KEY and settings.EMAIL_FROM)


def _safe_restaurant_name(restaurant_name: str | None) -> str:
    # Header/body-safe display value. Restaurant names come from tenant data, so
    # collapse control/newline whitespace and cap the visible length.
    normalized = ' '.join(str(restaurant_name or 'KÔMA').split()).strip()[:80]
    return normalized or 'KÔMA'


def send_recovery_email(email, token, restaurant_name="KÔMA"):
    if not recovery_available():
        return
    # Fixed trusted origin; token in fragment never reaches HTTP/access logs/referrers.
    url = f'{settings.KOMA_PUBLIC_APP_URL}/recuperar-senha#token={token}'
    display_restaurant = _safe_restaurant_name(restaurant_name)
    subject = 'KÔMA — recuperar sua senha'
    if display_restaurant.casefold() != 'kôma'.casefold():
        # A staff e-mail may legitimately be attached to more than one tenant.
        # Make each tenant-scoped token visibly distinguishable without exposing
        # tenant choices before the mailbox owner proves control of the address.
        subject = f'{subject} — {display_restaurant}'
    try:
        response = httpx.post('https://api.resend.com/emails', timeout=10,
            headers={'Authorization': f'Bearer {settings.RESEND_API_KEY}'},
            json={'from': settings.EMAIL_FROM, 'to': [email],
                  'subject': subject,
                  'text': f'Restaurante: {display_restaurant}\n\nVocê solicitou uma nova senha. Abra o link em até 15 minutos:\n\n{url}\n\nO link funciona uma única vez. Se não solicitou, ignore este e-mail.'})
        if not response.is_success:
            logger.warning('Password recovery email delivery failed (status=%s)', response.status_code)
    except httpx.HTTPError:
        # Never log the response, request, recipient or recovery token.
        logger.warning('Password recovery email delivery unavailable')

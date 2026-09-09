"""Password recovery shared by staff and menu accounts. No phone-based claiming."""
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import logging
import secrets
from typing import Iterable

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
    normalized = ' '.join(str(restaurant_name or 'KÔMA').split()).strip()[:80]
    return normalized or 'KÔMA'


def _recovery_url(token: str) -> str:
    # Fixed trusted origin; fragment never reaches HTTP/access logs/referrers.
    return f'{settings.KOMA_PUBLIC_APP_URL}/recuperar-senha#token={token}'


def _post_recovery_email(email: str, *, subject: str, text: str) -> None:
    if not recovery_available():
        return
    try:
        response = httpx.post(
            'https://api.resend.com/emails',
            timeout=10,
            headers={'Authorization': f'Bearer {settings.RESEND_API_KEY}'},
            json={
                'from': settings.EMAIL_FROM,
                'to': [email],
                'subject': subject,
                'text': text,
            },
        )
        if not response.is_success:
            logger.warning('Password recovery email delivery failed (status=%s)', response.status_code)
    except httpx.HTTPError:
        # Never log response body, request payload, recipient or recovery token.
        logger.warning('Password recovery email delivery unavailable')


def send_recovery_email(email, token, restaurant_name="KÔMA"):
    display_restaurant = _safe_restaurant_name(restaurant_name)
    subject = 'KÔMA — recuperar sua senha'
    if display_restaurant.casefold() != 'kôma'.casefold():
        subject = f'{subject} — {display_restaurant}'
    _post_recovery_email(
        email,
        subject=subject,
        text=(
            f'Restaurante: {display_restaurant}\n\n'
            'Você solicitou uma nova senha. Abra o link em até 15 minutos:\n\n'
            f'{_recovery_url(token)}\n\n'
            'O link funciona uma única vez. Se não solicitou, ignore este e-mail.'
        ),
    )


def send_staff_recovery_email(email: str, options: Iterable[dict[str, str]]) -> None:
    """Send one mailbox-scoped message when the same staff e-mail spans tenants.

    Tenant membership is never returned by the unauthenticated HTTP endpoint. It is
    disclosed only inside the already-addressed mailbox, with one tenant-scoped token
    per active account. Tokens keep their normal 15-minute and single-use semantics.
    """
    normalized: list[tuple[str, str]] = []
    for option in options:
        token = str(option.get('token') or '').strip()
        if not token:
            continue
        normalized.append((_safe_restaurant_name(option.get('restaurant_name')), token))
    if not normalized:
        return

    if len(normalized) == 1:
        restaurant_name, token = normalized[0]
        send_recovery_email(email, token, restaurant_name)
        return

    lines = [
        'Você solicitou uma nova senha para uma conta de equipe do KÔMA.',
        '',
        'Este e-mail está associado a mais de um restaurante. Escolha somente o estabelecimento cuja senha deseja alterar:',
        '',
    ]
    for restaurant_name, token in normalized:
        lines.extend([
            f'{restaurant_name}:',
            _recovery_url(token),
            '',
        ])
    lines.extend([
        'Cada link é válido por até 15 minutos e fica inutilizável depois que a senha daquela conta é alterada.',
        'Se não solicitou, ignore este e-mail.',
    ])
    _post_recovery_email(
        email,
        subject='KÔMA — recuperar sua senha',
        text='\n'.join(lines),
    )

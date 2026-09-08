"""Generic responses, tenant scoped identity and atomic single-use password reset."""
from datetime import datetime, timezone
import hmac
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db, tenant_session_scope
from ..models import Cliente, Usuario, Restaurante
from ..security import IPRateLimiter, get_password_hash, revoke_user_sessions
from ..services.password_recovery import (
    decode_recovery_token, identity_proof, issue_recovery_token,
    recovery_available, send_recovery_email,
)
from ..services.public_orders import consume_rate_limit, client_ip
from .auth import _lookup_users_before_tenant

router = APIRouter(prefix='/auth/password-recovery', tags=['Autenticação'])
request_limiter = IPRateLimiter(requests_per_minute=10)
GENERIC_MESSAGE = 'Se existir uma conta com esse e-mail, você receberá um link para criar uma nova senha.'
INVALID_LINK = 'Link inválido ou expirado. Solicite uma nova recuperação.'


class RecoveryRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    kind: Literal['staff', 'customer']
    restaurante_id: int | None = Field(default=None, gt=0)

    @field_validator('email')
    @classmethod
    def normalize_email(cls, value):
        value = value.strip().lower()
        if value.count('@') != 1 or any(c.isspace() for c in value) or '.' not in value.split('@')[-1]:
            raise ValueError('Informe um e-mail válido.')
        return value


class RecoveryConfirm(BaseModel):
    token: str = Field(min_length=20, max_length=2048)
    password: str = Field(min_length=8, max_length=72)

    @field_validator('password')
    @classmethod
    def bcrypt_limit(cls, value):
        if len(value.encode('utf-8')) > 72:
            raise ValueError('A senha deve ter no máximo 72 bytes.')
        return value


@router.post('/request', status_code=202)
def request_recovery(payload: RecoveryRequest, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    request_limiter.check(request)
    if not recovery_available():
        raise HTTPException(503, 'Recuperação de senha indisponível no momento. Tente novamente mais tarde.')
    if payload.kind == 'customer':
        if payload.restaurante_id is None:
            raise HTTPException(422, 'Abra a recuperação pelo cardápio do restaurante.')
        candidates = [{'restaurante_id': payload.restaurante_id}]
    else:
        candidates = _lookup_users_before_tenant(db, payload.email, payload.restaurante_id)
    for candidate in candidates:
        rid = candidate['restaurante_id']
        with tenant_session_scope(db, rid):
            model = Cliente if payload.kind == 'customer' else Usuario
            query = db.query(model).filter(model.restaurante_id == rid, func.lower(model.email) == payload.email)
            if payload.kind == 'staff':
                query = query.filter(Usuario.id == candidate['id'], Usuario.status == 'ativo')
            account = query.first()
            if not account or not account.senha_hash:
                continue  # Guest records are never adopted by password recovery.
            try:
                consume_rate_limit(db, restaurante_id=rid, scope='password_recovery_email', raw_key=payload.email,
                    max_requests=3, window_seconds=900)
                consume_rate_limit(db, restaurante_id=rid, scope='password_recovery_ip', raw_key=client_ip(request),
                    max_requests=10, window_seconds=900)
                db.commit()
            except HTTPException:
                db.rollback()
                continue  # Same public response for unknown, throttled and existing accounts.
            token = issue_recovery_token(account, payload.kind)
            restaurant_name = db.query(Restaurante.nome).filter(Restaurante.id == rid).scalar() or "KÔMA"
            background_tasks.add_task(send_recovery_email, account.email, token, restaurant_name)
    return {'message': GENERIC_MESSAGE}


@router.post('/confirm')
def confirm_recovery(payload: RecoveryConfirm, request: Request, db: Session = Depends(get_db)):
    request_limiter.check(request)
    try:
        claims = decode_recovery_token(payload.token)
    except Exception:
        raise HTTPException(400, INVALID_LINK) from None
    rid = claims['restaurante_id']
    with tenant_session_scope(db, rid):
        model = Cliente if claims['kind'] == 'customer' else Usuario
        account = db.query(model).filter(model.restaurante_id == rid, model.id == claims['sub']).with_for_update().first()
        if (not account or not account.senha_hash or
            (claims['kind'] == 'staff' and account.status != 'ativo') or
            not hmac.compare_digest(identity_proof(account), str(claims['proof']))):
            raise HTTPException(400, INVALID_LINK)
        # Changing the hash invalidates every outstanding recovery token under the same row lock.
        account.senha_hash = get_password_hash(payload.password)
        if claims['kind'] == 'staff':
            revoke_user_sessions(db, user_id=account.id, restaurante_id=rid)
        else:
            account.password_reset_at = datetime.now(timezone.utc)
        db.commit()
    return {'message': 'Senha alterada. Entre novamente com sua nova senha.'}

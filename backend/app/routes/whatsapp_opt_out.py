"""Preview is read-only. Only explicit confirmation blocks a scoped contact."""
import hashlib
import json
import threading
import time
from collections import OrderedDict

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db, tenant_session_scope
from ..models import Restaurante
from ..services.restaurant_public_label import restaurant_public_label
from ..services.whatsapp_opt_out import block_contact, resolve_opt_out_token

# Bounded, per-process abuse guard, shared by preview and confirmation. No DB
# writes for opens/invalid links and no IPs/capabilities retained in cleartext.
_buckets = OrderedDict()
_bucket_lock = threading.Lock()


def _guard(request: Request):
    key = hashlib.sha256((request.client.host if request.client else 'unknown').encode()).digest()
    now = time.monotonic()
    with _bucket_lock:
        while _buckets and next(iter(_buckets.values()))[0] <= now - 60:
            _buckets.popitem(last=False)
        start, count = _buckets.get(key, (now, 0))
        if count >= 20 or (key not in _buckets and len(_buckets) >= 4096):
            raise HTTPException(429, 'Muitas tentativas. Aguarde um minuto.', headers={'Retry-After': '60'})
        _buckets[key] = (start, count + 1)


router = APIRouter(prefix='/api/cardapio/whatsapp', tags=['Cardapio - WhatsApp'], dependencies=[Depends(_guard)])


class OptOutRequest(BaseModel):
    token: str = Field(min_length=32, max_length=2048, repr=False)


async def _body(request: Request) -> OptOutRequest:
    # Do not let validation errors echo a secret token or the submitted body.
    try:
        raw = bytearray()
        async for chunk in request.stream():
            if len(raw) + len(chunk) > 2300:
                raise ValueError
            raw.extend(chunk)
        data = json.loads(raw)
        if not isinstance(data, dict) or set(data) != {'token'}:
            raise ValueError
        return OptOutRequest(**data)
    except (ValueError, TypeError):
        raise HTTPException(404, 'Link de descadastro inválido ou expirado.') from None


def _resolve(body, db):
    try:
        return resolve_opt_out_token(body.token, db)
    except ValueError:
        raise HTTPException(404, 'Link de descadastro inválido ou expirado.') from None


@router.post('/opt-out/preview')
def preview_opt_out(response: Response, body: OptOutRequest = Depends(_body), db: Session = Depends(get_db)):
    response.headers['Cache-Control'] = 'no-store'
    rid, _ = _resolve(body, db)
    with tenant_session_scope(db, rid):
        restaurant = db.query(Restaurante).filter_by(id=rid).one_or_none()
        if restaurant is None:
            raise HTTPException(404, 'Link de descadastro inválido ou expirado.')
        return {'restaurant_name': restaurant_public_label(restaurant)}


@router.post('/opt-out')
def apply_opt_out(body: OptOutRequest = Depends(_body), db: Session = Depends(get_db), response: Response = None):
    if response is not None:
        response.headers['Cache-Control'] = 'no-store'
    rid, digest = _resolve(body, db)
    with tenant_session_scope(db, rid):
        if db.query(Restaurante.id).filter_by(id=rid).scalar() is None:
            raise HTTPException(404, 'Link de descadastro inválido ou expirado.')
        block_contact(db, rid, digest)
        db.commit()
    return {'disabled': True}

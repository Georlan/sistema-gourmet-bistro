"""Bounded confirmation preview and independently authenticated inbound source."""
import hmac
import json
import os
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from ..database import SessionLocal, get_db
from ..services import whatsapp_marketing_consent as consent
from .whatsapp_opt_out import _guard

router=APIRouter(tags=['WhatsApp - consentimento confirmado'])


async def _json(request,limit):
    body=bytearray()
    async for chunk in request.stream():
        if len(body)+len(chunk)>limit: raise HTTPException(413,'Evento excede o limite permitido.')
        body.extend(chunk)
    try:
        value=json.loads(body)
        if not isinstance(value,dict): raise ValueError
        return value
    except (ValueError,TypeError): raise HTTPException(400,'Evento inválido.') from None


@router.post('/api/cardapio/whatsapp/consent/preview',dependencies=[Depends(_guard)])
async def preview(request:Request,response:Response,db:Session=Depends(get_db)):
    response.headers['Cache-Control']='no-store'
    data=await _json(request,2200)
    if set(data)!={'token'} or not isinstance(data['token'],str):
        raise HTTPException(404,'Convite inválido ou expirado.')
    return await run_in_threadpool(consent.preview_invitation,db,data['token'])


def _process(payload):
    with SessionLocal() as db:
        try:
            accepted=consent.process_authenticated_inbound(db,payload)
            db.commit()
            return accepted
        except (HTTPException,ValueError,TypeError):
            db.rollback()
            return False


@router.post('/api/integrations/whatsapp/central/inbound')
async def receive(request:Request):
    # Authenticate BEFORE reading arbitrary bodies or constructing DB sessions.
    if not consent.configured(): raise HTTPException(503,'Canal de entrada não liberado.')
    expected=os.getenv('KOMA_CENTRAL_WA_INBOUND_SECRET','')
    supplied=request.headers.get('x-koma-whatsapp-secret','')
    if not supplied or not hmac.compare_digest(supplied.encode(),expected.encode()):
        raise HTTPException(401,'Origem não autorizada.')
    payload=await _json(request,65536)
    await run_in_threadpool(_process,payload)
    # Do not expose whether a phone/customer/challenge exists to the provider.
    return {'status':'EVENT_RECEIVED'}

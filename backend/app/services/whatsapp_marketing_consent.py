"""Only an authenticated incoming, phone-bound confirmation grants marketing.

Invitation/preview are never interaction proof. Ordinary shared-number messages
are not attributed to every restaurant: this pilot records only confirmations
whose scoped challenge identifies the restaurant. Disabled independently.
"""
from __future__ import annotations
import datetime as dt
import hashlib
import hmac
import os
import re
import secrets
from urllib.parse import urlencode
import jwt
from fastapi import HTTPException
from ..config import settings
from ..crm_models import CrmClientePreferencia
from ..database import tenant_session_scope
from ..models import Cliente, ConfiguracaoRestaurante, Restaurante
from ..timezone_utils import to_utc
from .central_whatsapp import transport_configuration, platform_operator_enabled, recipient_fingerprint, phones_match
from .customer_whatsapp_dispatch import opted_out
from .restaurant_public_label import restaurant_public_label

PURPOSE = 'whatsapp_marketing_consent_v1'


def now():
    return dt.datetime.now(dt.timezone.utc)


def configured():
    return (os.getenv('KOMA_CENTRAL_WA_CONSENT_ENABLED','false').lower() == 'true'
            and len(os.getenv('KOMA_CENTRAL_WA_INBOUND_SECRET','')) >= 32)


def gate(rid=None):
    cfg = transport_configuration()
    if not configured() or cfg is None:
        raise HTTPException(409, 'Confirmação de ofertas pelo WhatsApp ainda não foi liberada.')
    allowed = os.getenv('KOMA_CENTRAL_WA_CONSENT_RESTAURANT_IDS','').split(',')
    if rid is not None and (any(not x.strip().isdecimal() for x in allowed) or int(rid) not in {int(x.strip()) for x in allowed}):
        raise HTTPException(409, 'Confirmação de ofertas indisponível para esta loja.')
    return cfg


def _key():
    return hmac.new(settings.SECRET_KEY.encode(), b'koma:wa-consent:v1', hashlib.sha256).digest()


def _decode(token):
    try:
        if not isinstance(token,str) or not 32 <= len(token) <= 1800: raise ValueError
        claims = jwt.decode(token, _key(), algorithms=['HS256'], options={
            'require':['exp','iat','type','rid','cid','contact','nonce']})
        if claims['type'] != PURPOSE or type(claims['rid']) is not int or claims['rid'] < 1: raise ValueError
        if not isinstance(claims['cid'],str) or not 1 <= len(claims['cid']) <= 128: raise ValueError
        if not re.fullmatch('[0-9a-f]{64}',claims['contact']): raise ValueError
        if not re.fullmatch('[A-Za-z0-9_-]{32}',claims['nonce']): raise ValueError
        return claims
    except (jwt.PyJWTError,ValueError,TypeError,KeyError):
        raise HTTPException(404,'Convite inválido ou expirado.') from None


def _label(db,rid):
    restaurant = db.query(Restaurante).filter_by(id=rid).one_or_none()
    if restaurant is None: raise HTTPException(404,'Convite inválido ou expirado.')
    return ' '.join(restaurant_public_label(restaurant).split())[:100]


def _confirmation_code(rid,cid,digest,nonce):
    # Short, opaque confirmation: the phone/customer binding stays on the
    # server; the full invitation JWT is never sent in the WhatsApp message.
    tag=hmac.new(_key(),f'confirm:{rid}:{cid}:{digest}:{nonce}'.encode(),hashlib.sha256).hexdigest()[:32]
    return f'{rid:x}.{nonce}.{tag}'


def _message(label,code):
    return f'Autorizo receber ofertas de {label} pelo número do KÔMA. Posso cancelar a qualquer momento.\nConfirmar KOMA: {code}'


def _rows(db,rid,cid,*,lock=False):
    client_query = db.query(Cliente).filter_by(restaurante_id=rid,id=cid)
    if lock: client_query=client_query.populate_existing().with_for_update()
    client=client_query.one_or_none()
    if client is None: raise HTTPException(404,'Cliente não encontrado nesta loja.')
    pref_query=db.query(CrmClientePreferencia).filter_by(restaurante_id=rid,cliente_id=cid)
    if lock: pref_query=pref_query.populate_existing().with_for_update()
    return client,pref_query.one_or_none()


def _authorized(db,rid,client,pref):
    config=db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=rid).one_or_none()
    if not platform_operator_enabled(rid,config): raise HTTPException(409,'Canal central indisponível para esta loja.')
    try: digest=recipient_fingerprint(rid,client.telefone)
    except (ValueError,TypeError): raise HTTPException(409,'Telefone inválido.') from None
    if (pref and pref.opt_out_marketing) or opted_out(db,rid,digest,include_marketing=True):
        raise HTTPException(409,'Cliente cancelou o recebimento; nenhum aceite será reativado por este convite.')
    return digest


def prepare_invitation(db,rid,cid):
    gate(rid)  # No SQL or provider work while not released.
    client,pref=_rows(db,rid,cid,lock=True)
    digest=_authorized(db,rid,client,pref)
    if pref is None:
        pref=CrmClientePreferencia(restaurante_id=rid,cliente_id=cid)
        db.add(pref)
    nonce=secrets.token_urlsafe(24)
    expires=now()+dt.timedelta(minutes=30)
    pref.whatsapp_consent_nonce_hash=hashlib.sha256(nonce.encode()).hexdigest()
    pref.whatsapp_consent_expires_at=expires
    claims={'type':PURPOSE,'rid':rid,'cid':str(cid),'contact':digest,'nonce':nonce,'iat':now(),'exp':expires}
    token=jwt.encode(claims,_key(),algorithm='HS256')
    base=settings.KOMA_PUBLIC_APP_URL.rstrip('/')
    if not base.startswith('https://'): raise HTTPException(409,'Endereço público seguro não configurado.')
    # Token is fragment-only; neither the invitation nor copying sends WhatsApp.
    return {'url':f'{base}/w/c#{token}','expires_at':expires.isoformat(),'consent_confirmed':False,
            'restaurant_name':_label(db,rid)}


def preview_invitation(db,token):
    claims=_decode(token);rid=claims['rid'];cfg=gate(rid)
    with tenant_session_scope(db,rid):
        client,pref=_rows(db,rid,claims['cid'])
        digest=_authorized(db,rid,client,pref)
        nonce_hash=hashlib.sha256(claims['nonce'].encode()).hexdigest()
        if (pref is None or digest != claims['contact'] or pref.whatsapp_consent_nonce_hash != nonce_hash
                or to_utc(pref.whatsapp_consent_expires_at) is None or to_utc(pref.whatsapp_consent_expires_at) <= now()):
            raise HTTPException(404,'Convite inválido ou expirado.')
        label=_label(db,rid)
        text=_message(label,_confirmation_code(rid,claims['cid'],digest,claims['nonce']))
        query=urlencode({'text':text})
        return {'restaurant_name':label,'phone_ending':str(client.telefone)[-4:],
                'whatsapp_url':f'https://wa.me/{cfg.sender}?{query}',
                'consent_confirmed':False}


def process_authenticated_inbound(db,payload):
    cfg=gate()
    if not isinstance(payload,dict) or str(payload.get('event','')).replace('_','.').lower() != 'messages.upsert': return False
    if payload.get('instance') != cfg.instance: return False
    business=payload.get('sender')
    if not isinstance(business,str) or not re.fullmatch(r'[0-9]{10,15}(?::[0-9]{1,3})?(?:@s.whatsapp.net)?',business): return False
    if not phones_match(business.split('@')[0].split(':')[0],cfg.sender): return False
    data=payload.get('data');data=data if isinstance(data,dict) else {}
    key=data.get('key');key=key if isinstance(key,dict) else {}
    if key.get('fromMe') is not False: return False
    jid=key.get('remoteJid')
    if not isinstance(jid,str): return False
    alternative=key.get('remoteJidAlt')
    phone_pattern=r'[0-9]{10,15}@s.whatsapp.net'
    if re.fullmatch(r'[0-9]{1,32}@lid',jid):
        # Accept only the authenticated provider's explicit PN mapping. Never
        # infer a phone from a LID or perform extra provider lookups.
        if not isinstance(alternative,str) or not re.fullmatch(phone_pattern,alternative): return False
        jid=alternative
    elif not re.fullmatch(phone_pattern,jid): return False
    elif isinstance(alternative,str) and re.fullmatch(phone_pattern,alternative):
        if not phones_match(jid.split('@')[0],alternative.split('@')[0]): return False
    message_id=key.get('id')
    if not isinstance(message_id,str) or not 1<=len(message_id)<=256: return False
    stamp=data.get('messageTimestamp')
    if isinstance(stamp,bool) or not str(stamp).isdecimal(): return False
    try: timestamp=dt.datetime.fromtimestamp(int(stamp),dt.timezone.utc)
    except (ValueError,OverflowError,OSError): return False
    age=(now()-timestamp).total_seconds()
    if not -60<=age<=600: return False
    message=data.get('message');message=message if isinstance(message,dict) else {}
    extended=message.get('extendedTextMessage');extended=extended if isinstance(extended,dict) else {}
    text=message.get('conversation') or extended.get('text')
    if not isinstance(text,str) or len(text)>2500: return False
    match=re.search(r'\nConfirmar KOMA: ([0-9a-f]{1,8}\.[A-Za-z0-9_-]{32}\.[0-9a-f]{32})$',text.strip())
    if not match: return False
    code=match.group(1)
    prefix,nonce,tag=code.split('.')
    rid=int(prefix,16)
    if not 0<rid<2**31: return False
    try: gate(rid)
    except HTTPException: return False
    with tenant_session_scope(db,rid):
        nonce_hash=hashlib.sha256(nonce.encode()).hexdigest()
        cid=db.query(CrmClientePreferencia.cliente_id).filter_by(restaurante_id=rid,whatsapp_consent_nonce_hash=nonce_hash).scalar()
        if cid is None: return False  # Consumed/unknown challenge: acknowledge without refreshing proof.
        client,pref=_rows(db,rid,cid,lock=True)
        digest=_authorized(db,rid,client,pref)
        if pref is None or not phones_match(client.telefone,jid.split('@')[0]): return False
        expected_code=_confirmation_code(rid,cid,digest,nonce)
        if not hmac.compare_digest(tag,expected_code.rsplit('.',1)[1]): return False
        if text.strip() != _message(_label(db,rid),expected_code): return False
        expires=to_utc(pref.whatsapp_consent_expires_at)
        if (pref.whatsapp_consent_nonce_hash != nonce_hash or expires is None or expires<=now()
                or timestamp < expires-dt.timedelta(minutes=30,seconds=1)): return False
        receipt=hmac.new(_key(),f'{rid}:{message_id}:{code}'.encode(),hashlib.sha256).hexdigest()
        pref.whatsapp_marketing_opt_in=True
        confirmed_at=min(timestamp,now())
        pref.whatsapp_marketing_consented_at=confirmed_at
        pref.whatsapp_interaction_at=confirmed_at
        pref.whatsapp_interaction_phone_hash=digest
        pref.whatsapp_consent_message_hash=receipt
        pref.whatsapp_consent_nonce_hash=None
        pref.whatsapp_consent_expires_at=None
        db.commit()  # Persist while the verified tenant scope is still active.
        return True

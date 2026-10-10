from __future__ import annotations

import datetime
import hashlib
import hmac
import json
import uuid
from urllib.parse import urlencode

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..config import settings
from ..database import get_db, require_tenant_id, tenant_session_scope
from ..models import OnlinePaymentIntent, OnlinePaymentWebhookEvent, Restaurante, RestaurantDirectPixConfig, RestaurantPaymentAccount, Usuario
from ..security import ensure_permission, require_permission
from ..services.online_payments import OnlinePaymentService, OnlinePaymentValidationError
from ..services.online_payments.account_connection import _expires_at
from ..services.online_payments.pagbank import oauth
from ..websocket_manager import manager
from .online_payments import _resolve_account_tenant

router = APIRouter(prefix='/payments', tags=['PagBank'])
class AuthorizationCompletion(BaseModel):
    code: str = Field(min_length=1, max_length=512)
    state: str = Field(min_length=1, max_length=128)


def _account(db, rid):
    return db.query(RestaurantPaymentAccount).filter(RestaurantPaymentAccount.restaurante_id == rid,
                                                   RestaurantPaymentAccount.provider == 'pagbank').first()


@router.get('/pagbank/status')
def connection_status(db: Session = Depends(get_db), user: Usuario = Depends(require_permission('configuracoes:administrar'))):
    account = _account(db, require_tenant_id())
    return {'provider': 'pagbank', 'configured': oauth.configured(), 'environment': oauth.env('PAGBANK_ENV') or 'sandbox',
            'connected': bool(account and account.access_token and account.status == 'active' and account.provider_environment == (oauth.env('PAGBANK_ENV') or 'sandbox')), 'status': account.status if account else 'disconnected',
            'provider_user_id': account.provider_user_id if account else None}


@router.get('/pagbank/connect')
def connect(response: Response, user: Usuario = Depends(require_permission('configuracoes:administrar'))):
    try:
        url, _state = oauth.authorization(require_tenant_id(), str(user.id))
    except oauth.PagBankOAuthError as exc:
        raise HTTPException(503, str(exc)) from exc
    response.headers['Cache-Control'] = 'no-store'
    return {'authorization_url': url}


@router.get('/pagbank/oauth/callback')
def callback(code: str = '', state: str = '', error: str = ''):
    try:
        oauth.decode_state(state, state)
    except oauth.PagBankOAuthError as exc:
        raise HTTPException(400, str(exc)) from exc
    params = {'view': 'caixa', 'pagbank': 'cancelled' if error else 'authorized'}
    if not error:
        if not code or len(code) > 512:
            raise HTTPException(400, 'Retorno OAuth incompleto.')
        params.update(code=code, state=state)
    response = RedirectResponse(settings.KOMA_PUBLIC_APP_URL + '/?' + urlencode(params), status_code=303)
    response.headers['Cache-Control'] = 'no-store'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


@router.post('/pagbank/complete')
def complete(payload: AuthorizationCompletion, db: Session = Depends(get_db),
             user: Usuario = Depends(require_permission('configuracoes:administrar'))):
    code, state = payload.code, payload.state
    try:
        rid, uid = oauth.decode_state(state, state)
    except oauth.PagBankOAuthError as exc:
        raise HTTPException(400, str(exc)) from exc
    if rid != require_tenant_id() or uid != str(user.id):
        raise HTTPException(403, 'Conclua a conexão com o administrador e restaurante que iniciaram a autorização.')
    try:
        with tenant_session_scope(db, rid):
            initiator = db.query(Usuario).filter(Usuario.restaurante_id == rid, Usuario.id == uid).first()
            if initiator is None:
                raise HTTPException(403, 'Usuário indisponível.')
            ensure_permission(initiator, 'configuracoes:administrar')
            tokens = oauth.exchange(code)
            db.query(Restaurante).filter(Restaurante.id == rid).with_for_update().one()
            # Switching receiver must never strand payments in flight.
            pending = db.query(OnlinePaymentIntent.id).filter(OnlinePaymentIntent.restaurante_id == rid,
                OnlinePaymentIntent.status.in_(('created', 'pending', 'error'))).first()
            account = _account(db, rid)
            if pending and (not account or account.provider_user_id != tokens.provider_user_id or account.status != 'active'):
                raise HTTPException(409, 'Resolva os pagamentos pendentes antes de trocar a conta de recebimento.')
            if account is None:
                account = RestaurantPaymentAccount(id=str(uuid.uuid4()), restaurante_id=rid, provider='pagbank')
                db.add(account)
            account.provider_environment = oauth.env('PAGBANK_ENV') or 'sandbox'
            account.provider_user_id = tokens.provider_user_id
            account.access_token = tokens.access_token
            account.refresh_token = tokens.refresh_token
            account.webhook_secret = tokens.access_token
            account.token_expires_at = _expires_at(tokens.expires_in)
            account.status = 'active'
            account.updated_at = datetime.datetime.now(datetime.timezone.utc)
            db.query(RestaurantPaymentAccount).filter(RestaurantPaymentAccount.restaurante_id == rid,
                RestaurantPaymentAccount.provider != 'pagbank').update({'status': 'disconnected'})
            db.query(RestaurantDirectPixConfig).filter(RestaurantDirectPixConfig.restaurante_id == rid).update({'enabled': False})
            db.commit()
    except oauth.PagBankOAuthError as exc:
        db.rollback()
        raise HTTPException(502, 'Não foi possível concluir a conexão PagBank.') from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, 'Conta PagBank já vinculada a outro restaurante.') from exc
    return {'status': 'connected'}


@router.post('/pagbank/disconnect')
def disconnect(db: Session = Depends(get_db), user: Usuario = Depends(require_permission('configuracoes:administrar'))):
    rid = require_tenant_id()
    db.query(Restaurante).filter(Restaurante.id == rid).with_for_update().one()
    account = _account(db, rid)
    if account and account.status == 'active':
        if db.query(OnlinePaymentIntent.id).filter(OnlinePaymentIntent.restaurante_id == rid,
            OnlinePaymentIntent.provider == 'pagbank', OnlinePaymentIntent.status.in_(('created', 'pending', 'error'))).first():
            raise HTTPException(409, 'Resolva os Pix pendentes antes de desconectar.')
        try:
            oauth.revoke(account.access_token)
        except oauth.PagBankOAuthError as exc:
            raise HTTPException(502, 'PagBank não confirmou a desconexão.') from exc
        account.status = 'disconnected'
        account.access_token = ''
        account.refresh_token = None
        db.commit()
    return {'status': 'disconnected'}


@router.post('/webhooks/pagbank/{account_id}')
async def webhook(account_id: str, request: Request, tasks: BackgroundTasks, db: Session = Depends(get_db)):
    raw = await request.body()
    if len(raw) > 262144:
        raise HTTPException(413, 'Notificação muito grande.')
    try:
        payload = json.loads(raw)
        payment_id = payload['id']
    except (ValueError, KeyError, TypeError):
        raise HTTPException(400, 'Notificação inválida.')
    return await run_in_threadpool(_process_webhook, account_id, payment_id, raw,
                                   request.headers.get('x-authenticity-token', ''), tasks, db)


def _process_webhook(account_id: str, payment_id: str, raw: bytes, signature: str, tasks: BackgroundTasks, db: Session):
    rid = _resolve_account_tenant(db, account_id)
    if rid is None:
        raise HTTPException(404, 'Conta não encontrada.')
    with tenant_session_scope(db, int(rid)):
        account = _account(db, rid)
        if not account or account.id != account_id or account.status != 'active' or account.provider_environment != (oauth.env('PAGBANK_ENV') or 'sandbox'):
            raise HTTPException(404, 'Conta não encontrada.')
        # Order API authenticity is SHA256(token + '-' + raw-body), not ECDSA.
        tokens = (account.access_token, account.webhook_secret, oauth.env('PAGBANK_APP_TOKEN'))
        if not any(token and hmac.compare_digest(signature, hashlib.sha256(token.encode() + b'-' + raw).hexdigest()) for token in tokens):
            raise HTTPException(401, 'Assinatura inválida.')
        known = db.query(OnlinePaymentIntent.id).filter(OnlinePaymentIntent.restaurante_id == rid,
            OnlinePaymentIntent.provider == 'pagbank', OnlinePaymentIntent.external_payment_id == payment_id).first()
        if known is None:
            # Retry: a notification can arrive before the create response commits.
            raise HTTPException(503, 'Pagamento ainda não registrado.')
        event_key = hashlib.sha256(account_id.encode() + raw).hexdigest()
        event = db.query(OnlinePaymentWebhookEvent).filter(
            OnlinePaymentWebhookEvent.restaurante_id == rid,
            OnlinePaymentWebhookEvent.provider == 'pagbank',
            OnlinePaymentWebhookEvent.request_id == event_key,
        ).first()
        if event is None:
            event = OnlinePaymentWebhookEvent(restaurante_id=rid, provider='pagbank', request_id=event_key,
                external_payment_id=payment_id, raw_payload={'id': payment_id})
            db.add(event)
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                event = db.query(OnlinePaymentWebhookEvent).filter(
                    OnlinePaymentWebhookEvent.restaurante_id == rid,
                    OnlinePaymentWebhookEvent.provider == 'pagbank',
                    OnlinePaymentWebhookEvent.request_id == event_key,
                ).one()
        try:
            intent, approved = OnlinePaymentService.reconcile_provider_payment(db, account=account, external_payment_id=payment_id)
        except OnlinePaymentValidationError as exc:
            db.rollback()
            raise HTTPException(409, 'Pagamento divergente do pedido.') from exc
        except Exception as exc:
            db.rollback()
            raise HTTPException(503, 'Pagamento ainda não conciliado.') from exc
        event.status = 'processed'
        event.processed_at = datetime.datetime.now(datetime.timezone.utc)
        db.commit()
        if approved and intent is not None:
            tasks.add_task(manager.broadcast, {'event': 'tables_updated'}, int(rid))
            tasks.add_task(manager.broadcast, {'event': 'new_delivery_order', 'message': 'Novo pedido online pago recebido!'}, int(rid))
        return {'status': 'processed'}

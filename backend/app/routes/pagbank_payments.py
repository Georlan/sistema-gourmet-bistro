from __future__ import annotations

import datetime
import hashlib
import hmac
import json
import logging
import os
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
from ..services.online_payments.account_connection import _expires_at, guard_receiver_change, MercadoPagoAccountConnectionError
from ..services.online_payments.pagbank import oauth
from ..services.online_payments.pagbank.webhook import (
    extract_webhook_identifiers, verify_pagbank_signature,
    safe_product_origin, authenticity_signature_format, pilot8_ibanking_webhook_token,
)
from ..websocket_manager import manager
from .online_payments import _resolve_account_tenant

logger = logging.getLogger('koma.pagbank')
router = APIRouter(prefix='/payments', tags=['PagBank'])
class AuthorizationCompletion(BaseModel):
    code: str = Field(min_length=1, max_length=512)
    state: str = Field(min_length=1, max_length=128)


def _account(db, rid):
    return db.query(RestaurantPaymentAccount).filter(RestaurantPaymentAccount.restaurante_id == rid,
                                                   RestaurantPaymentAccount.provider == 'pagbank').first()


@router.get('/pagbank/status')
def connection_status(db: Session = Depends(get_db), user: Usuario = Depends(require_permission('configuracoes:administrar'))):
    rid = require_tenant_id()
    environment = oauth.environment_for_restaurant(rid)
    account = _account(db, rid)
    return {'provider': 'pagbank', 'configured': oauth.configured(environment), 'environment': environment,
            'connected': bool(account and account.access_token and account.status == 'active' and account.provider_environment == environment and not oauth.owner_receiver_blocked(rid, account.provider_user_id, environment=environment)), 'status': account.status if account else 'disconnected',
            'provider_user_id': account.provider_user_id if account else None}


@router.get('/pagbank/connect')
def connect(request: Request, response: Response, user: Usuario = Depends(require_permission('configuracoes:administrar'))):
    try:
        rid = require_tenant_id()
        url, _state = oauth.authorization(rid, str(user.id), return_origin=request.headers.get("origin"))
        oauth.log_sandbox_oauth_evidence('authorization_url_issued', restaurant_id=rid, state=_state)
    except oauth.PagBankOAuthError as exc:
        raise HTTPException(503, str(exc)) from exc
    response.headers['Cache-Control'] = 'no-store'
    return {'authorization_url': url}


@router.get('/pagbank/oauth/callback')
def callback(code: str = '', state: str = '', error: str = ''):
    try:
        rid, _ = oauth.decode_state(state, state)
    except oauth.PagBankOAuthError as exc:
        raise HTTPException(400, str(exc)) from exc
    oauth.log_sandbox_oauth_evidence('callback_received', restaurant_id=rid, state=state,
                                    code_present=bool(code), error_present=bool(error))
    params = {'view': 'caixa', 'pagbank': 'cancelled' if error else 'authorized'}
    if not error:
        if not code or len(code) > 512:
            raise HTTPException(400, 'Retorno OAuth incompleto.')
        params.update(code=code, state=state)
    response = RedirectResponse(oauth.return_origin_for_state(state) + '/?' + urlencode(params), status_code=303)
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
            environment = oauth.environment_for_restaurant(rid)
            tokens = oauth.exchange(code, environment=environment,
                                    evidence_restaurant_id=rid, evidence_state=state)
            # Homologation exception is evidence-only, NOT a connected receiver:
            # no RestaurantPaymentAccount, Pix activation or token persistence.
            # The normal owner block stays enforced in production/all other tenants.
            if oauth.qa9_sandbox_evidence_only(rid):
                oauth.log_sandbox_oauth_evidence('connection_evidence_only', restaurant_id=rid, state=state)
                return {'status': 'sandbox_evidence_captured'}

            if oauth.owner_receiver_blocked(rid, tokens.provider_user_id, environment=environment):
                oauth.log_sandbox_oauth_evidence('connection_rejected_owner', restaurant_id=rid, state=state)
                raise HTTPException(409, 'A conta proprietária da aplicação KÔMA não pode receber vendas como restaurante.')
            guard_receiver_change(db, restaurant_id=rid, provider='pagbank',
                provider_user_id=tokens.provider_user_id, environment=oauth.environment_for_restaurant(rid))
            account = _account(db, rid)
            if account is None:
                account = RestaurantPaymentAccount(id=str(uuid.uuid4()), restaurante_id=rid, provider='pagbank')
                db.add(account)
            account.provider_environment = oauth.environment_for_restaurant(rid)
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
            oauth.log_sandbox_oauth_evidence('connection_completed', restaurant_id=rid, state=state)
    except oauth.PagBankOAuthError as exc:
        db.rollback()
        # Expired or reused authorization codes are recoverable conflicts.
        # Do not disclose code, tokens or arbitrary upstream error responses.
        if exc.reason in {'invalid_grant', '41004'}:
            raise HTTPException(
                409, 'Autorização PagBank expirada ou já utilizada. Inicie uma nova conexão.'
            ) from exc
        if exc.reason in {'41012', 'token_is_no_longer_active', '41008', 'invalid_token'}:
            # The provider code alone does not identify which credential or
            # account relationship is at fault. Preserve the existing account.
            raise HTTPException(
                503,
                'O PagBank recusou a autorização por um problema de credencial. '
                'O suporte KÔMA precisa verificar a integração; '
                'sua conexão anterior foi preservada.',
            ) from exc
        raise HTTPException(502, 'Não foi possível concluir a conexão PagBank.') from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, 'Conta PagBank já vinculada a outro restaurante.') from exc
    except MercadoPagoAccountConnectionError as exc:
        db.rollback()
        raise HTTPException(409, str(exc)) from exc
    return {'status': 'connected'}


@router.get('/pagbank/reconciliation')
def reconciliation_queue(db: Session = Depends(get_db),
                         user: Usuario = Depends(require_permission('configuracoes:administrar'))):
    """Operator recovery queue; never discloses credentials or buyer documents."""
    rid = require_tenant_id()
    intents = db.query(OnlinePaymentIntent).filter(
        OnlinePaymentIntent.restaurante_id == rid,
        OnlinePaymentIntent.provider == 'pagbank',
        ((OnlinePaymentIntent.status.in_(('created', 'pending', 'error')))
         | OnlinePaymentIntent.last_error.isnot(None)),
    ).order_by(OnlinePaymentIntent.created_at).limit(100).all()
    return {'items': [{'id': row.id, 'comanda_id': row.comanda_id, 'status': row.status,
                       'expires_at': row.expires_at, 'last_attempt_at': row.reconciliation_attempted_at,
                       'last_error': row.last_error,
                       'requires_review': bool(row.last_error or (row.expires_at and
                           (row.expires_at.replace(tzinfo=datetime.timezone.utc) if row.expires_at.tzinfo is None else row.expires_at)
                           < datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=15)))} for row in intents]}


@router.post('/pagbank/reconciliation/{intent_id}')
def retry_reconciliation(intent_id: str, db: Session = Depends(get_db),
                         user: Usuario = Depends(require_permission('configuracoes:administrar'))):
    rid = require_tenant_id()
    intent = db.query(OnlinePaymentIntent).filter(
        OnlinePaymentIntent.restaurante_id == rid, OnlinePaymentIntent.id == intent_id,
        OnlinePaymentIntent.provider == 'pagbank',
    ).first()
    if intent is None:
        raise HTTPException(404, 'Pagamento não encontrado.')
    if not intent.external_payment_id:
        raise HTTPException(409, 'Cobrança sem identificador externo; revisão necessária.')
    if not OnlinePaymentService.claim_poll_reconciliation(db, intent):
        return {'status': intent.status, 'queried': False}
    try:
        account = OnlinePaymentService.account_for_intent(db, intent)
        result, approved = OnlinePaymentService.reconcile_provider_payment(
            db, account=account, external_payment_id=intent.external_payment_id)
    except Exception as exc:
        db.rollback()
        db.refresh(intent)
        intent.last_error = 'Consulta financeira indisponível ou divergente; revisão necessária.'
        db.commit()
        raise HTTPException(503, 'Pagamento ainda não conciliado.') from exc
    if approved:
        manager.queue_committed_broadcast(db, {'event': 'tables_updated'}, int(rid))
        manager.queue_committed_broadcast(db, {'event': 'new_delivery_order'}, int(rid))
        db.commit()
    return {'status': result.status if result else intent.status, 'queried': True}


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
            oauth.revoke(account.access_token, environment=account.provider_environment)
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

    authenticity_token = request.headers.get('x-authenticity-token', '').strip()
    payload_signature = request.headers.get('x-payload-signature', '').strip()

    product_origin = safe_product_origin(request.headers.get('x-product-origin'))
    if not authenticity_token and not payload_signature:
        logger.warning(
            'PagBank webhook rejected missing_signature account=%s product_origin=%s',
            account_id, product_origin,
        )
        raise HTTPException(401, 'Assinatura ausente.')

    # Authenticate exact raw bytes before attempting to parse notification data.
    return await run_in_threadpool(
        _process_webhook, account_id, None, raw, authenticity_token,
        tasks, db, payload_signature=payload_signature, product_origin=product_origin,
    )


def _process_webhook(
    account_id: str,
    payment_id: str | None,
    raw: bytes,
    signature: str,
    tasks: BackgroundTasks,
    db: Session,
    reference_id: str | None = None,
    payload_signature: str = "",
    product_origin: str = "unknown",
):
    rid = _resolve_account_tenant(db, account_id)
    if rid is None:
        raise HTTPException(404, 'Conta não encontrada.')
    with tenant_session_scope(db, int(rid)):
        account = _account(db, rid)
        if not account or account.id != account_id or account.status != 'active' or account.provider_environment not in {'sandbox', 'production'}:
            raise HTTPException(404, 'Conta não encontrada.')

        # Only the production owner-receiver pilot (tenant 8) may consider
        # the platform's app token. Do not extend shared signing authorities
        # to independently connected restaurants without provider evidence.
        app_token = (
            oauth.credential('APP_TOKEN', account.provider_environment)
            if oauth.owner_receiver_pilot_enabled(int(rid), environment=account.provider_environment)
            else None
        )
        seller_ibanking_token = pilot8_ibanking_webhook_token(
            restaurant_id=int(rid),
            environment=account.provider_environment,
            owner_receiver_pilot_enabled=oauth.owner_receiver_pilot_enabled(
                int(rid), environment=account.provider_environment,
            ),
        )
        candidate_tokens = list(dict.fromkeys(
            t for t in (account.access_token, account.webhook_secret, app_token, seller_ibanking_token) if t
        ))
        # Seller's iBanking token is never reused as an OAuth bearer or application credential.
        # Card encryption keys are not webhook verification keys.
        public_key = os.getenv('PAGBANK_WEBHOOK_PUBLIC_KEY', '')

        is_valid = verify_pagbank_signature(
            raw_body=raw,
            authenticity_token=signature,
            payload_signature=payload_signature,
            candidate_tokens=candidate_tokens,
            public_key_b64=public_key,
        )

        if not is_valid:
            # Pilot-only, bounded diagnostic metadata. Do not log header values,
            # payload bytes, signatures, tokens, or untrusted bank descriptions.
            if int(rid) == 8 and account.provider_environment == 'production':
                logger.warning(
                    'PagBank webhook authentication rejected tenant=8 origin=%s '
                    'authenticity_format=%s ecdsa_present=%s webhook_public_key_configured=%s '
                    'candidate_count=%d',
                    safe_product_origin(product_origin),
                    authenticity_signature_format(signature),
                    bool(payload_signature), bool(public_key), len(candidate_tokens),
                )
            else:
                logger.warning('PagBank webhook rejected: signature mismatch for account %s', account_id)
            raise HTTPException(401, 'Assinatura divergente.')

        try:
            payload = json.loads(raw) if raw else {}
        except (ValueError, TypeError):
            raise HTTPException(400, 'Notificação inválida.')
        payment_id, reference_id = extract_webhook_identifiers(payload)
        if not payment_id and not reference_id:
            raise HTTPException(400, 'Notificação inválida.')

        # Resolve intent by external_payment_id OR reference_id (which is intent.id)
        intent = None
        if payment_id:
            intent = db.query(OnlinePaymentIntent).filter(
                OnlinePaymentIntent.restaurante_id == rid,
                OnlinePaymentIntent.provider == 'pagbank',
                OnlinePaymentIntent.external_payment_id == payment_id,
            ).first()
        if intent is None and reference_id:
            intent = db.query(OnlinePaymentIntent).filter(
                OnlinePaymentIntent.restaurante_id == rid,
                OnlinePaymentIntent.provider == 'pagbank',
                OnlinePaymentIntent.id == reference_id,
            ).first()

        if intent is None:
            # Retry: a notification can arrive before the create response commits.
            raise HTTPException(503, 'Pagamento ainda não registrado.')

        external_id_to_reconcile = intent.external_payment_id
        if not external_id_to_reconcile:
            # Order creation may still be committing; never query /orders/CHAR_*.
            raise HTTPException(503, 'Cobrança ainda não registrada.')

        event_key = hashlib.sha256(account_id.encode() + raw).hexdigest()
        event = db.query(OnlinePaymentWebhookEvent).filter(
            OnlinePaymentWebhookEvent.restaurante_id == rid,
            OnlinePaymentWebhookEvent.provider == 'pagbank',
            OnlinePaymentWebhookEvent.request_id == event_key,
        ).first()
        if event is not None and event.status in {'processed', 'ignored'}:
            return {'status': 'already_processed'}

        if event is None:
            event = OnlinePaymentWebhookEvent(
                restaurante_id=rid,
                provider='pagbank',
                request_id=event_key,
                external_payment_id=external_id_to_reconcile,
                raw_payload={'id': payment_id, 'reference_id': reference_id},
            )
            db.add(event)
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                event = db.query(OnlinePaymentWebhookEvent).filter(
                    OnlinePaymentWebhookEvent.restaurante_id == rid,
                    OnlinePaymentWebhookEvent.provider == 'pagbank',
                    OnlinePaymentWebhookEvent.request_id == event_key,
                ).first()
                if event is not None and event.status in {'processed', 'ignored'}:
                    return {'status': 'already_processed'}
                if event is None:
                    raise HTTPException(500, 'Erro ao registrar evento de webhook.')
        else:
            event.status = 'received'
            event.last_error = None
            db.commit()

        try:
            settled_intent, approved = OnlinePaymentService.reconcile_provider_payment(
                db,
                account=account,
                external_payment_id=external_id_to_reconcile,
            )
        except OnlinePaymentValidationError as exc:
            db.rollback()
            event.status = 'failed'
            event.last_error = 'Divergência financeira; revisão obrigatória, inclusive pagamento após encerramento.'
            db.commit()
            raise HTTPException(409, 'Pagamento divergente do pedido.') from exc
        except Exception as exc:
            db.rollback()
            event.status = 'failed'
            event.last_error = 'Consulta financeira indisponível; nova tentativa necessária.'
            db.commit()
            raise HTTPException(503, 'Pagamento ainda não conciliado.') from exc

        event = db.query(OnlinePaymentWebhookEvent).filter(
            OnlinePaymentWebhookEvent.restaurante_id == rid,
            OnlinePaymentWebhookEvent.id == event.id,
        ).first()
        if event is not None:
            event.status = 'processed' if settled_intent else 'ignored'
            event.processed_at = datetime.datetime.now(datetime.timezone.utc)
            db.commit()

        if approved and settled_intent is not None:
            tasks.add_task(manager.broadcast, {'event': 'tables_updated'}, int(rid))
            tasks.add_task(
                manager.broadcast,
                {'event': 'new_delivery_order', 'message': 'Novo pedido online pago recebido!'},
                int(rid),
            )
        return {'status': 'processed'}

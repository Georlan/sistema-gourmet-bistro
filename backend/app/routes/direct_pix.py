from __future__ import annotations
import datetime as dt
import re
from decimal import Decimal
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from ..config import settings
from ..subscription import ONLINE_ORDER_COMMISSION_ENABLED
from ..database import get_db, require_tenant_id
from ..models import Comanda, DirectPixReceipt, DirectPixFeeInvoice, OnlinePaymentIntent, RestaurantDirectPixConfig, Usuario
from ..security import require_permission
from ..security import get_current_user
from ..services.online_payments.direct_pix import normalize_key, merchant_text
from ..services.online_payments.base import ProviderPayment
from ..services.online_payments.service import OnlinePaymentService, OnlinePaymentConfigurationError, OnlinePaymentValidationError
from ..services.direct_pix_billing import close_month
from ..services.direct_pix_test_release import TEST_TERMS_VERSION, test_registration_allowed
from ..websocket_manager import manager

router = APIRouter(prefix='/payments/direct-pix', tags=['Pix direto'])
TERMS_VERSION = 'direct-pix-v2-zero-commission'


class PixConfiguration(BaseModel):
    enabled: bool
    key_type: str = Field(max_length=16)
    pix_key: str = Field(min_length=1, max_length=77)
    holder_name: str = Field(min_length=1,max_length=25)
    city: str = Field(min_length=1,max_length=15)
    accept_manual_confirmation_and_monthly_fees: bool = False


class PendingCancellation(BaseModel):
    checked_no_receipt: bool


class ReceiptConfirmation(BaseModel):
    received_amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    bank_reference: str = Field(pattern=r'^E[A-Za-z0-9]{31}$')
    checked_bank_statement: bool


def available():
    if not settings.DIRECT_PIX_ENABLED:
        raise HTTPException(503, 'Pix direto ainda não está disponível.')


def config_payload(config):
    return {'available': settings.DIRECT_PIX_ENABLED, 'enabled': bool(config and config.enabled),
        'key_type': config.key_type if config else 'random', 'pix_key': config.pix_key if config else '',
        'holder_name': config.holder_name if config else '', 'city': config.city if config else '',
        'terms_version': TERMS_VERSION}


@router.get('/settings')
def read_settings(db: Session = Depends(get_db), user: Usuario = Depends(require_permission('configuracoes:administrar'))):
    config = db.query(RestaurantDirectPixConfig).filter(RestaurantDirectPixConfig.restaurante_id == require_tenant_id()).one_or_none()
    from ..services.billing_service import tenant_commercial_terms
    payload = config_payload(config)
    invalid_terms = False
    try:
        terms = tenant_commercial_terms(db, require_tenant_id())
    except RuntimeError:
        terms = None
        invalid_terms = True
    payload['commercial'] = ({'plan': terms.plan, 'billing_cycle': terms.billing_cycle,
        'billing_amount': str(terms.billing_amount), 'marketplace_rate': str(terms.marketplace_rate),
        'legal_version': terms.legal_version} if terms else None)
    payload['test_mode'] = bool(not invalid_terms and terms is None
        and test_registration_allowed(db, require_tenant_id()))
    return payload


@router.put('/settings')
def save_settings(payload: PixConfiguration, db: Session = Depends(get_db), user: Usuario = Depends(require_permission('configuracoes:administrar'))):
    available()
    if payload.enabled and not payload.accept_manual_confirmation_and_monthly_fees:
        raise HTTPException(422, 'Confirme a conferência manual dos recebimentos.')
    try:
        key = normalize_key(payload.key_type,payload.pix_key)
        name = merchant_text(payload.holder_name,25)
        city = merchant_text(payload.city,15)
    except ValueError as exc:
        raise HTTPException(422,str(exc)) from exc
    rest_id = require_tenant_id()
    test_mode = False
    if payload.enabled:
        from ..saas_billing_models import SaaSSubscription
        from ..services.billing_service import tenant_commercial_terms
        try:
            terms = tenant_commercial_terms(db, rest_id)
        except RuntimeError as exc:
            raise HTTPException(409,"Termos comerciais da assinatura indisponíveis.") from exc
        test_mode = terms is None and test_registration_allowed(db, rest_id)
        if not test_mode and ONLINE_ORDER_COMMISSION_ENABLED:
            sub = db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == rest_id).one_or_none()
            if sub is None:
                raise HTTPException(409,"Configure a assinatura antes de ativar Pix direto.")
            if sub.billing_cycle in {'monthly','mensal'} and sub.payment_method_type != 'pix':
                raise HTTPException(409,"A mensalidade atual tem cobrança recorrente. Migre o billing para Pix antes de ativar a fatura consolidada.")
            if terms is None:
                raise HTTPException(409,"Termos comerciais da assinatura indisponíveis.")
    from ..models import Restaurante
    db.query(Restaurante).filter(Restaurante.id == rest_id).with_for_update().one()
    config = db.query(RestaurantDirectPixConfig).filter(RestaurantDirectPixConfig.restaurante_id == rest_id).one_or_none()
    if config is None:
        config = RestaurantDirectPixConfig(restaurante_id=rest_id)
        db.add(config)
    config.enabled = payload.enabled
    config.key_type = payload.key_type
    config.pix_key = key
    config.holder_name = name
    config.city = city
    config.accepted_by = user.id
    config.accepted_at = dt.datetime.now(dt.timezone.utc)
    config.terms_version = TEST_TERMS_VERSION if test_mode else TERMS_VERSION
    if test_mode:
        from ..models import SuperAdminAuditLog
        db.add(SuperAdminAuditLog(restaurante_id=rest_id, actor=str(user.id),
            action='DIRECT_PIX_TEST_ACTIVATED',
            reason='Loja autorizada explicitamente na allowlist de teste; sem contrato ou assinatura.',
            after_data={'enabled': True, 'mode': 'test', 'terms_version': TEST_TERMS_VERSION}))
    db.commit()
    return config_payload(config)


@router.get('/pending')
def pending_receipts(db: Session = Depends(get_db), user: Usuario = Depends(require_permission('caixa:operar'))):
    rows = db.query(OnlinePaymentIntent,Comanda).join(Comanda,Comanda.id == OnlinePaymentIntent.comanda_id).filter(
        OnlinePaymentIntent.restaurante_id == require_tenant_id(), Comanda.restaurante_id == require_tenant_id(),
        OnlinePaymentIntent.provider == 'direct_pix', OnlinePaymentIntent.status.in_(['created','pending']),
    ).order_by(OnlinePaymentIntent.created_at).limit(100).all()
    return [{'id':intent.id, 'order_number':order.numero_pedido, 'customer':order.identificador,
        'amount':str(intent.amount), 'status':'aguardando_aprovacao_pix'} for intent,order in rows]


@router.post('/{intent_id}/confirm')
def confirm_receipt(intent_id: str, payload: ReceiptConfirmation, db: Session = Depends(get_db), user: Usuario = Depends(require_permission('caixa:operar'))):
    # Resolving existing intents remains possible even when the rollout flag is disabled.
    rest_id = require_tenant_id()
    intent = db.query(OnlinePaymentIntent).filter(OnlinePaymentIntent.restaurante_id == rest_id,
        OnlinePaymentIntent.id == intent_id, OnlinePaymentIntent.provider == 'direct_pix').with_for_update().one_or_none()
    if intent is None:
        raise HTTPException(404,'Cobrança não encontrada.')
    if not payload.checked_bank_statement or payload.received_amount != Decimal(str(intent.amount)):
        raise HTTPException(422,'Confira o recebimento do valor integral no extrato bancário.')
    receipt = db.query(DirectPixReceipt).filter(DirectPixReceipt.restaurante_id == rest_id, DirectPixReceipt.intent_id == intent.id).one_or_none()
    if receipt and receipt.bank_reference != payload.bank_reference:
        raise HTTPException(409,'Confirmação anterior tem outra referência bancária.')
    if intent.status not in {'created','pending','approved'}:
        raise HTTPException(409,'Cobrança encerrada não pode ser confirmada.')
    if receipt is None:
        db.add(DirectPixReceipt(intent_id=intent.id,restaurante_id=rest_id,bank_reference=payload.bank_reference,
            confirmed_by=user.id,confirmed_at=dt.datetime.now(dt.timezone.utc),fee=Decimal(str(intent.marketplace_fee))))
    try:
        db.flush()
        _, became_approved = OnlinePaymentService.apply_provider_snapshot_in_session(db,
            account=OnlinePaymentService.account_for_intent(db,intent),intent=intent,
            payment=ProviderPayment(external_id=intent.external_payment_id or f'direct:{intent.id}',status='approved',
                amount=payload.received_amount,external_reference=intent.id))
        if became_approved:
            manager.queue_committed_broadcast(db, {'event':'tables_updated'},rest_id)
        db.commit()
    except (IntegrityError,OnlinePaymentConfigurationError,OnlinePaymentValidationError) as exc:
        db.rollback()
        raise HTTPException(409,'Recebimento já usado ou pedido indisponível para confirmação.') from exc
    return {'status':'approved','already_confirmed':not became_approved}


@router.post('/{intent_id}/cancel')
def cancel_pending(intent_id: str, payload: PendingCancellation, db: Session = Depends(get_db), user: Usuario = Depends(require_permission('caixa:operar'))):
    if not payload.checked_no_receipt:
        raise HTTPException(422,'Confira no extrato que o pagamento não foi recebido antes de cancelar.')
    rest_id = require_tenant_id()
    intent = db.query(OnlinePaymentIntent).filter(OnlinePaymentIntent.restaurante_id == rest_id,
        OnlinePaymentIntent.id == intent_id,OnlinePaymentIntent.provider == 'direct_pix').with_for_update().one_or_none()
    if intent is None:
        raise HTTPException(404,'Cobrança não encontrada.')
    if intent.status == 'approved':
        raise HTTPException(409,'Pix confirmado exige devolução bancária, não cancelamento de cobrança.')
    order = db.query(Comanda).filter(Comanda.restaurante_id == rest_id,Comanda.id == intent.comanda_id).with_for_update().one()
    intent.status = 'cancelled'
    order.online_payment_status = 'cancelled'
    OnlinePaymentService._finalize_unpaid_order_in_session(db,intent=intent,comanda=order)
    manager.queue_committed_broadcast(db,{'event':'tables_updated'},rest_id)
    db.commit()
    return {'status':'cancelled','message':'Cancelamento no KÔMA não invalida o QR no banco. Confira eventuais recebimentos tardios.'}


@router.post('/invoices/close/{period}')
def close_invoice(period: str, db: Session = Depends(get_db), user: Usuario = Depends(require_permission('configuracoes:administrar'))):
    if not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])',period):
        raise HTTPException(422,'Competência inválida.')
    try:
        row = close_month(db,restaurant_id=require_tenant_id(),period=period)
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(409,str(exc)) from exc
    return {'id':row.id,'period':row.period,'fees':str(row.fees),'subscription_amount':str(row.subscription_amount),
        'total':str(row.fees+row.subscription_amount),'status':row.status}


@router.get('/invoices')
def list_invoices(db: Session = Depends(get_db), user: Usuario = Depends(require_permission('configuracoes:administrar'))):
    rows = db.query(DirectPixFeeInvoice).filter(DirectPixFeeInvoice.restaurante_id == require_tenant_id()).order_by(DirectPixFeeInvoice.period.desc()).limit(24).all()
    return [{'id':r.id,'period':r.period,'fees':str(r.fees),'subscription_amount':str(r.subscription_amount),
        'total':str(r.fees+r.subscription_amount),'status':r.status,
        'paid_at': r.paid_at.isoformat() if r.paid_at else None,
        'due_at': r.due_at.isoformat() if r.due_at else None,
        'subscription_due_at': r.subscription_due_at.isoformat() if r.subscription_due_at else None} for r in rows]


@router.post('/invoices/{invoice_id}/pix')
def invoice_pix(invoice_id: str, db: Session = Depends(get_db), user: Usuario = Depends(require_permission('configuracoes:administrar'))):
    from ..services.direct_pix_billing import create_invoice_pix
    from ..services.saas_mercadopago import SaasMercadoPagoError
    try:
        return create_invoice_pix(db,restaurant_id=require_tenant_id(),invoice_id=invoice_id,payer_email=user.email)
    except (ValueError,SaasMercadoPagoError) as exc:
        db.rollback()
        raise HTTPException(409,str(exc)) from exc


@router.get('/invoices/{invoice_id}')
def invoice_statement(invoice_id: str, db: Session = Depends(get_db), user: Usuario = Depends(require_permission('configuracoes:administrar')),
    offset: Annotated[int, Query(ge=0, le=1000000)] = 0):
    tenant = require_tenant_id()
    invoice = db.query(DirectPixFeeInvoice).filter(DirectPixFeeInvoice.id == invoice_id,
        DirectPixFeeInvoice.restaurante_id == tenant).one_or_none()
    if invoice is None:
        raise HTTPException(404, 'Fatura não encontrada.')
    rows = db.query(DirectPixReceipt, OnlinePaymentIntent, Comanda).join(
        OnlinePaymentIntent, OnlinePaymentIntent.id == DirectPixReceipt.intent_id).join(
        Comanda, Comanda.id == OnlinePaymentIntent.comanda_id).filter(
        DirectPixReceipt.invoice_id == invoice.id, DirectPixReceipt.restaurante_id == tenant,
        OnlinePaymentIntent.restaurante_id == tenant, Comanda.restaurante_id == tenant).order_by(
        DirectPixReceipt.confirmed_at, DirectPixReceipt.intent_id).offset(offset).limit(201).all()
    return {'id': invoice.id, 'period': invoice.period, 'fees': str(invoice.fees),
        'subscription_amount': str(invoice.subscription_amount),
        'total': str(invoice.fees + invoice.subscription_amount), 'status': invoice.status,
        'due_at': invoice.due_at.isoformat() if invoice.due_at else None,
        'items': [{'order_number': str(order.numero_pedido), 'amount': str(intent.amount),
            'fee': str(receipt.fee), 'method': intent.method,
            'confirmed_at': receipt.confirmed_at.isoformat()} for receipt, intent, order in rows[:200]],
        'has_more': len(rows) > 200}


@router.get('/billing-status')
def read_billing_status(db: Session = Depends(get_db), user: Usuario = Depends(get_current_user)):
    from ..services.direct_pix_billing import billing_summary
    return billing_summary(db, require_tenant_id())


@router.get('/invoices/{invoice_id}/payment-status')
def invoice_payment_status(invoice_id: str, db: Session = Depends(get_db), user: Usuario = Depends(require_permission('configuracoes:administrar'))):
    from ..services.direct_pix_billing import reconcile_invoice_payment
    from ..services.saas_mercadopago import default_saas_mp_service as provider, SaasMercadoPagoError
    tenant = require_tenant_id()
    row = db.query(DirectPixFeeInvoice.status, DirectPixFeeInvoice.provider_payment_id).filter(
        DirectPixFeeInvoice.restaurante_id == tenant, DirectPixFeeInvoice.id == invoice_id).one_or_none()
    if row is None:
        raise HTTPException(404, 'Fatura não encontrada.')
    if row.status == 'paid':
        return {'status': 'approved'}
    if not row.provider_payment_id:
        return {'status': 'not_generated'}
    payment_id = row.provider_payment_id
    # Release the read transaction before waiting for the provider.
    db.commit()
    try:
        payment = provider.get_payment(payment_id)
        paid = reconcile_invoice_payment(db, restaurant_id=tenant, invoice_id=invoice_id, payment=payment)
        db.commit()
        return {'status': 'approved' if paid else str(payment.get('status') or 'pending')}
    except (ValueError, SaasMercadoPagoError) as exc:
        db.rollback()
        raise HTTPException(409, str(exc)) from exc

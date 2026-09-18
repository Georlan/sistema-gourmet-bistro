"""Self-service subscription management, including the free-trial window."""
from fastapi import APIRouter, Depends, HTTPException, Request, status

from ..database import get_db
from ..models import SuperAdminAuditLog
from ..saas_billing_models import SaaSPlanChange, SaaSSubscription
from ..security import get_current_user
from ..services.saas_billing_policy import (
    is_recurring_trial_payment_method,
    is_trial_eligible_payment_method,
)
from ..services.plan_change_service import apply_plan_change, create_plan_change
from ..services.saas_mercadopago import SaasMercadoPagoError, default_saas_mp_service
from .contracts import ContractAcceptanceRequest

router = APIRouter(prefix='/api/subscription', tags=['Assinatura'])


def administrator(user=Depends(get_current_user)):
    if str(user.cargo or '').lower() not in {'admin', 'superadmin'}:
        raise HTTPException(403, 'Somente o administrador pode gerenciar a assinatura.')
    return user


@router.get('')
def current_subscription(user=Depends(administrator), db=Depends(get_db)):
    sub = db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == user.restaurante_id).one_or_none()
    if sub is None:
        return {'subscription': None}
    normalized_status = str(sub.status or '').strip().lower()
    trial_starts_after_setup = (
        sub.trial_started_at is None
        and normalized_status in {'onboarding', 'suspended'}
    )
    return {
        'subscription': {
            'status': 'onboarding' if trial_starts_after_setup else sub.status,
            'billingCycle': sub.billing_cycle,
            'paymentMethodType': sub.payment_method_type,
            'paidUntil': sub.current_period_end,
            'trialEndsAt': sub.trial_ends_at,
            'trialStartsAfterSetup': trial_starts_after_setup,
            'canCancel': is_trial_eligible_payment_method(sub.payment_method_type) and normalized_status != 'canceled',
        }
    }


@router.get('/plan-change/current')
def current_plan_change(user=Depends(administrator), db=Depends(get_db)):
    change = (
        db.query(SaaSPlanChange)
        .filter(SaaSPlanChange.restaurante_id == user.restaurante_id)
        .order_by(SaaSPlanChange.created_at.desc(), SaaSPlanChange.id.desc())
        .first()
    )
    if change is None:
        return {'planChange': None}
    return {
        'planChange': {
            'id': change.id,
            'status': change.status,
            'sourceProtocol': change.source_protocol,
            'sourcePlan': change.source_plan,
            'targetPlan': change.target_plan,
            'billingCycle': change.billing_cycle,
            'billingAmount': str(change.target_billing_amount),
            'marketplaceRate': str(change.target_marketplace_rate),
            'pricingVersion': change.pricing_version,
            'providerAction': change.provider_action,
            'billingSetupRequired': change.provider_action == 'billing_setup_required',
            'lastErrorCode': change.last_error_code,
            'providerSyncedAt': change.provider_synced_at,
            'appliedAt': change.applied_at,
            'createdAt': change.created_at,
        }
    }


@router.post('/plan-change/accept', status_code=status.HTTP_201_CREATED)
def accept_plan_change(
    payload: ContractAcceptanceRequest,
    request: Request,
    user=Depends(administrator),
    db=Depends(get_db),
):
    return create_plan_change(
        db,
        tenant_id=int(user.restaurante_id),
        user_id=str(user.id),
        payload=payload,
        request=request,
    )


@router.post('/plan-change/{change_id}/apply')
def apply_accepted_plan_change(
    change_id: str,
    user=Depends(administrator),
    db=Depends(get_db),
):
    return apply_plan_change(
        db,
        tenant_id=int(user.restaurante_id),
        user_id=str(user.id),
        change_id=change_id,
    )


@router.post('/cancel')
def cancel_subscription(user=Depends(administrator), db=Depends(get_db)):
    sub = (
        db.query(SaaSSubscription)
        .filter(SaaSSubscription.restaurante_id == user.restaurante_id)
        .with_for_update()
        .one_or_none()
    )
    if sub is None:
        raise HTTPException(404, 'Assinatura não encontrada.')
    if not is_trial_eligible_payment_method(sub.payment_method_type):
        raise HTTPException(409, 'Esta contratação não possui um meio cancelável pelo autoatendimento.')

    if sub.status != 'canceled':
        recurring = is_recurring_trial_payment_method(sub.payment_method_type)
        if recurring:
            if not sub.provider_subscription_id:
                raise HTTPException(409, 'Assinatura sem vínculo com o provedor.')
            try:
                result = default_saas_mp_service.cancel_preapproval(sub.provider_subscription_id)
            except SaasMercadoPagoError as exc:
                raise HTTPException(502, 'Não foi possível confirmar o cancelamento. Tente novamente.') from exc
            if result.get('status') not in {'cancelled', 'canceled'}:
                raise HTTPException(502, 'O provedor ainda não confirmou o cancelamento.')

        previous = sub.status
        sub.status = 'canceled'
        db.add(
            SuperAdminAuditLog(
                restaurante_id=user.restaurante_id,
                actor=f'usuario:{user.id}',
                action='SUBSCRIPTION_CANCEL',
                reason='Cancelamento solicitado pelo administrador do restaurante',
                before_data={'status': previous, 'payment_method_type': sub.payment_method_type},
                after_data={
                    'status': 'canceled',
                    'payment_method_type': sub.payment_method_type,
                    'provider_authorization_canceled': recurring,
                },
            )
        )
        db.commit()

    is_pix = str(sub.payment_method_type or '').strip().lower() == 'pix'
    return {
        'status': 'canceled',
        'paidUntil': sub.current_period_end,
        'message': (
            'Assinatura cancelada. Nenhum novo Pix será gerado; um QR já emitido pode permanecer válido somente até expirar.'
            if is_pix
            else (
                'Cobranças automáticas canceladas. Como o período grátis ainda não havia começado, nenhuma parte dos 7 dias foi consumida.'
                if sub.trial_started_at is None
                else 'Cobranças automáticas canceladas. O acesso permanece até o fim do período vigente, inclusive do trial quando aplicável.'
            )
        ),
    }

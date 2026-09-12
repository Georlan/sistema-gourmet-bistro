"""Self-service cancellation is available even when the paid entitlement expired."""
from fastapi import APIRouter, Depends, HTTPException
from ..database import get_db
from ..models import SuperAdminAuditLog
from ..saas_billing_models import SaaSSubscription
from ..security import get_current_user
from ..services.saas_mercadopago import default_saas_mp_service, SaasMercadoPagoError

router = APIRouter(prefix='/api/subscription', tags=['Assinatura'])

def administrator(user=Depends(get_current_user)):
    if str(user.cargo or '').lower() not in {'admin', 'superadmin'}:
        raise HTTPException(403, 'Somente o administrador pode gerenciar a assinatura.')
    return user

@router.get('')
def current_subscription(user=Depends(administrator), db=Depends(get_db)):
    sub = db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == user.restaurante_id).one_or_none()
    if sub is None: return {'subscription': None}
    return {'subscription': {'status': sub.status, 'billingCycle': sub.billing_cycle,
        'paidUntil': sub.current_period_end, 'trialEndsAt': sub.trial_ends_at,
        'canCancel': sub.payment_method_type == 'credit_card' and sub.status != 'canceled'}}

@router.post('/cancel')
def cancel_subscription(user=Depends(administrator), db=Depends(get_db)):
    sub = db.query(SaaSSubscription).filter(SaaSSubscription.restaurante_id == user.restaurante_id).with_for_update().one_or_none()
    if sub is None: raise HTTPException(404, 'Assinatura não encontrada.')
    if sub.payment_method_type != 'credit_card':
        raise HTTPException(409, 'O Pix anual não possui renovação automática.')
    if sub.status != 'canceled':
        if not sub.provider_subscription_id: raise HTTPException(409, 'Assinatura sem vínculo com o provedor.')
        try:
            result = default_saas_mp_service.cancel_preapproval(sub.provider_subscription_id)
        except SaasMercadoPagoError as exc:
            raise HTTPException(502, 'Não foi possível confirmar o cancelamento. Tente novamente.') from exc
        if result.get('status') != 'cancelled':
            raise HTTPException(502, 'O provedor ainda não confirmou o cancelamento.')
        previous = sub.status
        sub.status = 'canceled'
        db.add(SuperAdminAuditLog(restaurante_id=user.restaurante_id, actor=f'usuario:{user.id}',
            action='SUBSCRIPTION_CANCEL', reason='Cancelamento solicitado pelo administrador do restaurante',
            before_data={'status':previous}, after_data={'status':'canceled'}))
        db.commit()
    return {'status':'canceled', 'paidUntil':sub.current_period_end, 'message':'Renovação cancelada. O acesso permanece até o fim do período vigente.'}

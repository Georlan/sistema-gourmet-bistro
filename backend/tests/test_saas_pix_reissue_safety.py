"""Exercise the billing endpoint with isolated provider/DB fixtures."""
import datetime as dt
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from app.routes import saas_pix
from app.saas_billing_models import SaaSSubscription


@pytest.fixture
def billing(monkeypatch):
    now = dt.datetime.now(dt.timezone.utc)
    due = now - dt.timedelta(days=1)
    subscription = SaaSSubscription(
        restaurante_id=9941, provider='mercado_pago', payment_method_type='pix',
        provider_subscription_id='previous-pix', status='past_due', billing_cycle='monthly',
        trial_started_at=now - dt.timedelta(days=40), trial_ends_at=due,
        current_period_start=due - dt.timedelta(days=30), current_period_end=due,
    )
    db = Mock()
    query = Mock()
    query.filter.return_value.with_for_update.return_value.one_or_none.return_value = subscription
    empty = Mock()
    empty.filter.return_value.one_or_none.return_value = None
    db.query.side_effect = lambda model: query if model is SaaSSubscription else empty
    create = Mock(return_value={'id':'new-pix','status':'pending'})
    monkeypatch.setattr(saas_pix, '_subscription_amount', lambda *_: Decimal('179.90'))
    monkeypatch.setattr(saas_pix, '_create_pix_payment', create)
    monkeypatch.setattr(saas_pix, '_reconcile_pix_payment', lambda *_a, **_k: False)
    return SimpleNamespace(db=db, subscription=subscription, due=due, create=create,
        user=SimpleNamespace(restaurante_id=9941, email='fixture@example.test'))


def provider(monkeypatch, payment):
    monkeypatch.setattr(saas_pix, 'default_saas_mp_service',
        SimpleNamespace(get_payment=lambda _: payment))


@pytest.mark.parametrize('status', ['pending','in_process','authorized'])
def test_expired_qr_never_starts_second_unsettled_charge(monkeypatch, billing, status):
    provider(monkeypatch, {'id':'previous-pix','status':status,
        'date_of_expiration': (billing.due-dt.timedelta(days=1)).isoformat()})
    result = saas_pix.generate_or_get_subscription_pix(billing.user, billing.db)
    assert result['paymentId'] == 'previous-pix'
    assert result['status'] == status
    billing.create.assert_not_called()
    billing.db.commit.assert_not_called()


@pytest.mark.parametrize('status', ['cancelled','rejected','expired'])
def test_provider_terminal_status_allows_one_new_attempt(monkeypatch, billing, status):
    provider(monkeypatch, {'id':'previous-pix','status':status})
    result = saas_pix.generate_or_get_subscription_pix(billing.user, billing.db)
    assert result['paymentId'] == 'new-pix'
    assert billing.create.call_args.kwargs['previous_payment_id'] == 'previous-pix'
    assert billing.subscription.provider_subscription_id == 'new-pix'
    billing.db.commit.assert_called_once()


@pytest.mark.parametrize('status', ['approved', 'refunded', 'charged_back', '', 'unexpected'])
def test_unreconciled_or_unknown_payment_blocks_new_charge(monkeypatch, billing, status):
    provider(monkeypatch, {'id':'previous-pix','status':status})
    with pytest.raises(HTTPException) as exc:
        saas_pix.generate_or_get_subscription_pix(billing.user, billing.db)
    assert exc.value.status_code == 409
    billing.create.assert_not_called()


def test_paid_previous_cycle_does_not_block_next_month(monkeypatch, billing):
    provider(monkeypatch, {'id':'previous-pix','status':'approved',
        'external_reference':saas_pix._pix_reference(9941,billing.subscription.current_period_start)})
    assert saas_pix.generate_or_get_subscription_pix(billing.user,billing.db)['paymentId'] == 'new-pix'
    billing.create.assert_called_once()


def test_current_approved_payment_returns_reconciliation_without_reissue(monkeypatch, billing):
    provider(monkeypatch, {'id':'previous-pix','status':'approved'})
    monkeypatch.setattr(saas_pix,'_reconcile_pix_payment',lambda *_a,**_k: True)
    assert saas_pix.generate_or_get_subscription_pix(billing.user,billing.db)['status'] == 'approved'
    billing.create.assert_not_called()


def test_idempotency_survives_midnight_after_uncertain_post(monkeypatch):
    from app.config import settings
    from app.services.saas_mercadopago import SaasMercadoPagoService
    import httpx
    keys=[]
    def handler(request):
        keys.append(request.headers['X-Idempotency-Key'])
        return httpx.Response(201,json={'id':'fixture-pix'})
    service=SaasMercadoPagoService('fixture-token')
    monkeypatch.setattr(service,'_client',lambda: httpx.Client(base_url=service.API_URL,transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(saas_pix,'default_saas_mp_service',service)
    class Clock(dt.datetime):
        value=dt.datetime(2026,10,20,23,59,tzinfo=dt.timezone.utc)
        @classmethod
        def now(cls,*_): return cls.value
    # Replace the route's datetime namespace, not Python's shared module.
    monkeypatch.setattr(saas_pix,'dt',SimpleNamespace(datetime=Clock,timedelta=dt.timedelta,timezone=dt.timezone))
    kwargs=dict(restaurante_id=9941,amount=Decimal('179.90'),payer_email='fixture@example.test',due_at=Clock.value)
    saas_pix._create_pix_payment(**kwargs)
    Clock.value+=dt.timedelta(minutes=2)
    saas_pix._create_pix_payment(**kwargs)
    assert keys[0] == keys[1]

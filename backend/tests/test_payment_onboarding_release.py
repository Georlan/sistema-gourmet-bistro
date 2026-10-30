"""Release switches and background recovery with isolated fixtures and no bank calls."""
import pytest

from app.database import SessionLocal
from app.models import RestaurantPaymentAccount, OnlinePaymentIntent, CaixaTurno, Comanda
from app.services.online_payments.pagbank import oauth
from app.services.online_payments import reconciliation_worker as worker
from app.services.online_payments.service import OnlinePaymentService
from test_payment_onboarding import onboarding_db, _account, A, B


@pytest.fixture(autouse=True)
def isolated_release_flags(monkeypatch):
    for key in (
        'PAGBANK_PRODUCTION_ONBOARDING_ENABLED', 'PAGBANK_PRODUCTION_RESTAURANT_IDS',
        'PAGBANK_SANDBOX_RESTAURANT_IDS', 'PAGBANK_SANDBOX_QA9_OAUTH_EVIDENCE_ONLY',
        'ONLINE_PAYMENT_RECONCILIATION_CONNECTED_TENANTS_ENABLED', 'ONLINE_PAYMENT_RECONCILIATION_TENANT_IDS',
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv('PAGBANK_ENV', 'sandbox')
    monkeypatch.setattr(worker, '_last_scanned_tenant_id', 0)


def test_general_production_onboarding_is_default_off(monkeypatch):
    assert oauth.environment_for_restaurant(A) == 'sandbox'
    monkeypatch.setenv('PAGBANK_PRODUCTION_RESTAURANT_IDS', str(B))
    assert oauth.environment_for_restaurant(A) == 'sandbox'
    assert oauth.environment_for_restaurant(B) == 'production'


@pytest.mark.parametrize('rid', [6, 8, 9, A, B, 999999])
def test_general_production_release_enrolls_new_restaurant_ids(monkeypatch, rid):
    monkeypatch.setenv('PAGBANK_PRODUCTION_ONBOARDING_ENABLED', 'true')
    assert oauth.environment_for_restaurant(rid) == 'production'


def test_explicit_sandbox_pin_overrides_general_release_and_legacy_allowlist(monkeypatch):
    monkeypatch.setenv('PAGBANK_PRODUCTION_ONBOARDING_ENABLED', 'true')
    monkeypatch.setenv('PAGBANK_PRODUCTION_RESTAURANT_IDS', f'{A},{B}')
    monkeypatch.setenv('PAGBANK_SANDBOX_RESTAURANT_IDS', str(A))
    assert oauth.environment_for_restaurant(A) == 'sandbox'
    assert oauth.environment_for_restaurant(B) == 'production'


def test_general_release_preserves_qa9_evidence_only_and_owner_guard(monkeypatch):
    monkeypatch.setenv('PAGBANK_PRODUCTION_ONBOARDING_ENABLED', 'true')
    monkeypatch.setenv('PAGBANK_SANDBOX_QA9_OAUTH_EVIDENCE_ONLY', 'true')
    monkeypatch.setenv('PAGBANK_PRODUCTION_APPLICATION_OWNER_ACCOUNT_ID', 'owner-isolated')
    monkeypatch.setenv('PAGBANK_PRODUCTION_OWNER_RECEIVER_PILOT8', 'true')
    assert oauth.environment_for_restaurant(9) == 'sandbox'
    assert oauth.owner_receiver_blocked(A, 'owner-isolated', environment='production') is True
    assert oauth.owner_receiver_blocked(6, 'owner-isolated', environment='production') is True
    assert oauth.owner_receiver_blocked(8, 'owner-isolated', environment='production') is False


def _seed_intents(db, rid, provider='pagbank', count=1):
    shift = CaixaTurno(restaurante_id=rid, aberto_por_id=f'onboarding-admin-{rid}', status='aberto', saldo_inicial=0)
    db.add(shift)
    db.flush()
    for number in range(count):
        order = Comanda(id=f'release-order-{rid}-{number}', restaurante_id=rid,
            garcom_id=f'onboarding-admin-{rid}', numero_pedido=number+1, tipo='Delivery', online_payment_status='pending')
        db.add(order)
        db.flush()
        db.add(OnlinePaymentIntent(id=f'release-intent-{rid}-{number}', restaurante_id=rid,
            comanda_id=order.id, turno_id=shift.id, provider=provider, method='pix', status='pending',
            amount=6, marketplace_fee=0, fee_settlement='none', idempotency_key=f'release-key-{rid}-{number}',
            external_payment_id=f'ORDE_release_{rid}_{number}'))
    db.commit()


def _worker_calls(db, monkeypatch, discovered=(A, B)):
    engine = db.get_bind()
    monkeypatch.setattr(worker, 'SessionLocal', lambda: SessionLocal(bind=engine))
    monkeypatch.setattr(worker, 'discover_active_tenant_ids', lambda _: list(discovered))
    calls = []
    monkeypatch.setattr(OnlinePaymentService, 'claim_poll_reconciliation', lambda db, intent: True)
    def fake_reconcile(db, *, account, external_payment_id):
        calls.append((account.restaurante_id, external_payment_id))
        return None, False
    monkeypatch.setattr(OnlinePaymentService, 'reconcile_provider_payment', fake_reconcile)
    return calls


def test_worker_general_enrollment_defaults_off_even_with_connected_accounts(onboarding_db, monkeypatch):
    db = onboarding_db
    account = _account(db)
    account.provider_environment = 'production'
    db.commit()
    _seed_intents(db, A)
    calls = _worker_calls(db, monkeypatch)
    assert worker.reconcile_pending_intents() == 0
    assert calls == []


def test_worker_new_production_receiver_enrolls_without_per_tenant_flag(onboarding_db, monkeypatch):
    db = onboarding_db
    monkeypatch.setenv('PAGBANK_PRODUCTION_ONBOARDING_ENABLED', 'true')
    monkeypatch.setenv('ONLINE_PAYMENT_RECONCILIATION_CONNECTED_TENANTS_ENABLED', 'true')
    account = _account(db)
    account.provider_environment = 'production'
    db.commit()
    _seed_intents(db, A)
    calls = _worker_calls(db, monkeypatch)
    worker.reconcile_pending_intents()
    assert calls == [(A, f'ORDE_release_{A}_0')]


@pytest.mark.parametrize('unusable', ['sandbox', 'missing_token', 'ambiguous'])
def test_general_worker_never_queries_bank_for_unusable_receiver(onboarding_db, monkeypatch, unusable):
    db = onboarding_db
    monkeypatch.setenv('ONLINE_PAYMENT_RECONCILIATION_CONNECTED_TENANTS_ENABLED', 'true')
    account = _account(db)
    if unusable != 'sandbox':
        monkeypatch.setenv('PAGBANK_PRODUCTION_ONBOARDING_ENABLED', 'true')
        account.provider_environment = 'production'
    if unusable == 'missing_token':
        account._access_token = ''
    db.commit()
    if unusable == 'ambiguous':
        _account(db, provider='mercado_pago')
    _seed_intents(db, A)
    calls = _worker_calls(db, monkeypatch)
    worker.reconcile_pending_intents()
    assert calls == []


def test_general_worker_keeps_sweep_bounded_and_rotates_tenants(onboarding_db, monkeypatch):
    db = onboarding_db
    monkeypatch.setenv('PAGBANK_PRODUCTION_ONBOARDING_ENABLED', 'true')
    monkeypatch.setenv('ONLINE_PAYMENT_RECONCILIATION_CONNECTED_TENANTS_ENABLED', 'true')
    for rid in (A, B):
        account = _account(db, rid=rid)
        account.provider_environment = 'production'
        db.commit()
        _seed_intents(db, rid, count=4)
    calls = _worker_calls(db, monkeypatch)
    worker.reconcile_pending_intents(max_per_tenant=2, max_tenants_per_sweep=1)
    assert len(calls) == 2 and {rid for rid, _ in calls} == {A}
    worker.reconcile_pending_intents(max_per_tenant=2, max_tenants_per_sweep=1)
    assert len(calls) == 4 and {rid for rid, _ in calls[2:]} == {B}

import datetime as dt

import pytest

from app.config import settings
from app.models import Restaurante, Usuario
from app.restaurant_profile_models import RestauranteOperationProfile
from app.routes import auth, saas_billing, signups
from app.routes.super_admin import get_current_admin
from app.saas_billing_models import SaaSBillingSetup, SaaSSubscription
from app.services import signup_notifications
from app.services.onboarding_trial import ensure_trial_started_after_onboarding
from app.services.restaurant_provisioning import _operation_profile_for_contract
from app.services.saas_mercadopago import SaasMercadoPagoError, default_saas_mp_service
from app.signup_models import RestaurantSignup, SignupNotification
from test_saas_billing_checkout import client_and_session, _contract_payload

DATA = {
    "restaurant_name": "Novo Bistrô",
    "operation_profile": "generic",
    "responsible_name": "Ana Silva",
    "email": "ana@example.com",
    "phone": "85999999999",
    "plan": "pro",
    "billing_cycle": "mensal",
}


@pytest.fixture()
def signup_client(client_and_session):
    client, Session = client_and_session
    client.app.include_router(signups.router)
    client.app.include_router(signups.admin_router, prefix="/api/super-admin")
    client.app.include_router(auth.router)
    return client, Session


def test_signup_is_persisted_before_payment_and_resume_requires_secret(signup_client):
    client, Session = signup_client
    created = client.post("/api/signups", json=DATA)
    assert created.status_code == 201, created.text
    saved = created.json()
    with Session() as db:
        row = db.query(RestaurantSignup).one()
        assert row.token_hash != saved["token"]
        assert DATA["email"] not in row.payload_encrypted
        assert db.query(SaaSBillingSetup).count() == 0
    assert client.get("/api/signups/current").status_code == 404
    assert client.get("/api/signups/current", headers={"X-Signup-Token": "x" * 43}).status_code == 404
    resumed = client.get("/api/signups/current", headers={"X-Signup-Token": saved["token"]})
    assert resumed.status_code == 200
    assert resumed.json()["data"] == DATA
    assert resumed.headers["cache-control"] == "no-store"


def test_commercial_signup_keeps_operation_profile_until_contract_release(signup_client):
    client, Session = signup_client
    pizza_data = {**DATA, "operation_profile": "pizzaria"}
    saved = client.post("/api/signups", json=pizza_data).json()

    resumed = client.get(
        "/api/signups/current",
        headers={"X-Signup-Token": saved["token"]},
    )
    assert resumed.status_code == 200, resumed.text
    assert resumed.json()["data"]["operation_profile"] == "pizzaria"

    payload = _contract_payload()
    payload.update(request_id=saved["id"], signup_token=saved["token"])
    accepted = client.post("/api/contracts/accept", json=payload)
    assert accepted.status_code == 201, accepted.text

    with Session() as db:
        assert _operation_profile_for_contract(db, accepted.json()["protocol"]) == "pizzaria"


def test_commercial_signup_profile_is_written_when_tenant_is_provisioned(signup_client):
    client, Session = signup_client
    pizza_data = {**DATA, "operation_profile": "pizzaria"}
    saved = client.post("/api/signups", json=pizza_data).json()

    payload = _contract_payload()
    payload.update(request_id=saved["id"], signup_token=saved["token"])
    accepted = client.post("/api/contracts/accept", json=payload)
    assert accepted.status_code == 201, accepted.text
    protocol = accepted.json()["protocol"]

    activated = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "credit_card", "card_token_id": "test-token"},
    )
    assert activated.status_code == 200, activated.text

    with Session() as db:
        profile = db.query(RestauranteOperationProfile).one()
        assert profile.profile_key == "pizzaria"


def test_new_signup_queues_owner_notice_once_before_acceptance(signup_client, monkeypatch):
    client, Session = signup_client
    monkeypatch.setattr(settings, "KOMA_OWNER_EMAIL", "owner@example.com")
    monkeypatch.delenv("KOMA_OWNER_WHATSAPP_PHONE", raising=False)
    created = client.post("/api/signups", json=DATA)
    assert created.status_code == 201, created.text
    with Session() as db:
        notices = db.query(SignupNotification).all()
        assert len(notices) == 1
        assert notices[0].id == f"{created.json()['id']}:signup-started-owner:email"
        assert notices[0].status == "pending"
    updated = client.put(
        "/api/signups/current", json=DATA,
        headers={"X-Signup-Token": created.json()["token"]},
    )
    assert updated.status_code == 200, updated.text
    with Session() as db:
        assert db.query(SignupNotification).count() == 1


def test_new_signup_queues_telegram_only_for_owner(signup_client, monkeypatch):
    client, Session = signup_client
    monkeypatch.setattr(settings, "KOMA_OWNER_EMAIL", "")
    monkeypatch.setenv("KOMA_OWNER_WHATSAPP_PHONE", "5585999999999")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "test-bot-token")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "owner-chat")

    created = client.post("/api/signups", json=DATA)
    assert created.status_code == 201, created.text
    with Session() as db:
        notices = db.query(SignupNotification).all()
        assert [notice.id for notice in notices] == [
            f"{created.json()['id']}:signup-started-owner:telegram"
        ]




def test_onboarding_ready_queues_email_and_telegram_once(signup_client, monkeypatch):
    _, Session = signup_client
    monkeypatch.setattr(settings, "KOMA_OWNER_EMAIL", "owner@example.com")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "test-bot-token")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "owner-chat")

    with Session() as db:
        signup_notifications.enqueue_onboarding_ready_owner(
            db,
            tenant_id=42,
            restaurant_name="Restaurante 42",
            plan="pro",
        )
        db.commit()

    expected_ids = {
        "tenant-42:onboarding-ready-owner:email",
        "tenant-42:onboarding-ready-owner:telegram",
    }
    with Session() as db:
        notices = db.query(SignupNotification).all()
        assert {notice.id for notice in notices} == expected_ids

        signup_notifications.enqueue_onboarding_ready_owner(
            db,
            tenant_id=42,
            restaurant_name="Restaurante 42",
            plan="pro",
        )
        db.commit()

    with Session() as db:
        notices = db.query(SignupNotification).all()
        assert {notice.id for notice in notices} == expected_ids
        assert len(notices) == 2


def test_telegram_delivery_uses_configured_chat_and_rejects_provider_failure(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "test-bot-token")
    calls = []

    class Response:
        is_success = True

        def json(self):
            return {"ok": True}

    def post(url, *, timeout, json):
        calls.append((url, timeout, json))
        return Response()

    monkeypatch.setattr(signup_notifications.httpx, "post", post)
    payload = {"channel": "telegram", "recipient": "owner-chat", "message": "Nova inscrição"}
    signup_notifications._deliver(payload, "protocol:owner:telegram")
    assert calls == [
        (
            "https://api.telegram.org/bottest-bot-token/sendMessage",
            15,
            {"chat_id": "owner-chat", "text": "Nova inscrição"},
        )
    ]

    monkeypatch.setattr(Response, "json", lambda self: {"ok": False})
    with pytest.raises(RuntimeError, match="telegram_provider_rejected"):
        signup_notifications._deliver(payload, "protocol:owner:telegram")


def test_signup_expiry_and_admin_authorization(signup_client):
    client, Session = signup_client
    token = client.post("/api/signups", json=DATA).json()["token"]
    assert client.get("/api/super-admin/signups").status_code in (401, 403)
    client.app.dependency_overrides[get_current_admin] = lambda: {"user": "operator"}
    assert client.get("/api/super-admin/signups").json()["items"][0]["status"] == "started"
    with Session() as db:
        db.query(RestaurantSignup).update(
            {"expires_at": dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=1)}
        )
        db.commit()
    assert client.get("/api/signups/current", headers={"X-Signup-Token": token}).status_code == 404


def test_resume_recovers_accepted_contract_without_duplicate(signup_client):
    client, Session = signup_client
    saved = client.post("/api/signups", json=DATA).json()
    payload = _contract_payload()
    payload.update(request_id=saved["id"], signup_token=saved["token"])
    first = client.post("/api/contracts/accept", json=payload)
    assert first.status_code == 201, first.text
    replay = client.post("/api/contracts/accept", json=payload)
    assert replay.json()["protocol"] == first.json()["protocol"]
    resumed = client.get("/api/signups/current", headers={"X-Signup-Token": saved["token"]})
    assert resumed.json()["receipt"]["protocol"] == first.json()["protocol"]
    with Session() as db:
        assert db.query(SignupNotification).count() == 1


def test_notification_failure_persists_and_retries(signup_client, monkeypatch):
    client, Session = signup_client
    client.post("/api/contracts/accept", json=_contract_payload())
    monkeypatch.setattr(signup_notifications, "SessionLocal", Session)

    def fail(*_args):
        raise RuntimeError("email_not_configured")

    monkeypatch.setattr(signup_notifications, "_deliver", fail)
    signup_notifications.dispatch_batch()
    with Session() as db:
        rows = db.query(SignupNotification).all()
        assert all(row.status == "pending" and row.attempts == 1 for row in rows)
        db.query(SignupNotification).update(
            {"next_attempt_at": dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=1)}
        )
        db.commit()
    sent = []
    monkeypatch.setattr(signup_notifications, "_deliver", lambda payload, key: sent.append(key))
    signup_notifications.dispatch_batch()
    signup_notifications.dispatch_batch()
    assert len(sent) == 1
    with Session() as db:
        assert all(row.status == "sent" and row.payload_encrypted == "" for row in db.query(SignupNotification))


def test_card_without_authorization_never_activates(client_and_session, monkeypatch):
    client, Session = client_and_session
    protocol = client.post("/api/contracts/accept", json=_contract_payload()).json()["protocol"]
    monkeypatch.setattr(
        default_saas_mp_service,
        "create_preapproval",
        lambda **_kwargs: {"id": "unconfirmed", "status": "pending"},
    )
    response = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "credit_card", "card_token_id": "test-token"},
    )
    assert response.status_code == 402
    with Session() as db:
        assert db.query(SaaSSubscription).count() == 0
        assert db.query(SaaSBillingSetup).one().status == "pending"


def test_authorized_card_waits_for_manual_release_and_notifies_owner(client_and_session, monkeypatch):
    client, Session = client_and_session
    monkeypatch.setattr(settings, "KOMA_SAAS_MANUAL_RELEASE_REQUIRED", True)
    monkeypatch.setattr(settings, "KOMA_OWNER_EMAIL", "owner@example.com")
    monkeypatch.setenv("KOMA_OWNER_WHATSAPP_PHONE", "5585999999999")
    protocol = client.post("/api/contracts/accept", json=_contract_payload()).json()["protocol"]

    response = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "credit_card", "card_token_id": "test-token"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "awaiting_release"
    assert response.json().get("restaurantId") is None
    with Session() as db:
        assert db.query(Restaurante).count() == 0
        setup = db.query(SaaSBillingSetup).one()
        assert setup.status == "ready"
        assert setup.restaurante_id is None
        releases = db.query(SignupNotification).filter(
            SignupNotification.id.like(f"{protocol}:release-required:%")
        ).all()
        assert {item.id.rsplit(":", 1)[-1] for item in releases} == {"email"}


def test_account_money_authorization_waits_for_manual_release(client_and_session, monkeypatch):
    client, Session = client_and_session
    monkeypatch.setattr(settings, "KOMA_SAAS_MANUAL_RELEASE_REQUIRED", True)
    protocol = client.post("/api/contracts/accept", json=_contract_payload("pro", "mensal")).json()["protocol"]
    setup = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "account_money"},
    )
    assert setup.status_code == 200, setup.text
    sub_id = setup.json()["subscriptionId"]

    response = client.post(
        "/api/integrations/saas-billing/mercado-pago/webhook",
        json={"type": "subscription_preapproval", "data": {"id": sub_id}},
    )
    assert response.status_code == 200, response.text
    with Session() as db:
        billing = db.query(SaaSBillingSetup).one()
        assert billing.status == "ready"
        assert billing.payment_method_type == "account_money"
        assert billing.restaurante_id is None
        assert db.query(Restaurante).count() == 0
        assert db.query(SaaSSubscription).count() == 0


def test_card_network_timeout_recovers_without_creating_second_mandate(client_and_session, monkeypatch):
    client, Session = client_and_session
    protocol = client.post("/api/contracts/accept", json=_contract_payload()).json()["protocol"]
    calls = []

    def uncertain(**kwargs):
        calls.append(kwargs)
        raise SaasMercadoPagoError("connection lost after provider accepted")

    monkeypatch.setattr(default_saas_mp_service, "create_preapproval", uncertain)
    payload = {"payment_method_type": "credit_card", "card_token_id": "one-time-token"}
    assert client.post(f"/api/contracts/{protocol}/billing/setup", json=payload).status_code == 402

    monkeypatch.setattr(
        default_saas_mp_service,
        "find_preapproval",
        lambda *_args: {
            "id": "recovered-mandate",
            "status": "authorized",
            "external_reference": protocol,
            "payer_id": "payer-recovered",
            "auto_recurring": {
                "transaction_amount": 129,
                "currency_id": "BRL",
                "frequency": 1,
                "frequency_type": "months",
                "free_trial": {"frequency": 7, "frequency_type": "days"},
            },
        },
    )
    recovered = client.post(f"/api/contracts/{protocol}/billing/setup", json=payload)
    assert recovered.status_code == 200, recovered.text
    assert len(calls) == 1
    with Session() as db:
        assert db.query(SaaSSubscription).count() == 1


def test_card_network_recovery_rejects_legacy_amount_for_vnext_contract(
    client_and_session,
    monkeypatch,
):
    client, Session = client_and_session
    protocol = client.post(
        "/api/contracts/accept",
        json=_contract_payload("pro", "mensal"),
    ).json()["protocol"]

    monkeypatch.setattr(
        default_saas_mp_service,
        "create_preapproval",
        lambda **_kwargs: (_ for _ in ()).throw(
            SaasMercadoPagoError("connection lost after provider accepted")
        ),
    )
    payload = {
        "payment_method_type": "credit_card",
        "card_token_id": "one-time-token",
    }
    assert (
        client.post(
            f"/api/contracts/{protocol}/billing/setup",
            json=payload,
        ).status_code
        == 402
    )

    monkeypatch.setattr(
        default_saas_mp_service,
        "find_preapproval",
        lambda *_args: {
            "id": "legacy-value-mandate",
            "status": "authorized",
            "external_reference": protocol,
            "payer_id": "payer-legacy-value",
            "auto_recurring": {
                "transaction_amount": 209,
                "currency_id": "BRL",
                "free_trial": {"frequency": 7, "frequency_type": "days"},
            },
        },
    )
    recovered = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json=payload,
    )
    assert recovered.status_code == 409, recovered.text
    assert "valor diferente do contrato" in recovered.text

    with Session() as db:
        assert db.query(SaaSSubscription).count() == 0
        setup = db.query(SaaSBillingSetup).one()
        assert setup.status == "pending"


def test_superadmin_release_preserves_trial_until_onboarding_is_complete(signup_client, monkeypatch):
    client, Session = signup_client
    monkeypatch.setattr(settings, "KOMA_SAAS_MANUAL_RELEASE_REQUIRED", True)
    monkeypatch.setattr(settings, "KOMA_OWNER_EMAIL", "owner@example.com")
    protocol = client.post("/api/contracts/accept", json=_contract_payload()).json()["protocol"]

    setup_res = client.post(
        f"/api/contracts/{protocol}/billing/setup",
        json={"payment_method_type": "credit_card", "card_token_id": "test-token"},
    )
    assert setup_res.status_code == 200
    assert setup_res.json()["status"] == "awaiting_release"
    with Session() as db:
        assert db.query(Restaurante).count() == 0

    client.app.dependency_overrides[get_current_admin] = lambda: {"user": "super_operator"}
    release = client.post(
        f"/api/super-admin/signups/{protocol}/release",
        json={"reason": "Homologação de liberação recorrente"},
    )
    assert release.status_code == 200, release.text
    released = release.json()
    assert released["status"] == "activated"
    assert released["trial_status"] == "onboarding"
    assert released["trial_ends_at"] is None

    with Session() as db:
        sub = db.query(SaaSSubscription).one()
        tenant_id = sub.restaurante_id
        assert sub.status == "onboarding"
        assert sub.payment_method_type == "credit_card"
        assert sub.trial_started_at is None
        assert sub.trial_ends_at is None
        assert sub.current_period_start is None
        assert sub.current_period_end is None

    sync_calls = []
    monkeypatch.setattr(
        default_saas_mp_service,
        "update_preapproval_next_payment_date",
        lambda sub_id, date: sync_calls.append((sub_id, date)) or {
            "id": sub_id,
            "next_payment_date": date.isoformat(),
            "status": "authorized",
        },
    )
    with Session() as db:
        started = ensure_trial_started_after_onboarding(
            db,
            restaurante_id=tenant_id,
            actor="test:onboarding-complete",
        )
        assert started is not None
        assert started["status"] == "trialing"
        sub = db.query(SaaSSubscription).one()
        assert sub.status == "trialing"
        assert sub.trial_started_at is not None
        assert sub.trial_ends_at is not None
        assert (sub.trial_ends_at - sub.trial_started_at).days in (6, 7)
        first_end = sub.trial_ends_at

    assert len(sync_calls) == 1

    # Idempotência: recarregar o onboarding não renova nem empurra o trial.
    with Session() as db:
        repeated = ensure_trial_started_after_onboarding(
            db,
            restaurante_id=tenant_id,
            actor="test:repeat",
        )
        assert repeated is not None
        assert repeated["trial_ends_at"] == first_end
    assert len(sync_calls) == 1


def test_expired_failed_delivery_erases_private_payload(signup_client, monkeypatch):
    client, Session = signup_client
    client.post("/api/contracts/accept", json=_contract_payload())
    with Session() as db:
        db.query(SignupNotification).update(
            {
                "status": "failed",
                "expires_at": dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=1),
            }
        )
        db.commit()
    monkeypatch.setattr(signup_notifications, "SessionLocal", Session)
    signup_notifications.dispatch_batch()
    with Session() as db:
        assert all(
            row.payload_encrypted == "" and row.last_error == "expired"
            for row in db.query(SignupNotification)
        )


def test_signup_channels_never_enqueue_whatsapp_even_when_enabled(signup_client, monkeypatch):
    _, Session = signup_client
    monkeypatch.setattr(settings, "KOMA_WHATSAPP_AUTOMATION_ENABLED", True)
    with Session() as db:
        signup_notifications.enqueue(db, protocol="channel-policy", kind="activation",
            email="customer@example.test", phone="5585999999999", telegram_chat="owner-chat",
            subject="Ativação", message="Teste")
        db.commit()
        ids = {row.id for row in db.query(SignupNotification).all()}
        assert ids == {"channel-policy:activation:email", "channel-policy:activation:telegram"}


def test_event_attribution_counts_signup_contract_and_account_without_manual_crm_conversion(signup_client):
    from app.models import KomaEventLead
    from app.services.event_acquisition import EVENT, signup_url, funnel_stats
    client, Session = signup_client
    with Session() as db:
        from app.models import KomaEventVisit, KomaEventAttribution
        for model in (KomaEventLead, KomaEventVisit, KomaEventAttribution):
            model.__table__.create(db.get_bind(), checkfirst=True)
        lead = KomaEventLead(nome='Evento Cliente', whatsapp_raw='85999999999',
            whatsapp_normalizado='5585999999999', event_slug=EVENT, source='qr_tela',
            consent_whatsapp=True, consent_at=dt.datetime.now(dt.timezone.utc), status='new')
        db.add(lead)
        db.commit()
        token = signup_url(lead).split('event_ref=')[1]
        before = funnel_stats(db)
    created = client.post('/api/signups', json={**DATA, 'event_ref': token})
    assert created.status_code == 201, created.text
    saved = created.json()
    with Session() as db:
        started = funnel_stats(db)
        assert started['signups'] == before['signups'] + 1
        assert started['confirmed_plans'] == before['confirmed_plans']
        assert started['accounts'] == before['accounts']
    payload = _contract_payload()
    payload.update(request_id=saved['id'], signup_token=saved['token'])
    accepted = client.post('/api/contracts/accept', json=payload)
    assert accepted.status_code == 201, accepted.text
    with Session() as db:
        assert funnel_stats(db)['confirmed_plans'] == before['confirmed_plans']
    activated = client.post(f"/api/contracts/{accepted.json()['protocol']}/billing/setup",
        json={'payment_method_type': 'credit_card', 'card_token_id': 'test-token'})
    assert activated.status_code == 200, activated.text
    with Session() as db:
        confirmed = funnel_stats(db)
        assert confirmed['confirmed_plans'] == before['confirmed_plans'] + 1
        assert confirmed['accounts'] == before['accounts'] + 1

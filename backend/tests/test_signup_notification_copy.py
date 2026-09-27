from __future__ import annotations

import datetime

from app.services import signup_notifications


def _capture_enqueue(monkeypatch):
    calls = []

    def capture(db, **kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(signup_notifications, "enqueue", capture)
    return calls


def test_trial_release_queues_customer_and_owner_once_per_channel(monkeypatch):
    calls = _capture_enqueue(monkeypatch)
    monkeypatch.setattr(signup_notifications.settings, "KOMA_OWNER_EMAIL", "owner@example.com")
    monkeypatch.delenv("KOMA_OWNER_WHATSAPP_PHONE", raising=False)
    signup_notifications.enqueue_trial_started(
        object(), tenant_id=42, restaurant_name="Restaurante QA", plan="pro",
        billing_cycle="annual", customer_name="Ana", customer_email="ana@example.com",
        customer_phone="5584999999999",
        trial_ends_at=datetime.datetime(2026, 10, 4, 12, tzinfo=datetime.timezone.utc),
    )
    assert [item["kind"] for item in calls] == ["trial-started-customer", "trial-started-owner"]
    assert all(item["protocol"] == "tenant-42" for item in calls)
    assert "plano pro (anual)" in calls[0]["message"].lower()
    assert "04/10/2026" in calls[0]["message"]
    assert "Nenhuma mensalidade fixa foi cobrada" in calls[0]["message"]


def test_acceptance_message_does_not_claim_upfront_payment(monkeypatch):
    calls = _capture_enqueue(monkeypatch)
    monkeypatch.delenv("KOMA_OWNER_WHATSAPP_PHONE", raising=False)
    monkeypatch.setattr(signup_notifications.settings, "KOMA_OWNER_EMAIL", "")

    signup_notifications.enqueue_acceptance(
        object(),
        protocol="KOMA-CTR-20260913-ABCDEF123456",
        restaurant_name="Restaurante QA",
        representative_name="Ana",
        email="ana@example.com",
        phone="5584999999999",
    )

    assert len(calls) == 1
    message = calls[0]["message"]
    assert "R$ 0 hoje" in message
    assert "7 dias grátis" in message
    assert "escolha o meio de pagamento" in message
    assert "meio de pagamento recorrente" not in message
    assert "Conclua o pagamento para liberar" not in message


def test_acceptance_notifies_owner_by_email_without_requiring_whatsapp(monkeypatch):
    calls = _capture_enqueue(monkeypatch)
    monkeypatch.delenv("KOMA_OWNER_WHATSAPP_PHONE", raising=False)
    monkeypatch.setattr(signup_notifications.settings, "KOMA_OWNER_EMAIL", "owner@example.com")

    signup_notifications.enqueue_acceptance(
        object(),
        protocol="KOMA-CTR-20260913-ABCDEF123456",
        restaurant_name="Restaurante QA",
        representative_name="Ana",
        email="ana@example.com",
        phone="5584999999999",
    )

    assert len(calls) == 2
    owner = calls[1]
    assert owner["kind"] == "owner"
    assert owner["email"] == "owner@example.com"
    assert owner["phone"] is None
    assert owner["subject"] == "Nova inscrição iniciada — KÔMA"
    assert "Acompanhe o status na aba Inscrições do SuperAdmin" in owner["message"]


def test_release_required_message_describes_authorization_not_payment(monkeypatch):
    calls = _capture_enqueue(monkeypatch)
    monkeypatch.delenv("KOMA_OWNER_WHATSAPP_PHONE", raising=False)
    monkeypatch.setattr(signup_notifications.settings, "KOMA_OWNER_EMAIL", "owner@example.com")
    monkeypatch.setattr(signup_notifications.settings, "KOMA_PUBLIC_APP_URL", "https://komafood.com.br")

    signup_notifications.enqueue_release_required(
        object(),
        protocol="KOMA-CTR-20260913-ABCDEF123456",
        restaurant_name="Restaurante QA",
        plan="pro",
        billing_cycle="mensal",
    )

    assert len(calls) == 1
    message = calls[0]["message"]
    assert "Autorização recorrente confirmada" in message
    assert "Nenhuma mensalidade fixa foi cobrada hoje" in message
    assert "7 dias grátis só começarão depois dos 4 itens essenciais" in message
    assert "Pagamento confirmado" not in message


def test_activation_message_marks_trial_start_and_next_steps(monkeypatch):
    calls = _capture_enqueue(monkeypatch)
    monkeypatch.setattr(signup_notifications.settings, "KOMA_PUBLIC_APP_URL", "https://komafood.com.br")

    signup_notifications.enqueue_activation(
        object(),
        protocol="KOMA-CTR-20260913-ABCDEF123456",
        restaurant_name="Restaurante QA",
        representative_name="Ana",
        email="ana@example.com",
        phone="5584999999999",
        token="invite-token",
    )

    assert len(calls) == 1
    message = calls[0]["message"]
    assert "7 dias grátis ainda não estão correndo" in message
    assert "válido por 72 horas" in message
    assert "dados do restaurante, horários, cardápio e modalidades de operação" in message
    assert "4 itens essenciais" in message
    assert "https://komafood.com.br/ativar#token=invite-token" in message

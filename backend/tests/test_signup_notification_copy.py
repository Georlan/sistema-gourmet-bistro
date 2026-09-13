from __future__ import annotations

from app.services import signup_notifications


def _capture_enqueue(monkeypatch):
    calls = []

    def capture(db, **kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(signup_notifications, "enqueue", capture)
    return calls


def test_acceptance_message_does_not_claim_upfront_payment(monkeypatch):
    calls = _capture_enqueue(monkeypatch)
    monkeypatch.delenv("KOMA_OWNER_WHATSAPP_PHONE", raising=False)

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
    assert "autorize o meio de pagamento recorrente" in message
    assert "Conclua o pagamento para liberar" not in message
    assert "aguarda a liberação" in message


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
    assert "trial de 7 dias começa somente na liberação" in message
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
    assert "7 dias grátis começaram" in message
    assert "válido por 72 horas" in message
    assert "configure horários" in message
    assert "pedido de teste" in message
    assert "https://komafood.com.br/ativar#token=invite-token" in message

import datetime
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.database import current_restaurante_id, get_db, tenant_session_scope
from app.services.clientes import cliente_email_lookup_hash
from app.models import (
    Cliente,
    CustomerRegistrationChallenge,
    OtpChallenge,
    PublicRateLimit,
    Restaurante,
)
from app.routes import cardapio_clientes as routes
from app.security import get_password_hash, verify_password
from app.services.clientes import _insert_guest_cliente_if_needed


@pytest.fixture()
def setup(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    for model in (
        Restaurante,
        Cliente,
        CustomerRegistrationChallenge,
        OtpChallenge,
        PublicRateLimit,
    ):
        model.__table__.create(engine)

    factory = sessionmaker(bind=engine)
    db = factory()
    db.add_all([
        Restaurante(id=71, nome="Restaurante 71", slug="rest-71", plano="pro"),
        Restaurante(id=72, nome="Restaurante 72", slug="rest-72", plano="pro"),
    ])
    db.commit()

    app = FastAPI()
    app.include_router(routes.router)

    def get_test_db():
        session = factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = get_test_db

    sent = []

    def capture_email(email, *, name, token, restaurant_name, idempotency_key):
        sent.append({
            "email": email,
            "name": name,
            "token": token,
            "restaurant_name": restaurant_name,
            "idempotency_key": idempotency_key,
        })
        return True

    monkeypatch.setattr(routes, "send_registration_email", capture_email)
    monkeypatch.setattr(settings, "CUSTOMER_EMAIL_REGISTRATION_ENABLED", True)
    monkeypatch.setattr(settings, "RESEND_API_KEY", "test-placeholder")
    monkeypatch.setattr(settings, "EMAIL_FROM", "KOMA <contato@example.test>")
    monkeypatch.setattr(settings, "CUSTOMER_EMAIL_RESEND_SECONDS", 0)
    monkeypatch.setattr(settings, "CUSTOMER_OTP_RESEND_SECONDS", 0)
    monkeypatch.setattr(settings, "CUSTOMER_OTP_MAX_SENDS", 20)
    monkeypatch.setattr(settings, "CUSTOMER_OTP_MAX_IP_REQUESTS", 50)

    yield TestClient(app), factory, sent
    engine.dispose()


def registration_payload(*, rid=71, email="cliente@example.test", phone="88999990001"):
    return {
        "restaurante_id": rid,
        "nome": "Cliente Teste",
        "email": email,
        "senha": "senha-segura-123",
        "telefone": phone,
        "endereco": "Rua de Teste, 10",
    }


def test_email_registration_is_single_use_and_login_ready(setup):
    client, factory, sent = setup
    response = client.post(
        "/cardapio/clientes/cadastro/solicitar",
        json=registration_payload(),
    )
    assert response.status_code == 202, response.text
    assert len(sent) == 1
    assert sent[0]["email"] == "cliente@example.test"
    token = sent[0]["token"]
    assert "cliente@example.test" not in token

    # O lead/cliente já alimenta a fonte canônica do CRM no aceite do signup,
    # antes de clicar no e-mail, porém segue sem qualquer contato verificado.
    db = factory()
    token_var = current_restaurante_id.set(71)
    try:
        pending_customer = db.query(Cliente).filter(
            Cliente.restaurante_id == 71,
            Cliente.email_hash == cliente_email_lookup_hash(71, "cliente@example.test"),
        ).one()
        assert pending_customer.nome == "Cliente Teste"
        assert pending_customer.email_verificado_em is None
        assert pending_customer.telefone_verificado_em is None
        assert verify_password("senha-segura-123", pending_customer.senha_hash)
    finally:
        current_restaurante_id.reset(token_var)
        db.close()

    login_before_confirmation = client.post(
        "/cardapio/clientes/login",
        json={
            "restaurante_id": 71,
            "email": "cliente@example.test",
            "senha": "senha-segura-123",
        },
    )
    assert login_before_confirmation.status_code == 403
    assert "confirma" in login_before_confirmation.json()["detail"].lower()
    # Com cooldown zerado neste fixture, o login correto pode reenviar/rotacionar
    # o link. O cliente deve usar sempre a capability mais recente recebida.
    token = sent[-1]["token"]

    confirm = client.post(
        "/cardapio/clientes/cadastro/confirmar",
        json={"token": token},
    )
    assert confirm.status_code == 200, confirm.text
    body = confirm.json()
    assert body["restaurante_id"] == 71
    assert body["cliente"]["email_verificado"] is True
    assert body["cliente"]["telefone_verificado"] is False
    assert body["access_token"]

    replay = client.post(
        "/cardapio/clientes/cadastro/confirmar",
        json={"token": token},
    )
    assert replay.status_code == 400

    login = client.post(
        "/cardapio/clientes/login",
        json={
            "restaurante_id": 71,
            "email": "cliente@example.test",
            "senha": "senha-segura-123",
        },
    )
    assert login.status_code == 200, login.text

    db = factory()
    token_var = current_restaurante_id.set(71)
    try:
        customer = db.query(Cliente).filter(
            Cliente.restaurante_id == 71,
            Cliente.email_hash == cliente_email_lookup_hash(71, "cliente@example.test"),
        ).one()
        assert customer.email_verificado_em is not None
        assert customer.telefone_verificado_em is None
        assert customer.senha_hash != "senha-segura-123"
        assert verify_password("senha-segura-123", customer.senha_hash)
    finally:
        current_restaurante_id.reset(token_var)
        db.close()


def test_legacy_account_login_requires_email_confirmation_under_order_gate(setup, monkeypatch):
    client, factory, sent = setup
    monkeypatch.setattr(settings, "CUSTOMER_ACCOUNT_REQUIRED_FOR_ORDERS", True)

    db = factory()
    token_var = current_restaurante_id.set(71)
    try:
        legacy = Cliente(
            id="legacy-account-71",
            restaurante_id=71,
            telefone="88999990009",
            nome="Cliente Legado",
            email="legacy@example.test",
            senha_hash=get_password_hash("senha-legada-123"),
            email_verificado_em=None,
            telefone_verificado_em=datetime.datetime.now(datetime.timezone.utc),
            saldo_pontos=35,
            saldo_cashback=7.5,
        )
        db.add(legacy)
        db.commit()
    finally:
        current_restaurante_id.reset(token_var)
        db.close()

    login = client.post(
        "/cardapio/clientes/login",
        json={
            "restaurante_id": 71,
            "email": "legacy@example.test",
            "senha": "senha-legada-123",
        },
    )
    assert login.status_code == 403, login.text
    assert "confirmar o e-mail" in login.json()["detail"].lower()
    assert len(sent) == 1

    confirm = client.post(
        "/cardapio/clientes/cadastro/confirmar",
        json={"token": sent[0]["token"]},
    )
    assert confirm.status_code == 200, confirm.text
    assert confirm.json()["cliente"]["id"] == "legacy-account-71"
    assert confirm.json()["cliente"]["email_verificado"] is True
    assert confirm.json()["cliente"]["saldo_pontos"] == 35
    assert confirm.json()["cliente"]["saldo_cashback"] == 7.5

    login_after_confirmation = client.post(
        "/cardapio/clientes/login",
        json={
            "restaurante_id": 71,
            "email": "legacy@example.test",
            "senha": "senha-legada-123",
        },
    )
    assert login_after_confirmation.status_code == 200, login_after_confirmation.text
    assert login_after_confirmation.json()["cliente"]["id"] == "legacy-account-71"


def test_same_email_isolated_by_restaurant(setup):
    client, _, sent = setup
    for rid, phone in ((71, "88999990011"), (72, "88999990012")):
        response = client.post(
            "/cardapio/clientes/cadastro/solicitar",
            json=registration_payload(rid=rid, email="shared@example.test", phone=phone),
        )
        assert response.status_code == 202, response.text

    assert len(sent) == 2
    first, second = sent[0]["token"], sent[1]["token"]
    assert first.split(".", 1)[0] == "71"
    assert second.split(".", 1)[0] == "72"
    assert client.post("/cardapio/clientes/cadastro/confirmar", json={"token": first}).status_code == 200
    assert client.post("/cardapio/clientes/cadastro/confirmar", json={"token": second}).status_code == 200


def test_resend_failure_rolls_back_pending_registration(setup, monkeypatch):
    client, factory, _ = setup
    monkeypatch.setattr(routes, "send_registration_email", lambda *args, **kwargs: False)
    response = client.post(
        "/cardapio/clientes/cadastro/solicitar",
        json=registration_payload(email="failed@example.test", phone="88999990021"),
    )
    assert response.status_code == 503

    db = factory()
    token_var = current_restaurante_id.set(71)
    try:
        assert db.query(CustomerRegistrationChallenge).filter(
            CustomerRegistrationChallenge.restaurante_id == 71,
            CustomerRegistrationChallenge.email_hash == cliente_email_lookup_hash(71, "failed@example.test"),
        ).first() is None
        assert db.query(Cliente).filter(
            Cliente.restaurante_id == 71,
            Cliente.email_hash == cliente_email_lookup_hash(71, "failed@example.test"),
        ).first() is None
    finally:
        current_restaurante_id.reset(token_var)
        db.close()


def test_guest_history_requires_phone_ownership_before_claim(setup, monkeypatch):
    client, factory, sent = setup
    db = factory()
    token_var = current_restaurante_id.set(71)
    try:
        guest = Cliente(
            id="guest-71",
            restaurante_id=71,
            telefone="88999990031",
            nome="Cliente Antigo",
            saldo_pontos=77,
            saldo_cashback=18.5,
        )
        db.add(guest)
        db.commit()
    finally:
        current_restaurante_id.reset(token_var)
        db.close()

    response = client.post(
        "/cardapio/clientes/cadastro/solicitar",
        json=registration_payload(
            email="claim@example.test",
            phone="88999990031",
        ),
    )
    assert response.status_code == 202
    token = sent[-1]["token"]

    db = factory()
    token_var = current_restaurante_id.set(71)
    try:
        guest_before_confirmation = db.get(Cliente, "guest-71")
        assert guest_before_confirmation.email is None
        assert guest_before_confirmation.senha_hash is None
    finally:
        current_restaurante_id.reset(token_var)
        db.close()

    confirm_email = client.post(
        "/cardapio/clientes/cadastro/confirmar",
        json={"token": token},
    )
    assert confirm_email.status_code == 200
    assert confirm_email.json()["status"] == "phone_verification_required"
    phone_claim_token = confirm_email.json()["registration_token"]
    assert phone_claim_token != token
    assert client.post(
        "/cardapio/clientes/cadastro/confirmar",
        json={"token": token},
    ).status_code == 400

    db = factory()
    token_var = current_restaurante_id.set(71)
    try:
        guest = db.get(Cliente, "guest-71")
        assert guest.email is None
        assert guest.senha_hash is None
        assert guest.saldo_pontos == 77
        assert float(guest.saldo_cashback) == 18.5
    finally:
        current_restaurante_id.reset(token_var)
        db.close()

    monkeypatch.setattr(settings, "CUSTOMER_PHONE_VERIFICATION_ENABLED", True)
    monkeypatch.setattr(routes, "generate_otp", lambda: "246810")
    monkeypatch.setattr(routes, "enviar_codigo_otp_whatsapp", lambda *args, **kwargs: True)

    request_phone = client.post(
        "/cardapio/clientes/cadastro/telefone/solicitar",
        json={"token": phone_claim_token},
    )
    assert request_phone.status_code == 202, request_phone.text

    confirm_phone = client.post(
        "/cardapio/clientes/cadastro/telefone/confirmar",
        json={"token": phone_claim_token, "codigo": "246810"},
    )
    assert confirm_phone.status_code == 200, confirm_phone.text
    assert confirm_phone.json()["cliente"]["id"] == "guest-71"
    assert confirm_phone.json()["cliente"]["email_verificado"] is True
    assert confirm_phone.json()["cliente"]["telefone_verificado"] is True

    db = factory()
    token_var = current_restaurante_id.set(71)
    try:
        claimed = db.get(Cliente, "guest-71")
        assert claimed.email == "claim@example.test"
        assert claimed.saldo_pontos == 77
        assert float(claimed.saldo_cashback) == 18.5
    finally:
        current_restaurante_id.reset(token_var)
        db.close()


def test_anonymous_order_helper_will_not_link_unverified_account_phone(setup):
    client, factory, sent = setup
    response = client.post(
        "/cardapio/clientes/cadastro/solicitar",
        json=registration_payload(
            email="unverified-phone@example.test",
            phone="88999990041",
        ),
    )
    assert response.status_code == 202
    token = sent[-1]["token"]
    assert client.post(
        "/cardapio/clientes/cadastro/confirmar",
        json={"token": token},
    ).status_code == 200

    db = factory()
    token_var = current_restaurante_id.set(71)
    try:
        account = db.query(Cliente).filter(
            Cliente.restaurante_id == 71,
            Cliente.email_hash == cliente_email_lookup_hash(71, "unverified-phone@example.test"),
        ).one()
        assert account.telefone_verificado_em is None

        command_like = SimpleNamespace(
            cliente_id=None,
            restaurante_id=71,
            delivery_telefone="88999990041",
            identificador="Pessoa que só conhece o telefone",
            delivery_endereco=None,
        )
        with db.connection() as connection:
            linked_id, canonical_name = _insert_guest_cliente_if_needed(
                connection,
                command_like,
            )
        assert linked_id is None
        assert canonical_name is None
    finally:
        current_restaurante_id.reset(token_var)
        db.close()


def test_expired_and_tampered_registration_links_fail(setup):
    client, factory, sent = setup
    assert client.post(
        "/cardapio/clientes/cadastro/solicitar",
        json=registration_payload(
            email="expired@example.test",
            phone="88999990051",
        ),
    ).status_code == 202
    token = sent[-1]["token"]

    assert client.post(
        "/cardapio/clientes/cadastro/confirmar",
        json={"token": token + "tampered"},
    ).status_code == 400

    db = factory()
    token_var = current_restaurante_id.set(71)
    try:
        challenge = db.query(CustomerRegistrationChallenge).filter(
            CustomerRegistrationChallenge.restaurante_id == 71,
            CustomerRegistrationChallenge.email_hash == cliente_email_lookup_hash(71, "expired@example.test"),
        ).one()
        challenge.expira_em = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=1)
        db.commit()
    finally:
        current_restaurante_id.reset(token_var)
        db.close()

    assert client.post(
        "/cardapio/clientes/cadastro/confirmar",
        json={"token": token},
    ).status_code == 400

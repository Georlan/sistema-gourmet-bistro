import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.database import Base, TenantSession, get_db, tenant_session_scope
from app.models import (
    Cliente,
    CustomerRegistrationChallenge,
    Restaurante,
)
from app.routes import cardapio_clientes as routes
from app.security import verify_password
from app.services.clientes import _insert_guest_cliente_if_needed


@pytest.fixture()
def setup(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(
        class_=TenantSession,
        bind=engine,
        autocommit=False,
        autoflush=False,
    )
    db = factory()
    default_restaurant = db.query(Restaurante).filter(Restaurante.id == 1).first()
    if default_restaurant is None:
        db.add(Restaurante(id=1, nome="Restaurante Um", slug="rest-1", plano="pro"))
    else:
        default_restaurant.nome = "Restaurante Um"
        default_restaurant.slug = "rest-1"
        default_restaurant.plano = "pro"
    if db.query(Restaurante).filter(Restaurante.id == 2).first() is None:
        db.add(Restaurante(id=2, nome="Restaurante Dois", slug="rest-2", plano="pro"))
    db.commit()
    db.close()

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

    def capture_email(email, token, restaurant_name, *, delivery_id):
        sent.append(
            {
                "email": email,
                "token": token,
                "restaurant_name": restaurant_name,
                "delivery_id": delivery_id,
            }
        )
        return True

    monkeypatch.setattr(routes, "send_registration_email", capture_email)
    monkeypatch.setattr(settings, "CUSTOMER_EMAIL_REGISTRATION_ENABLED", True)
    monkeypatch.setattr(settings, "RESEND_API_KEY", "test-resend-key")
    monkeypatch.setattr(settings, "EMAIL_FROM", "KOMA <contato@mail.example.test>")
    monkeypatch.setattr(settings, "CUSTOMER_EMAIL_RESEND_SECONDS", 60)
    monkeypatch.setattr(settings, "CUSTOMER_EMAIL_VERIFICATION_TTL_SECONDS", 900)
    monkeypatch.setattr(settings, "CUSTOMER_EMAIL_MAX_SENDS", 5)
    monkeypatch.setattr(settings, "CUSTOMER_EMAIL_MAX_IP_REQUESTS", 20)

    yield TestClient(app), factory, sent
    engine.dispose()


def request_registration(
    client,
    *,
    rid=1,
    email="cliente@example.test",
    phone="11999999999",
    password="senha-segura-123",
):
    return client.post(
        "/cardapio/clientes/cadastro/solicitar",
        json={
            "restaurante_id": rid,
            "nome": "Cliente Teste",
            "email": email,
            "telefone": phone,
            "senha": password,
            "endereco": "Rua Teste, 10",
        },
    )


def confirm_registration(client, token):
    return client.post(
        "/cardapio/clientes/cadastro/confirmar",
        json={"token": token},
    )


def test_email_registration_creates_account_only_after_confirmation(setup):
    client, factory, sent = setup

    requested = request_registration(client)
    assert requested.status_code == 202, requested.text
    assert len(sent) == 1
    token = sent[0]["token"]

    db = factory()
    try:
        with tenant_session_scope(db, 1):
            pending = db.query(CustomerRegistrationChallenge).one()
            assert pending.senha_hash != "senha-segura-123"
            assert token not in pending.token_hash
            assert db.query(Cliente).count() == 0
    finally:
        db.close()

    confirmed = confirm_registration(client, token)
    assert confirmed.status_code == 200, confirmed.text
    data = confirmed.json()
    assert data["restaurante_id"] == 1
    assert data["cliente"]["email"] == "cliente@example.test"
    assert data["cliente"]["email_verificado"] is True
    assert data["cliente"]["telefone_verificado"] is False
    assert data["access_token"]

    db = factory()
    try:
        with tenant_session_scope(db, 1):
            account = db.query(Cliente).filter(
                Cliente.email == "cliente@example.test",
            ).one()
            assert verify_password("senha-segura-123", account.senha_hash)
            assert account.email_verificado_em is not None
            assert account.telefone_verificado_em is None
            assert db.query(CustomerRegistrationChallenge).count() == 0
    finally:
        db.close()

    login = client.post(
        "/cardapio/clientes/login",
        json={
            "restaurante_id": 1,
            "email": "cliente@example.test",
            "senha": "senha-segura-123",
        },
    )
    assert login.status_code == 200


def test_registration_token_is_tamper_resistant_and_single_use(setup):
    client, _factory, sent = setup
    assert request_registration(client).status_code == 202
    token = sent[0]["token"]

    assert confirm_registration(client, token[:-4] + "abcd").status_code == 400
    assert confirm_registration(client, token).status_code == 200
    assert confirm_registration(client, token).status_code == 400


def test_expired_registration_token_is_rejected_and_removed(setup):
    client, factory, sent = setup
    assert request_registration(client).status_code == 202
    token = sent[0]["token"]

    db = factory()
    try:
        with tenant_session_scope(db, 1):
            pending = db.query(CustomerRegistrationChallenge).one()
            pending.expira_em = (
                datetime.datetime.now(datetime.timezone.utc)
                - datetime.timedelta(seconds=1)
            )
            db.commit()
    finally:
        db.close()

    assert confirm_registration(client, token).status_code == 400

    db = factory()
    try:
        with tenant_session_scope(db, 1):
            assert db.query(CustomerRegistrationChallenge).count() == 0
    finally:
        db.close()


def test_same_email_is_isolated_by_restaurant(setup):
    client, factory, sent = setup
    assert request_registration(
        client,
        rid=1,
        phone="11911111111",
    ).status_code == 202
    token_one = sent[-1]["token"]

    assert request_registration(
        client,
        rid=2,
        phone="11922222222",
    ).status_code == 202
    token_two = sent[-1]["token"]

    assert confirm_registration(client, token_one).json()["restaurante_id"] == 1
    assert confirm_registration(client, token_two).json()["restaurante_id"] == 2

    db = factory()
    try:
        with tenant_session_scope(db, 1):
            assert db.query(Cliente).filter(
                Cliente.email == "cliente@example.test",
            ).count() == 1
        with tenant_session_scope(db, 2):
            assert db.query(Cliente).filter(
                Cliente.email == "cliente@example.test",
            ).count() == 1
    finally:
        db.close()


def test_resend_failure_fails_closed_without_creating_customer(setup, monkeypatch):
    client, factory, _sent = setup
    monkeypatch.setattr(
        routes,
        "send_registration_email",
        lambda *args, **kwargs: False,
    )

    response = request_registration(client)
    assert response.status_code == 503

    db = factory()
    try:
        with tenant_session_scope(db, 1):
            assert db.query(Cliente).count() == 0
            pending = db.query(CustomerRegistrationChallenge).one()
            assert pending.ultimo_envio_em is None
    finally:
        db.close()


def test_resend_cooldown_does_not_send_second_message(setup):
    client, _factory, sent = setup
    first = request_registration(client)
    second = request_registration(client)

    assert first.status_code == 202
    assert second.status_code == 202
    assert len(sent) == 1
    assert second.json()["retry_after_seconds"] > 0


def test_existing_guest_requires_phone_proof_before_claim(setup, monkeypatch):
    client, factory, sent = setup
    db = factory()
    try:
        with tenant_session_scope(db, 1):
            db.add(
                Cliente(
                    id="guest-preserved",
                    restaurante_id=1,
                    telefone="11955555555",
                    nome="Guest Original",
                    saldo_pontos=50,
                    saldo_cashback=12.5,
                )
            )
            db.commit()
    finally:
        db.close()

    assert request_registration(
        client,
        phone="11955555555",
    ).status_code == 202
    token = sent[-1]["token"]

    email_confirm = confirm_registration(client, token)
    assert email_confirm.status_code == 409
    assert email_confirm.json()["code"] == "phone_verification_required"

    db = factory()
    try:
        with tenant_session_scope(db, 1):
            guest = db.get(Cliente, "guest-preserved")
            assert guest.email is None
            assert guest.senha_hash is None
            assert guest.saldo_pontos == 50
            assert float(guest.saldo_cashback) == 12.5
    finally:
        db.close()

    monkeypatch.setattr(settings, "KOMA_WHATSAPP_AUTOMATION_ENABLED", True)
    monkeypatch.setattr(routes, "generate_otp", lambda: "246810")
    monkeypatch.setattr(
        routes,
        "enviar_codigo_otp_whatsapp",
        lambda *args, **kwargs: True,
    )

    otp_request = client.post(
        "/cardapio/clientes/cadastro/telefone/solicitar",
        json={"token": token},
    )
    assert otp_request.status_code == 202, otp_request.text

    phone_confirm = client.post(
        "/cardapio/clientes/cadastro/telefone/confirmar",
        json={"token": token, "codigo": "246810"},
    )
    assert phone_confirm.status_code == 200, phone_confirm.text
    assert phone_confirm.json()["cliente"]["id"] == "guest-preserved"
    assert phone_confirm.json()["cliente"]["email_verificado"] is True
    assert phone_confirm.json()["cliente"]["telefone_verificado"] is True

    db = factory()
    try:
        with tenant_session_scope(db, 1):
            guest = db.get(Cliente, "guest-preserved")
            assert guest.email == "cliente@example.test"
            assert guest.saldo_pontos == 50
            assert float(guest.saldo_cashback) == 12.5
            assert guest.email_verificado_em is not None
            assert guest.telefone_verificado_em is not None
    finally:
        db.close()


def test_unverified_phone_account_is_not_auto_linked_to_guest_order(setup):
    _client, factory, _sent = setup
    db = factory()
    try:
        with tenant_session_scope(db, 1):
            db.add(
                Cliente(
                    id="email-only-account",
                    restaurante_id=1,
                    telefone="11977777777",
                    nome="Conta E-mail",
                    email="email-only@example.test",
                    senha_hash="hashed",
                    email_verificado_em=datetime.datetime.now(datetime.timezone.utc),
                    telefone_verificado_em=None,
                    saldo_pontos=0,
                    saldo_cashback=0,
                )
            )
            db.commit()
    finally:
        db.close()

    class PublicOrder:
        restaurante_id = 1
        cliente_id = None
        delivery_telefone = "11977777777"
        identificador = "Outra Pessoa"
        delivery_endereco = None

    bind = factory.kw["bind"]
    with bind.begin() as connection:
        cliente_id, canonical_name = _insert_guest_cliente_if_needed(
            connection,
            PublicOrder(),
        )
    assert cliente_id is None
    assert canonical_name is None


def test_registration_model_inherits_tenant_context_by_default(setup):
    _client, factory, _sent = setup
    db = factory()
    try:
        with tenant_session_scope(db, 2):
            now = datetime.datetime.now(datetime.timezone.utc)
            pending = CustomerRegistrationChallenge(
                id="tenant-default",
                nome="Cliente",
                email="tenant-default@example.test",
                telefone="11988888888",
                senha_hash="hashed",
                token_hash="a" * 64,
                expira_em=now + datetime.timedelta(minutes=5),
                janela_iniciada_em=now,
            )
            db.add(pending)
            db.commit()
            assert pending.restaurante_id == 2
    finally:
        db.close()


def test_email_registration_feature_flag_fails_closed(setup, monkeypatch):
    client, _factory, sent = setup
    monkeypatch.setattr(settings, "CUSTOMER_EMAIL_REGISTRATION_ENABLED", False)

    assert request_registration(client).status_code == 503
    assert sent == []

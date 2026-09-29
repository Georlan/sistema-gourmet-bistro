import datetime

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.crypt import pii_lookup_hash
from app.database import current_restaurante_id
from app.models import Cliente, CustomerRegistrationChallenge, Restaurante
from app.services.clientes import (
    buscar_cliente_por_email,
    buscar_cliente_por_telefone,
    cliente_email_lookup_hash,
    cliente_telefone_lookup_hash,
)


def _database():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Restaurante.__table__.create(engine)
    Cliente.__table__.create(engine)
    CustomerRegistrationChallenge.__table__.create(engine)
    return engine, sessionmaker(bind=engine)


def test_customer_pii_is_encrypted_at_rest_and_lookup_remains_tenant_scoped():
    engine, factory = _database()
    db = factory()
    token = current_restaurante_id.set(501)
    try:
        db.add_all([
            Restaurante(id=501, nome="Tenant PII 501", slug="tenant-pii-501"),
            Restaurante(id=502, nome="Tenant PII 502", slug="tenant-pii-502"),
        ])
        db.flush()

        phone = "85999991234"
        email = "cliente@example.test"
        customer = Cliente(
            id="customer-pii-501",
            restaurante_id=501,
            nome="Cliente Protegido",
            telefone=phone,
            email=email,
            endereco="Rua Protegida, 10",
            saldo_pontos=0,
            saldo_cashback=0,
        )
        db.add(customer)
        db.commit()

        raw = db.execute(
            select(
                Cliente.__table__.c.telefone,
                Cliente.__table__.c.telefone_hash,
                Cliente.__table__.c.nome,
                Cliente.__table__.c.email,
                Cliente.__table__.c.email_hash,
                Cliente.__table__.c.endereco,
            ).where(Cliente.__table__.c.id == customer.id)
        ).mappings().one()

        for column, plaintext in (
            ("telefone", phone),
            ("nome", "Cliente Protegido"),
            ("email", email),
            ("endereco", "Rua Protegida, 10"),
        ):
            assert raw[column] != plaintext
            assert str(raw[column]).startswith("gAAAAA")

        assert raw["telefone_hash"] == cliente_telefone_lookup_hash(501, phone)
        assert raw["email_hash"] == cliente_email_lookup_hash(501, email)
        assert raw["telefone_hash"] != cliente_telefone_lookup_hash(502, phone)
        assert raw["email_hash"] != cliente_email_lookup_hash(502, email)

        by_phone = buscar_cliente_por_telefone(
            db,
            restaurante_id=501,
            telefone=phone,
        )
        by_email = buscar_cliente_por_email(
            db,
            restaurante_id=501,
            email=email,
        )
        assert by_phone is not None and by_phone.id == customer.id
        assert by_email is not None and by_email.id == customer.id
        assert by_phone.telefone == phone
        assert by_phone.nome == "Cliente Protegido"
        assert by_phone.email == email
        assert by_phone.endereco == "Rua Protegida, 10"
    finally:
        current_restaurante_id.reset(token)
        db.close()
        engine.dispose()


def test_pending_registration_pii_is_encrypted_and_email_remains_unique_by_hash():
    engine, factory = _database()
    db = factory()
    token = current_restaurante_id.set(601)
    try:
        db.add(Restaurante(id=601, nome="Tenant Signup", slug="tenant-signup"))
        db.flush()
        now = datetime.datetime.now(datetime.timezone.utc)
        challenge = CustomerRegistrationChallenge(
            id="challenge-pii-601",
            restaurante_id=601,
            nome="Cadastro Pendente",
            email="pending@example.test",
            telefone="85988887777",
            endereco="Rua Temporária, 20",
            senha_hash="password-hash",
            token_hash="a" * 64,
            expira_em=now + datetime.timedelta(minutes=30),
            criado_em=now,
            ultimo_envio_em=now,
        )
        db.add(challenge)
        db.commit()

        raw = db.execute(
            select(
                CustomerRegistrationChallenge.__table__.c.nome,
                CustomerRegistrationChallenge.__table__.c.email,
                CustomerRegistrationChallenge.__table__.c.email_hash,
                CustomerRegistrationChallenge.__table__.c.telefone,
                CustomerRegistrationChallenge.__table__.c.endereco,
            ).where(CustomerRegistrationChallenge.__table__.c.id == challenge.id)
        ).mappings().one()

        assert raw["nome"].startswith("gAAAAA")
        assert raw["email"].startswith("gAAAAA")
        assert raw["telefone"].startswith("gAAAAA")
        assert raw["endereco"].startswith("gAAAAA")
        assert raw["email_hash"] == pii_lookup_hash(
            "cliente-email",
            601,
            "pending@example.test",
        )
        assert challenge.email == "pending@example.test"
        assert challenge.telefone == "85988887777"
    finally:
        current_restaurante_id.reset(token)
        db.close()
        engine.dispose()

import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, current_restaurante_id
from app.delivery_address_snapshot import ComandaDeliveryAddressSnapshot
from app.models import (
    Cliente,
    Comanda,
    HistoricoFidelidade,
    MensagemWhatsApp,
    RascunhoPedido,
    Restaurante,
    Usuario,
)
from app.services.privacy_retention import (
    CONFIRMATION_PHRASE,
    apply_retention,
    build_retention_plan,
)


def _setup():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    db = factory()
    token = current_restaurante_id.set(1)
    try:
        db.add(Restaurante(id=1, nome="R1", slug="r1"))
        db.add(Usuario(id="u1", restaurante_id=1, nome="Admin", usuario="admin", senha_hash="x", role="admin", status="ativo"))
        db.add(Cliente(id="c1", restaurante_id=1, nome="Cliente", telefone="85999990000"))
        old = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=400)
        db.add(
            Comanda(
                id="order-old",
                restaurante_id=1,
                cliente_id="c1",
                garcom_id="u1",
                numero_pedido=1,
                fechada=True,
                criado_em=old,
                fechado_em=old,
                identificador="Cliente Nome",
                delivery_telefone="85999990000",
                delivery_endereco="Rua Antiga, 10",
                delivery_bairro="Centro",
                valor_pago=50,
            )
        )
        db.add(
            MensagemWhatsApp(
                id="msg-old",
                restaurante_id=1,
                cliente_telefone="85999990000",
                remetente="cliente",
                conteudo="conteudo privado",
                criado_em=old,
            )
        )
        db.add(
            RascunhoPedido(
                id="draft-old",
                restaurante_id=1,
                cliente_telefone="85999990000",
                conteudo_json='{"x":1}',
                criado_em=old,
            )
        )
        db.add(
            HistoricoFidelidade(
                restaurante_id=1,
                cliente_id="c1",
                cliente_telefone="85999990000",
                tipo_movimentacao="ACUMULO",
                valor_delta=10,
                comanda_id="order-old",
                criado_em=old,
            )
        )
        db.flush()
        db.add(
            ComandaDeliveryAddressSnapshot(
                comanda_id="order-old",
                restaurante_id=1,
                payload_encrypted="gAAAAABinvalid",
                created_at=old,
            )
        )
        db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()
    return engine, factory


def test_retention_preserves_customer_and_commercial_history():
    engine, factory = _setup()
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=365)
    with engine.connect() as connection:
        plan = build_retention_plan(connection, restaurante_id=1, cutoff=cutoff)
    assert plan.counts["comandas_snapshots"] == 1
    result = apply_retention(
        engine,
        restaurante_id=1,
        cutoff=cutoff,
        expected_database=plan.database,
        expected_fingerprint=plan.fingerprint,
        confirmation=CONFIRMATION_PHRASE,
        backup_reference="snapshot-001",
    )
    assert result["validation"] == "passed"

    db = factory()
    token = current_restaurante_id.set(1)
    try:
        customer = db.get(Cliente, "c1")
        order = db.get(Comanda, "order-old")
        assert customer is not None
        assert order is not None
        assert order.cliente_id == "c1"
        assert float(order.valor_pago) == 50.0
        assert order.delivery_telefone is None
        assert order.delivery_endereco is None
        assert order.delivery_bairro is None
        assert order.identificador == "Cliente"
        assert (
            db.query(ComandaDeliveryAddressSnapshot)
            .filter(ComandaDeliveryAddressSnapshot.comanda_id == "order-old")
            .count()
            == 0
        )
        assert db.query(HistoricoFidelidade).filter(HistoricoFidelidade.cliente_id == "c1").count() == 1
    finally:
        current_restaurante_id.reset(token)
        db.close()
        engine.dispose()


def test_retention_requires_exact_dry_run_and_backup():
    engine, _ = _setup()
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=365)
    with engine.connect() as connection:
        plan = build_retention_plan(connection, restaurante_id=1, cutoff=cutoff)

    for kwargs in (
        {"confirmation": "wrong", "backup_reference": "snapshot"},
        {"confirmation": CONFIRMATION_PHRASE, "backup_reference": ""},
        {"confirmation": CONFIRMATION_PHRASE, "backup_reference": "snapshot", "expected_fingerprint": "wrong"},
    ):
        params = dict(
            restaurante_id=1,
            cutoff=cutoff,
            expected_database=plan.database,
            expected_fingerprint=plan.fingerprint,
            confirmation=CONFIRMATION_PHRASE,
            backup_reference="snapshot",
        )
        params.update(kwargs)
        try:
            apply_retention(engine, **params)
        except RuntimeError:
            pass
        else:
            raise AssertionError("retention apply deveria ser bloqueado")
    engine.dispose()

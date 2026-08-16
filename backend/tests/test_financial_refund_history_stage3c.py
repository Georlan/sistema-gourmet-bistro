from __future__ import annotations

import datetime
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, current_restaurante_id
from app.financial_models import PagamentoAlocacao, PagamentoEstorno
from app.models import CaixaTurno, Comanda, Pagamento, Restaurante, Usuario
from app.services.cash_reconciliation import RefundDomainError
from app.services.refund_guard import create_refund_guarded


engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)


@pytest.fixture()
def db():
    token = current_restaurante_id.set(1)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    session = Session()
    try:
        session.add(Restaurante(id=1, nome="Koma", plano="premium"))
        session.add(Usuario(
            id="u-caixa",
            restaurante_id=1,
            nome="Caixa",
            usuario="caixa",
            senha_hash="x",
            role="caixa",
            cargo="caixa",
            status="ativo",
        ))
        session.add(CaixaTurno(
            id=1,
            restaurante_id=1,
            aberto_por_id="u-caixa",
            aberto_em=datetime.datetime(2026, 8, 16, 18, 0),
            saldo_inicial=100,
            status="aberto",
        ))
        session.commit()
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)
        current_restaurante_id.reset(token)


def add_command(db, command_id: str, number: int):
    db.add(Comanda(
        id=command_id,
        restaurante_id=1,
        garcom_id="u-caixa",
        fechada=True,
        fechado_em=datetime.datetime(2026, 8, 15, 22, 0),
        criado_em=datetime.datetime(2026, 8, 15, 20, 0),
        numero_pedido=number,
        valor_pago=100,
    ))


def add_payment(db, payment_id: str, command_ids: tuple[str, ...], values: tuple[float, ...]):
    for index, command_id in enumerate(command_ids):
        add_command(db, command_id, 500 + index)
    db.commit()
    payment = Pagamento(
        id=payment_id,
        restaurante_id=1,
        comanda_id=command_ids[0],
        turno_id=1,
        valor=sum(values),
        metodo="pix",
        status="aprovado",
        idempotency_key=f"pay-{payment_id}",
        criado_em=datetime.datetime(2026, 8, 15, 22, 0),
    )
    db.add(payment)
    db.commit()
    for command_id, value in zip(command_ids, values):
        db.add(PagamentoAlocacao(
            restaurante_id=1,
            pagamento_id=payment_id,
            comanda_id=command_id,
            atendimento_id=None,
            valor=value,
            criado_em=payment.criado_em,
        ))
    db.commit()
    return payment


def add_legacy_refund(db, payment_id: str, value: float, key: str):
    db.add(PagamentoEstorno(
        id=f"legacy-{key}",
        restaurante_id=1,
        pagamento_id=payment_id,
        turno_id=1,
        usuario_id="u-caixa",
        valor=value,
        metodo="pix",
        motivo="Estorno legado 3A",
        idempotency_key=key,
        criado_em=datetime.datetime(2026, 8, 16, 19, 0),
    ))
    db.commit()


def test_single_origin_legacy_refund_still_caps_global_remaining(db):
    add_payment(db, "p-single-legacy", ("cmd-single",), (100,))
    add_legacy_refund(db, "p-single-legacy", 30, "legacy-single")

    created = create_refund_guarded(
        db,
        restaurante_id=1,
        payment_id="p-single-legacy",
        turno_id=1,
        usuario_id="u-caixa",
        valor=70,
        motivo="Completar devolução",
        idempotency_key="refund-after-legacy-single",
    )
    db.commit()
    assert created.valor == 70.0

    with pytest.raises(RefundDomainError, match="saldo global disponível"):
        create_refund_guarded(
            db,
            restaurante_id=1,
            payment_id="p-single-legacy",
            turno_id=1,
            usuario_id="u-caixa",
            valor=0.01,
            motivo="Tentativa adicional",
            idempotency_key="refund-after-full-single",
        )


def test_split_payment_with_legacy_unattributed_refund_fails_closed(db):
    add_payment(db, "p-split-legacy", ("cmd-a", "cmd-b"), (60, 40))
    add_legacy_refund(db, "p-split-legacy", 20, "legacy-split")

    with pytest.raises(RefundDomainError, match="sem origem entre múltiplas Contas") as exc:
        create_refund_guarded(
            db,
            restaurante_id=1,
            payment_id="p-split-legacy",
            turno_id=1,
            usuario_id="u-caixa",
            valor=10,
            motivo="Nova devolução",
            idempotency_key="refund-after-legacy-split",
            alocacoes=[("cmd-a", 10)],
        )
    assert exc.value.status_code == 409
    assert db.query(PagamentoEstorno).count() == 1


def test_corrupt_history_above_original_payment_is_blocked(db):
    add_payment(db, "p-corrupt", ("cmd-corrupt",), (50,))
    add_legacy_refund(db, "p-corrupt", 60, "legacy-corrupt")

    with pytest.raises(RefundDomainError, match="acima do valor original") as exc:
        create_refund_guarded(
            db,
            restaurante_id=1,
            payment_id="p-corrupt",
            turno_id=1,
            usuario_id="u-caixa",
            valor=1,
            motivo="Nova tentativa",
            idempotency_key="refund-corrupt-block",
        )
    assert exc.value.status_code == 409

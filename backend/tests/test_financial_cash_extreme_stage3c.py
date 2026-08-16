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
from app.services.cash_activity import recent_cash_activities
from app.services.cash_reconciliation import RefundDomainError, cash_shift_totals
from app.services.refund_guard import (
    create_refund_guarded,
    remaining_refund_allocations_guarded,
)


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
            nome="Caixa Teste",
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
            saldo_inicial=0,
            status="aberto",
        ))
        session.commit()
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)
        current_restaurante_id.reset(token)


def add_payment(db, payment_id: str, value: float, method: str = "pix") -> Pagamento:
    command_id = f"cmd-{payment_id}"
    command = Comanda(
        id=command_id,
        restaurante_id=1,
        garcom_id="u-caixa",
        fechada=True,
        fechado_em=datetime.datetime(2026, 8, 16, 19, 0),
        criado_em=datetime.datetime(2026, 8, 16, 18, 30),
        numero_pedido=900 + len(db.query(Comanda).all()),
        valor_pago=value,
    )
    db.add(command)
    db.commit()
    payment = Pagamento(
        id=payment_id,
        restaurante_id=1,
        comanda_id=command_id,
        turno_id=1,
        valor=value,
        metodo=method,
        status="aprovado",
        idempotency_key=f"pay-{payment_id}",
        criado_em=datetime.datetime(2026, 8, 16, 19, 0),
    )
    db.add(payment)
    db.commit()
    db.add(PagamentoAlocacao(
        restaurante_id=1,
        pagamento_id=payment.id,
        comanda_id=command_id,
        atendimento_id=None,
        valor=value,
        criado_em=payment.criado_em,
    ))
    db.commit()
    return payment


def make_refund(db, payment_id: str, value: object, key: str, method: str | None = None):
    result = create_refund_guarded(
        db,
        restaurante_id=1,
        payment_id=payment_id,
        turno_id=1,
        usuario_id="u-caixa",
        valor=value,
        motivo="Teste extremo de devolução",
        idempotency_key=key,
        metodo_devolucao=method,
    )
    db.commit()
    return result


def test_three_one_cent_refunds_close_exactly_without_float_residue(db):
    payment = add_payment(db, "p-cents", 0.03, method="pix")
    make_refund(db, payment.id, Decimal("0.01"), "refund-cent-001")
    make_refund(db, payment.id, Decimal("0.01"), "refund-cent-002")
    make_refund(db, payment.id, Decimal("0.01"), "refund-cent-003")

    rows = remaining_refund_allocations_guarded(db, 1, payment)
    assert sum((Decimal(str(row["disponivel"])) for row in rows), Decimal("0")) == Decimal("0.00")
    totals = cash_shift_totals(db, 1, db.query(CaixaTurno).filter(CaixaTurno.id == 1).one())
    assert totals.vendas_brutas == Decimal("0.03")
    assert totals.estornos == Decimal("0.03")
    assert totals.vendas_liquidas == Decimal("0.00")
    assert totals.total_pix == Decimal("0.00")


def test_same_idempotency_key_cannot_be_reused_for_another_payment(db):
    add_payment(db, "p-key-a", 10)
    add_payment(db, "p-key-b", 10)
    make_refund(db, "p-key-a", 1, "refund-shared-key")

    with pytest.raises(RefundDomainError, match="outro conteúdo") as exc:
        create_refund_guarded(
            db,
            restaurante_id=1,
            payment_id="p-key-b",
            turno_id=1,
            usuario_id="u-caixa",
            valor=1,
            motivo="Teste extremo de devolução",
            idempotency_key="refund-shared-key",
        )
    assert exc.value.status_code == 409
    assert db.query(PagamentoEstorno).count() == 1


def test_cash_refund_equal_to_last_cent_is_allowed_but_next_cent_is_blocked(db):
    shift = db.query(CaixaTurno).filter(CaixaTurno.id == 1).one()
    shift.saldo_inicial = 0.01
    db.commit()
    add_payment(db, "p-cash-last-cent", 1, method="pix")

    make_refund(db, "p-cash-last-cent", Decimal("0.01"), "refund-last-cent", method="dinheiro")
    totals = cash_shift_totals(db, 1, shift)
    assert totals.saldo_esperado_dinheiro == Decimal("0.00")

    with pytest.raises(RefundDomainError, match="Dinheiro insuficiente"):
        create_refund_guarded(
            db,
            restaurante_id=1,
            payment_id="p-cash-last-cent",
            turno_id=1,
            usuario_id="u-caixa",
            valor=Decimal("0.01"),
            motivo="Mais um centavo",
            idempotency_key="refund-one-cent-too-far",
            metodo_devolucao="dinheiro",
        )


def test_activity_feed_uses_actual_refund_payout_method(db):
    payment = add_payment(db, "p-feed", 20, method="cartao_credito")
    shift = db.query(CaixaTurno).filter(CaixaTurno.id == 1).one()
    shift.saldo_inicial = 50
    db.commit()
    make_refund(db, payment.id, 5, "refund-feed-cash", method="dinheiro")

    activities, _ = recent_cash_activities(db, 1, shift, limite=10)
    refund_activity = next(activity for activity in activities if activity["tipo"] == "estorno")
    assert refund_activity["valor"] == 5.0
    assert refund_activity["metodo"] == "dinheiro"
    assert refund_activity["operador_nome"] == "Caixa Teste"


def test_invalid_refund_method_is_rejected_before_financial_mutation(db):
    add_payment(db, "p-invalid-method", 10)
    with pytest.raises(RefundDomainError, match="Método de devolução inválido"):
        create_refund_guarded(
            db,
            restaurante_id=1,
            payment_id="p-invalid-method",
            turno_id=1,
            usuario_id="u-caixa",
            valor=1,
            motivo="Método inexistente",
            idempotency_key="refund-invalid-method",
            metodo_devolucao="bitcoin",
        )
    assert db.query(PagamentoEstorno).count() == 0

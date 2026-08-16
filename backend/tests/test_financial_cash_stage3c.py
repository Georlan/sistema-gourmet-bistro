from __future__ import annotations

import datetime
from decimal import Decimal

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, current_restaurante_id
from app.financial_models import PagamentoAlocacao, PagamentoEstorno
from app.financial_refund_models import (
    PagamentoEstornoAlocacao,
    PagamentoEstornoLiquidacao,
)
from app.models import CaixaTurno, Comanda, Pagamento, Restaurante, Usuario
from app.routes.financial_cash_routes import ReconciledCloseRequest, fechar_turno_reconciliado
from app.services.cash_reconciliation import (
    RefundDomainError,
    cash_shift_totals,
    create_refund,
    refund_payload,
)
from app.services.financeiro import totais_financeiros


engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSession = sessionmaker(bind=engine, autocommit=False, autoflush=False)


@pytest.fixture()
def db():
    token = current_restaurante_id.set(1)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    session = TestingSession()
    try:
        session.add(Restaurante(id=1, nome="Koma Test", plano="premium"))
        session.add(Restaurante(id=2, nome="Outro", plano="premium"))
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
        session.add(Usuario(
            id="u-t2",
            restaurante_id=2,
            nome="Outro Caixa",
            usuario="caixa2",
            senha_hash="x",
            role="caixa",
            cargo="caixa",
            status="ativo",
        ))
        session.commit()
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)
        current_restaurante_id.reset(token)


def add_shift(
    db,
    shift_id: int,
    *,
    opened: datetime.datetime,
    initial: float = 0,
    status: str = "aberto",
):
    shift = CaixaTurno(
        id=shift_id,
        restaurante_id=1,
        aberto_por_id="u-caixa",
        aberto_em=opened,
        saldo_inicial=initial,
        status=status,
    )
    if status == "fechado":
        shift.fechado_em = opened + datetime.timedelta(hours=6)
        shift.fechado_por_id = "u-caixa"
    db.add(shift)
    db.commit()
    return shift


def add_payment(
    db,
    *,
    payment_id: str,
    shift_id: int,
    value: float,
    method: str = "pix",
    command_ids: tuple[str, ...] = ("cmd-1",),
    allocations: tuple[float, ...] | None = None,
    status: str = "aprovado",
):
    now = datetime.datetime(2026, 8, 16, 20, 0)
    for index, command_id in enumerate(command_ids):
        if db.query(Comanda).filter(Comanda.id == command_id).first() is None:
            db.add(Comanda(
                id=command_id,
                restaurante_id=1,
                garcom_id="u-caixa",
                fechada=True,
                fechado_em=now,
                criado_em=now,
                numero_pedido=100 + index,
                valor_pago=value,
            ))
    db.commit()
    payment = Pagamento(
        id=payment_id,
        restaurante_id=1,
        comanda_id=command_ids[0],
        turno_id=shift_id,
        valor=value,
        metodo=method,
        status=status,
        idempotency_key=f"payment-{payment_id}",
        criado_em=now,
    )
    db.add(payment)
    db.commit()
    if status == "aprovado":
        values = allocations or (value,)
        for command_id, allocated in zip(command_ids, values):
            db.add(PagamentoAlocacao(
                restaurante_id=1,
                pagamento_id=payment_id,
                comanda_id=command_id,
                atendimento_id=None,
                valor=allocated,
                criado_em=now,
            ))
        db.commit()
    return payment


def refund(
    db,
    payment_id: str,
    shift_id: int,
    value: float,
    *,
    key: str,
    method: str | None = None,
    allocations=None,
):
    return create_refund(
        db,
        restaurante_id=1,
        payment_id=payment_id,
        turno_id=shift_id,
        usuario_id="u-caixa",
        valor=value,
        motivo="Devolução de teste",
        idempotency_key=key,
        metodo_devolucao=method,
        alocacoes=allocations,
    )


def test_same_method_refund_reduces_expected_cash_and_net_revenue(db):
    shift = add_shift(
        db,
        1,
        opened=datetime.datetime(2026, 8, 16, 18, 0),
        initial=50,
    )
    add_payment(db, payment_id="p-cash", shift_id=1, value=100, method="dinheiro")
    created = refund(db, "p-cash", 1, 30, key="refund-cash-001")
    db.commit()

    totals = cash_shift_totals(db, 1, shift)
    assert totals.vendas_brutas == Decimal("100.00")
    assert totals.estornos == Decimal("30.00")
    assert totals.vendas_liquidas == Decimal("70.00")
    assert totals.total_dinheiro == Decimal("70.00")
    assert totals.saldo_esperado_dinheiro == Decimal("120.00")
    assert refund_payload(db, 1, created)["saldo_estornavel_pagamento"] == 70.0


def test_card_sale_refunded_in_cash_preserves_sales_method_but_moves_drawer(db):
    old = add_shift(
        db,
        1,
        opened=datetime.datetime(2026, 8, 15, 18, 0),
        status="fechado",
    )
    payment = add_payment(
        db,
        payment_id="p-card-old",
        shift_id=1,
        value=80,
        method="cartao_credito",
    )
    current = add_shift(
        db,
        2,
        opened=datetime.datetime(2026, 8, 16, 18, 0),
        initial=100,
    )
    created = refund(
        db,
        "p-card-old",
        2,
        30,
        key="refund-cross-001",
        method="dinheiro",
    )
    db.commit()

    current_totals = cash_shift_totals(db, 1, current)
    assert current_totals.estornos_dinheiro == Decimal("30.00")
    assert current_totals.saldo_esperado_dinheiro == Decimal("70.00")
    assert current_totals.total_cartao == Decimal("0.00")

    # Relatório de receita continua atribuindo o estorno à venda original em cartão.
    report = totais_financeiros([payment], [created])
    assert report.bruto_por_metodo["cartao"] == Decimal("80.00")
    assert report.estornos_por_metodo["cartao"] == Decimal("30.00")
    payload = refund_payload(db, 1, created)
    assert payload["metodo_original"] == "cartao_credito"
    assert payload["metodo_devolucao"] == "dinheiro"


def test_old_pix_refund_can_make_current_shift_digital_net_negative(db):
    add_shift(
        db,
        1,
        opened=datetime.datetime(2026, 8, 15, 18, 0),
        status="fechado",
    )
    add_payment(db, payment_id="p-pix-old", shift_id=1, value=40, method="pix")
    current = add_shift(
        db,
        2,
        opened=datetime.datetime(2026, 8, 16, 18, 0),
        initial=0,
    )
    refund(db, "p-pix-old", 2, 40, key="refund-pix-old", method="pix")
    db.commit()

    totals = cash_shift_totals(db, 1, current)
    assert totals.bruto_pix == Decimal("0.00")
    assert totals.estornos_pix == Decimal("40.00")
    assert totals.total_pix == Decimal("-40.00")
    assert totals.vendas_liquidas == Decimal("-40.00")

    user = db.query(Usuario).filter(Usuario.id == "u-caixa").one()
    result = fechar_turno_reconciliado(
        ReconciledCloseRequest(
            declarado_dinheiro=0,
            declarado_cartao=0,
            declarado_pix=-40,
            observacao="",
        ),
        BackgroundTasks(),
        db,
        user,
    )
    assert result["diferenca_total"] == 0.0
    assert result["esperado_pix"] == -40.0


def test_cash_refund_without_physical_balance_is_blocked(db):
    add_shift(
        db,
        1,
        opened=datetime.datetime(2026, 8, 15, 18, 0),
        status="fechado",
    )
    add_payment(db, payment_id="p-old", shift_id=1, value=50, method="cartao")
    add_shift(
        db,
        2,
        opened=datetime.datetime(2026, 8, 16, 18, 0),
        initial=10,
    )
    with pytest.raises(RefundDomainError, match="Dinheiro insuficiente") as exc:
        refund(
            db,
            "p-old",
            2,
            20,
            key="refund-no-cash",
            method="dinheiro",
        )
    assert exc.value.status_code == 409
    assert db.query(PagamentoEstorno).count() == 0


def test_partial_refund_of_split_payment_requires_explicit_origin(db):
    add_shift(db, 1, opened=datetime.datetime(2026, 8, 16, 18, 0), initial=100)
    add_payment(
        db,
        payment_id="p-split",
        shift_id=1,
        value=100,
        method="pix",
        command_ids=("cmd-a", "cmd-b"),
        allocations=(60, 40),
    )
    with pytest.raises(RefundDomainError, match="múltiplas Contas") as exc:
        refund(db, "p-split", 1, 20, key="refund-split-no-origin")
    assert exc.value.status_code == 409

    created = refund(
        db,
        "p-split",
        1,
        20,
        key="refund-split-explicit",
        allocations=[("cmd-b", 20)],
    )
    db.commit()
    allocations = db.query(PagamentoEstornoAlocacao).filter(
        PagamentoEstornoAlocacao.estorno_id == created.id,
    ).all()
    assert [(row.comanda_id, row.valor) for row in allocations] == [("cmd-b", 20.0)]


def test_full_remaining_refund_of_split_payment_is_unambiguous(db):
    add_shift(db, 1, opened=datetime.datetime(2026, 8, 16, 18, 0), initial=100)
    add_payment(
        db,
        payment_id="p-split-full",
        shift_id=1,
        value=100,
        method="pix",
        command_ids=("cmd-fa", "cmd-fb"),
        allocations=(60, 40),
    )
    first = refund(
        db,
        "p-split-full",
        1,
        20,
        key="refund-split-first",
        allocations=[("cmd-fa", 20)],
    )
    db.commit()
    second = refund(
        db,
        "p-split-full",
        1,
        80,
        key="refund-split-rest",
    )
    db.commit()
    rows = db.query(PagamentoEstornoAlocacao).filter(
        PagamentoEstornoAlocacao.estorno_id == second.id,
    ).order_by(PagamentoEstornoAlocacao.comanda_id).all()
    assert [(row.comanda_id, row.valor) for row in rows] == [
        ("cmd-fa", 40.0),
        ("cmd-fb", 40.0),
    ]
    assert refund_payload(db, 1, second)["saldo_estornavel_pagamento"] == 0.0


def test_over_refund_and_origin_overdraw_are_blocked(db):
    add_shift(db, 1, opened=datetime.datetime(2026, 8, 16, 18, 0), initial=100)
    add_payment(
        db,
        payment_id="p-limits",
        shift_id=1,
        value=100,
        command_ids=("cmd-la", "cmd-lb"),
        allocations=(60, 40),
    )
    with pytest.raises(RefundDomainError, match="excede seu saldo"):
        refund(
            db,
            "p-limits",
            1,
            70,
            key="refund-origin-over",
            allocations=[("cmd-la", 70)],
        )
    with pytest.raises(RefundDomainError, match="saldo disponível"):
        refund(
            db,
            "p-limits",
            1,
            101,
            key="refund-total-over",
            allocations=[("cmd-la", 60), ("cmd-lb", 41)],
        )


def test_idempotent_retry_returns_same_event_and_payload_drift_conflicts(db):
    add_shift(db, 1, opened=datetime.datetime(2026, 8, 16, 18, 0), initial=100)
    add_payment(db, payment_id="p-idem", shift_id=1, value=50, method="dinheiro")
    first = refund(db, "p-idem", 1, 10, key="refund-idem-001")
    db.commit()
    second = refund(db, "p-idem", 1, 10, key="refund-idem-001")
    assert first.id == second.id
    assert db.query(PagamentoEstorno).count() == 1

    with pytest.raises(RefundDomainError, match="outro conteúdo") as exc:
        refund(db, "p-idem", 1, 11, key="refund-idem-001")
    assert exc.value.status_code == 409


def test_closed_shift_pending_payment_and_cross_tenant_are_rejected(db):
    add_shift(
        db,
        1,
        opened=datetime.datetime(2026, 8, 16, 18, 0),
        status="fechado",
    )
    add_payment(db, payment_id="p-closed", shift_id=1, value=20)
    with pytest.raises(RefundDomainError, match="turno de caixa aberto"):
        refund(db, "p-closed", 1, 10, key="refund-closed")

    add_shift(db, 2, opened=datetime.datetime(2026, 8, 16, 19, 0))
    pending = add_payment(
        db,
        payment_id="p-pending",
        shift_id=2,
        value=20,
        status="pendente",
    )
    with pytest.raises(RefundDomainError, match="Somente pagamentos aprovados"):
        refund(db, pending.id, 2, 10, key="refund-pending")

    with pytest.raises(RefundDomainError, match="Pagamento não encontrado") as exc:
        create_refund(
            db,
            restaurante_id=2,
            payment_id="p-closed",
            turno_id=2,
            usuario_id="u-t2",
            valor=10,
            motivo="Tentativa outro tenant",
            idempotency_key="refund-cross-tenant",
        )
    assert exc.value.status_code == 404


def test_refund_is_financial_event_and_does_not_reopen_operational_account(db):
    add_shift(db, 1, opened=datetime.datetime(2026, 8, 16, 18, 0), initial=100)
    payment = add_payment(db, payment_id="p-no-reopen", shift_id=1, value=70)
    command = db.query(Comanda).filter(Comanda.id == payment.comanda_id).one()
    before_paid = command.valor_pago
    before_closed = command.fechada

    refund(db, "p-no-reopen", 1, 20, key="refund-no-reopen")
    db.commit()
    db.refresh(command)
    assert command.valor_pago == before_paid
    assert command.fechada == before_closed


def test_refund_payout_ledger_is_one_to_one_and_auditable(db):
    add_shift(db, 1, opened=datetime.datetime(2026, 8, 16, 18, 0), initial=100)
    add_payment(db, payment_id="p-ledger", shift_id=1, value=25, method="cartao_debito")
    created = refund(
        db,
        "p-ledger",
        1,
        5,
        key="refund-ledger-001",
        method="pix",
    )
    db.commit()
    liquidation = db.query(PagamentoEstornoLiquidacao).filter(
        PagamentoEstornoLiquidacao.estorno_id == created.id,
    ).one()
    assert liquidation.metodo_devolucao == "pix"
    assert created.metodo == "cartao_debito"

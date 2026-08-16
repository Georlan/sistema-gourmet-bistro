import datetime
from types import SimpleNamespace

from app.models import CaixaTurno
from app.services.financeiro import dia_operacional_do_turno, money, totais_financeiros


def test_financial_totals_separate_gross_refunds_and_net_sales():
    payments = [
        SimpleNamespace(valor=100.00, metodo="dinheiro"),
        SimpleNamespace(valor=50.00, metodo="pix"),
        SimpleNamespace(valor=25.00, metodo="cartao_credito"),
    ]
    refunds = [
        SimpleNamespace(valor=20.00, metodo="dinheiro"),
        SimpleNamespace(valor=5.00, metodo="cartao_credito"),
    ]

    totals = totais_financeiros(payments, refunds)

    assert totals.vendas_brutas == money("175.00")
    assert totals.estornos == money("25.00")
    assert totals.vendas_liquidas == money("150.00")
    assert totals.bruto_por_metodo == {
        "dinheiro": money("100.00"),
        "pix": money("50.00"),
        "cartao": money("25.00"),
    }
    assert totals.estornos_por_metodo == {
        "dinheiro": money("20.00"),
        "cartao": money("5.00"),
    }
    assert totals.liquido_por_metodo == {
        "dinheiro": money("80.00"),
        "pix": money("50.00"),
        "cartao": money("20.00"),
    }


def test_operational_day_is_the_local_date_when_cash_shift_opened():
    # 21:00 UTC = 18:00 em America/Fortaleza. Pagamentos posteriores à meia-noite
    # continuam pertencendo a este dia enquanto vinculados ao mesmo turno.
    turno = CaixaTurno(
        restaurante_id=1,
        aberto_por_id="u-test",
        saldo_inicial=0,
        status="aberto",
        aberto_em=datetime.datetime(2026, 8, 16, 21, 0, 0),
    )

    assert dia_operacional_do_turno(turno) == datetime.date(2026, 8, 16)


def test_money_rounds_with_decimal_semantics_instead_of_binary_float_math():
    assert money(0.1 + 0.2) == money("0.30")
    assert money("12.345") == money("12.35")

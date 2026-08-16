from __future__ import annotations

import datetime
from decimal import Decimal

import pytest
from fastapi import BackgroundTasks
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, current_restaurante_id, get_db
from app.financial_models import PagamentoAlocacao
from app.main import app
from app.models import (
    CaixaMovimentacao,
    CaixaTurno,
    Comanda,
    Pagamento,
    Restaurante,
    Usuario,
)
from app.operational_models import AtendimentoComanda, AtendimentoMesa
from app.routes.financial_cash_routes import ReconciledCloseRequest, fechar_turno_reconciliado
from app.security import create_access_token
from app.services.cash_reconciliation import cash_shift_totals, create_refund


TENANT = 3410
ADMIN = "usr-stage3d-admin"
engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSession = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def override_get_db():
    db = TestingSession()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def stage3d_db():
    token = current_restaurante_id.set(TENANT)
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = TestingSession()
    try:
        db.add(Restaurante(id=TENANT, nome="Stage 3D", plano="premium"))
        db.add(
            Usuario(
                id=ADMIN,
                restaurante_id=TENANT,
                nome="Admin Stage 3D",
                usuario="admin-stage3d",
                senha_hash="x",
                role="admin",
                cargo="admin",
                status="ativo",
            )
        )
        db.commit()
        yield
    finally:
        db.close()
        app.dependency_overrides.pop(get_db, None)
        Base.metadata.drop_all(engine)
        current_restaurante_id.reset(token)


def auth_headers() -> dict[str, str]:
    token = create_access_token(subject=ADMIN, restaurante_id=TENANT, role="admin")
    return {"Authorization": f"Bearer {token}"}


def add_account(db, *, attendance_id: str, account_number: int, command_id: str) -> None:
    db.add(
        AtendimentoMesa(
            id=attendance_id,
            restaurante_id=TENANT,
            numero_conta=account_number,
            periodo_ref="2026-08",
            mesa_id=None,
            status="fechado",
            proxima_sequencia=2,
        )
    )
    db.flush()
    db.add(
        Comanda(
            id=command_id,
            restaurante_id=TENANT,
            mesa_id=None,
            garcom_id=ADMIN,
            tipo="Consumo no Local",
            numero_pedido=account_number,
            valor_pago=0,
            fechada=True,
        )
    )
    db.flush()
    db.add(
        AtendimentoComanda(
            restaurante_id=TENANT,
            atendimento_id=attendance_id,
            comanda_id=command_id,
        )
    )
    db.flush()


def add_payment(
    db,
    *,
    payment_id: str,
    shift_id: int,
    command_id: str,
    attendance_id: str,
    value: float,
    method: str,
    created_at: datetime.datetime,
) -> Pagamento:
    payment = Pagamento(
        id=payment_id,
        restaurante_id=TENANT,
        comanda_id=command_id,
        turno_id=shift_id,
        valor=value,
        metodo=method,
        status="aprovado",
        idempotency_key=f"idem-{payment_id}",
        criado_em=created_at,
    )
    db.add(payment)
    db.flush()
    db.add(
        PagamentoAlocacao(
            restaurante_id=TENANT,
            pagamento_id=payment_id,
            comanda_id=command_id,
            atendimento_id=attendance_id,
            valor=value,
            criado_em=created_at,
        )
    )
    db.flush()
    return payment


def test_report_dashboard_cash_and_closing_reconcile_from_same_events():
    """Prova integrada da Etapa 3 sem confundir receita com gaveta física.

    Cenário deliberadamente adversarial:
    - turno abre com R$ 100 em espécie;
    - recebe R$ 100 em dinheiro, R$ 80 no cartão e R$ 20 no Pix;
    - o Pix acontece 00:30 do dia civil seguinte, mas pertence ao mesmo dia operacional;
    - R$ 30 da venda no cartão são devolvidos em DINHEIRO;
    - há R$ 20 de suprimento e R$ 10 de sangria;
    - fechamento declara exatamente o que a liquidação espera.

    Receita líquida = 200 - 30 = 170.
    Gaveta esperada = 100 fundo + 100 dinheiro - 30 devolução + 20 suprimento - 10 sangria = 180.
    Cartão esperado no caixa = 80, porque a devolução saiu em dinheiro.
    No relatório, porém, o estorno continua abatendo cartão, preservando a origem da venda.
    """
    db = TestingSession()
    try:
        shift = CaixaTurno(
            id=1,
            restaurante_id=TENANT,
            aberto_por_id=ADMIN,
            aberto_em=datetime.datetime(2026, 8, 15, 21, 0),  # 18:00 Fortaleza
            saldo_inicial=100,
            status="aberto",
        )
        db.add(shift)
        db.flush()

        add_account(db, attendance_id="att-cash", account_number=201, command_id="cmd-cash")
        add_account(db, attendance_id="att-card", account_number=202, command_id="cmd-card")
        add_account(db, attendance_id="att-pix", account_number=203, command_id="cmd-pix")

        add_payment(
            db,
            payment_id="pay-cash",
            shift_id=1,
            command_id="cmd-cash",
            attendance_id="att-cash",
            value=100,
            method="dinheiro",
            created_at=datetime.datetime(2026, 8, 15, 22, 0),
        )
        add_payment(
            db,
            payment_id="pay-card",
            shift_id=1,
            command_id="cmd-card",
            attendance_id="att-card",
            value=80,
            method="cartao_credito",
            created_at=datetime.datetime(2026, 8, 16, 0, 30),
        )
        add_payment(
            db,
            payment_id="pay-pix-midnight",
            shift_id=1,
            command_id="cmd-pix",
            attendance_id="att-pix",
            value=20,
            method="pix",
            created_at=datetime.datetime(2026, 8, 16, 3, 30),  # 00:30 Fortaleza
        )
        db.add_all(
            [
                CaixaMovimentacao(
                    restaurante_id=TENANT,
                    turno_id=1,
                    usuario_id=ADMIN,
                    tipo="suprimento",
                    valor=20,
                    descricao="Troco adicional",
                ),
                CaixaMovimentacao(
                    restaurante_id=TENANT,
                    turno_id=1,
                    usuario_id=ADMIN,
                    tipo="sangria",
                    valor=10,
                    descricao="Retirada de segurança",
                ),
            ]
        )
        db.commit()

        refund = create_refund(
            db,
            restaurante_id=TENANT,
            payment_id="pay-card",
            turno_id=1,
            usuario_id=ADMIN,
            valor=30,
            motivo="Devolução integrada da Etapa 3D",
            idempotency_key="stage3d-card-to-cash",
            metodo_devolucao="dinheiro",
        )
        db.commit()
        assert refund.metodo == "cartao_credito"

        cash = cash_shift_totals(db, TENANT, shift)
        assert cash.vendas_brutas == Decimal("200.00")
        assert cash.estornos == Decimal("30.00")
        assert cash.vendas_liquidas == Decimal("170.00")
        assert cash.total_dinheiro == Decimal("70.00")
        assert cash.total_cartao == Decimal("80.00")
        assert cash.total_pix == Decimal("20.00")
        assert cash.total_suprimentos == Decimal("20.00")
        assert cash.total_sangrias == Decimal("10.00")
        assert cash.saldo_esperado_dinheiro == Decimal("180.00")
    finally:
        db.close()

    client = TestClient(app)
    headers = auth_headers()
    period = "?data_inicio=2026-08-15&data_fim=2026-08-15"

    report_response = client.get(f"/relatorios/visao-geral{period}", headers=headers)
    dashboard_response = client.get(f"/comandas/estatisticas/geral{period}", headers=headers)
    cash_response = client.get("/caixa/turno-atual/resumo", headers=headers)

    assert report_response.status_code == 200, report_response.text
    assert dashboard_response.status_code == 200, dashboard_response.text
    assert cash_response.status_code == 200, cash_response.text

    report = report_response.json()
    dashboard = dashboard_response.json()
    cash_summary = cash_response.json()

    # Receita: relatório e dashboard têm de ser duas leituras do mesmo ledger.
    assert report["vendas_brutas"] == dashboard["vendas_brutas"] == 200.0
    assert report["estornos"] == dashboard["estornos"] == 30.0
    assert report["vendas_liquidas"] == dashboard["vendas_liquidas"] == 170.0
    assert report["faturamento_total"] == dashboard["faturamento"] == 170.0
    assert report["breakdown_pagamentos"] == dashboard["breakdown_pagamentos"] == {
        "dinheiro": 100.0,
        "pix": 20.0,
        "cartao": 50.0,
    }

    # O pagamento de 00:30 não escapa para o dia civil seguinte.
    next_day = client.get(
        "/relatorios/visao-geral?data_inicio=2026-08-16&data_fim=2026-08-16",
        headers=headers,
    )
    assert next_day.status_code == 200
    assert next_day.json()["vendas_brutas"] == 0.0

    # Liquidação/caixa usa o meio REAL da devolução, sem reclassificar a venda original.
    assert cash_summary["total_vendas"] == 170.0
    assert cash_summary["total_dinheiro"] == 70.0
    assert cash_summary["total_cartao"] == 80.0
    assert cash_summary["total_pix"] == 20.0
    assert cash_summary["total_suprimentos"] == 20.0
    assert cash_summary["total_sangrias"] == 10.0
    assert cash_summary["saldo_esperado_dinheiro"] == 180.0

    db = TestingSession()
    try:
        user = db.query(Usuario).filter(
            Usuario.restaurante_id == TENANT,
            Usuario.id == ADMIN,
        ).one()
        close = fechar_turno_reconciliado(
            ReconciledCloseRequest(
                declarado_dinheiro=180,
                declarado_cartao=80,
                declarado_pix=20,
                observacao="",
            ),
            BackgroundTasks(),
            db,
            user,
        )
        assert close["esperado_dinheiro"] == 180.0
        assert close["esperado_cartao"] == 80.0
        assert close["esperado_pix"] == 20.0
        assert close["total_esperado"] == 280.0
        assert close["total_declarado"] == 280.0
        assert close["diferenca_total"] == 0.0
    finally:
        db.close()

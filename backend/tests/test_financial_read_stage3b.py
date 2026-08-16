import datetime
import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, current_restaurante_id, get_db
from app.financial_models import PagamentoAlocacao, PagamentoEstorno
from app.main import app
from app.models import CaixaTurno, Comanda, Pagamento, Restaurante, Usuario
from app.operational_models import AtendimentoComanda, AtendimentoMesa
from app.security import get_password_hash


DB_FILE = "./test_financial_read_stage3b.db"
engine = create_engine(
    f"sqlite:///{DB_FILE}",
    connect_args={"check_same_thread": False, "timeout": 30},
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
TENANT = 3302
ADMIN = "usr-stage3b-admin"


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def stage3b_db():
    token = current_restaurante_id.set(TENANT)
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        db.add(Restaurante(id=TENANT, nome="Stage 3B", plano="bistro"))
        db.flush()
        db.add(
            Usuario(
                id=ADMIN,
                restaurante_id=TENANT,
                nome="Admin Stage 3B",
                usuario="admin-stage3b",
                senha_hash=get_password_hash("123"),
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
        current_restaurante_id.reset(token)
        engine.dispose()
        try:
            os.remove(DB_FILE)
        except OSError:
            pass


def auth_headers(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/auth/login",
        json={"username": "admin-stage3b", "password": "123"},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def add_turn(
    db,
    turn_id: int,
    opened_utc: datetime.datetime,
    *,
    status: str = "fechado",
):
    db.add(
        CaixaTurno(
            id=turn_id,
            restaurante_id=TENANT,
            aberto_por_id=ADMIN,
            aberto_em=opened_utc,
            fechado_em=(opened_utc + datetime.timedelta(hours=8)) if status == "fechado" else None,
            fechado_por_id=ADMIN if status == "fechado" else None,
            saldo_inicial=0,
            status=status,
        )
    )
    db.flush()


def add_account(
    db,
    attendance_id: str,
    account_number: int,
    command_ids: list[str],
    *,
    command_type: str = "Consumo no Local",
):
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
    for index, command_id in enumerate(command_ids):
        db.add(
            Comanda(
                id=command_id,
                restaurante_id=TENANT,
                mesa_id=None,
                garcom_id=ADMIN,
                tipo=command_type,
                numero_pedido=account_number + index,
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
    payment_id: str,
    turn_id: int,
    command_id: str,
    value: float,
    paid_utc: datetime.datetime,
    *,
    method: str = "pix",
    allocations: list[tuple[str, str | None, float]] | None = None,
):
    payment = Pagamento(
        id=payment_id,
        restaurante_id=TENANT,
        comanda_id=command_id,
        turno_id=turn_id,
        valor=value,
        metodo=method,
        status="aprovado",
        criado_em=paid_utc,
        idempotency_key=f"idem-{payment_id}",
    )
    db.add(payment)
    db.flush()
    for allocated_command, attendance_id, allocated_value in allocations or [
        (command_id, None, value)
    ]:
        db.add(
            PagamentoAlocacao(
                restaurante_id=TENANT,
                pagamento_id=payment_id,
                comanda_id=allocated_command,
                atendimento_id=attendance_id,
                valor=allocated_value,
                criado_em=paid_utc,
            )
        )
    db.flush()
    return payment


def test_payment_after_midnight_stays_on_turn_operational_day():
    db = TestingSessionLocal()
    try:
        # 21:00 UTC = 18:00 em Fortaleza no dia 16.
        add_turn(db, 1, datetime.datetime(2026, 8, 16, 21, 0))
        add_account(db, "att-46", 46, ["cmd-46"])
        # 03:30 UTC do dia 17 = 00:30 local do dia 17, ainda no turno do dia 16.
        add_payment(
            db,
            "pay-midnight",
            1,
            "cmd-46",
            100,
            datetime.datetime(2026, 8, 17, 3, 30),
            allocations=[("cmd-46", "att-46", 100)],
        )
        db.commit()
    finally:
        db.close()

    client = TestClient(app)
    headers = auth_headers(client)
    day16 = client.get(
        "/relatorios/visao-geral?data_inicio=2026-08-16&data_fim=2026-08-16",
        headers=headers,
    )
    assert day16.status_code == 200, day16.text
    data = day16.json()
    assert data["faturamento_total"] == 100.0
    assert data["vendas_brutas"] == 100.0
    assert data["estornos"] == 0.0
    assert data["vendas_por_dia"] == [
        {
            "data": "2026-08-16",
            "bruto": 100.0,
            "estornos": 0.0,
            "total": 100.0,
            "quantidade_pedidos": 1,
        }
    ]
    assert next(row for row in data["horarios_pico"] if row["hora"] == "00h")[
        "faturamento"
    ] == 100.0

    day17 = client.get(
        "/relatorios/visao-geral?data_inicio=2026-08-17&data_fim=2026-08-17",
        headers=headers,
    )
    assert day17.status_code == 200
    assert day17.json()["faturamento_total"] == 0.0


def test_two_commands_of_same_account_are_one_financial_sale():
    db = TestingSessionLocal()
    try:
        add_turn(db, 2, datetime.datetime(2026, 8, 16, 21, 0))
        add_account(db, "att-70", 70, ["cmd-70-a", "cmd-70-b"])
        add_payment(
            db,
            "pay-70-a",
            2,
            "cmd-70-a",
            30,
            datetime.datetime(2026, 8, 16, 22, 0),
            allocations=[("cmd-70-a", "att-70", 30)],
        )
        add_payment(
            db,
            "pay-70-b",
            2,
            "cmd-70-b",
            20,
            datetime.datetime(2026, 8, 16, 23, 0),
            method="dinheiro",
            allocations=[("cmd-70-b", "att-70", 20)],
        )
        db.commit()
    finally:
        db.close()

    client = TestClient(app)
    headers = auth_headers(client)
    response = client.get(
        "/relatorios/visao-geral?data_inicio=2026-08-16&data_fim=2026-08-16",
        headers=headers,
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["total_pedidos"] == 1
    assert data["vendas_brutas"] == 50.0
    assert data["ticket_medio_bruto"] == 50.0
    assert data["breakdown_bruto"] == {
        "dinheiro": 20.0,
        "pix": 30.0,
        "cartao": 0.0,
    }

    details = client.get(
        "/relatorios/vendas-detalhes?data_inicio=2026-08-16&data_fim=2026-08-16",
        headers=headers,
    )
    assert details.status_code == 200
    rows = details.json()
    assert len(rows) == 1
    assert rows[0]["numero_pedido"] == 70
    assert rows[0]["identidade_financeira"] == "Conta"
    assert rows[0]["valor_bruto"] == 50.0


def test_one_payment_split_across_two_merged_families_counts_two_accounts_without_duplication():
    db = TestingSessionLocal()
    try:
        add_turn(db, 3, datetime.datetime(2026, 8, 16, 21, 0))
        add_account(db, "att-80", 80, ["cmd-80"])
        add_account(db, "att-81", 81, ["cmd-81"])
        add_payment(
            db,
            "pay-merged",
            3,
            "cmd-80",
            50,
            datetime.datetime(2026, 8, 16, 23, 30),
            allocations=[
                ("cmd-80", "att-80", 20),
                ("cmd-81", "att-81", 30),
            ],
        )
        db.commit()
    finally:
        db.close()

    client = TestClient(app)
    headers = auth_headers(client)
    response = client.get(
        "/relatorios/visao-geral?data_inicio=2026-08-16&data_fim=2026-08-16",
        headers=headers,
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["vendas_brutas"] == 50.0
    assert data["total_pedidos"] == 2
    assert data["ticket_medio_bruto"] == 25.0

    details = client.get(
        "/relatorios/vendas-detalhes?data_inicio=2026-08-16&data_fim=2026-08-16",
        headers=headers,
    ).json()
    assert {row["numero_pedido"] for row in details} == {80, 81}
    assert sum(row["valor_bruto"] for row in details) == 50.0


def test_refund_hits_refund_turn_day_and_reports_reconcile_with_dashboard():
    db = TestingSessionLocal()
    try:
        add_turn(db, 4, datetime.datetime(2026, 8, 16, 21, 0))
        add_turn(db, 5, datetime.datetime(2026, 8, 17, 21, 0))
        add_account(db, "att-90", 90, ["cmd-90"])
        payment = add_payment(
            db,
            "pay-refund-base",
            4,
            "cmd-90",
            100,
            datetime.datetime(2026, 8, 16, 22, 0),
            method="cartao_credito",
            allocations=[("cmd-90", "att-90", 100)],
        )
        db.add(
            PagamentoEstorno(
                id="refund-20",
                restaurante_id=TENANT,
                pagamento_id=payment.id,
                turno_id=5,
                usuario_id=ADMIN,
                valor=20,
                metodo="cartao_credito",
                motivo="Devolução parcial de teste",
                idempotency_key="refund-stage3b-20",
                criado_em=datetime.datetime(2026, 8, 17, 22, 0),
            )
        )
        db.commit()
    finally:
        db.close()

    client = TestClient(app)
    headers = auth_headers(client)

    day16 = client.get(
        "/relatorios/visao-geral?data_inicio=2026-08-16&data_fim=2026-08-16",
        headers=headers,
    ).json()
    assert day16["vendas_brutas"] == 100.0
    assert day16["estornos"] == 0.0
    assert day16["vendas_liquidas"] == 100.0

    day17 = client.get(
        "/relatorios/visao-geral?data_inicio=2026-08-17&data_fim=2026-08-17",
        headers=headers,
    ).json()
    assert day17["vendas_brutas"] == 0.0
    assert day17["estornos"] == 20.0
    assert day17["vendas_liquidas"] == -20.0

    period_url = "?data_inicio=2026-08-16&data_fim=2026-08-17"
    report = client.get(f"/relatorios/visao-geral{period_url}", headers=headers)
    dashboard = client.get(f"/comandas/estatisticas/geral{period_url}", headers=headers)
    assert report.status_code == 200, report.text
    assert dashboard.status_code == 200, dashboard.text
    report_data = report.json()
    dashboard_data = dashboard.json()

    assert report_data["vendas_brutas"] == dashboard_data["vendas_brutas"] == 100.0
    assert report_data["estornos"] == dashboard_data["estornos"] == 20.0
    assert report_data["vendas_liquidas"] == dashboard_data["vendas_liquidas"] == 80.0
    assert report_data["faturamento_total"] == dashboard_data["faturamento"] == 80.0
    assert report_data["breakdown_pagamentos"] == dashboard_data["breakdown_pagamentos"] == {
        "dinheiro": 0.0,
        "pix": 0.0,
        "cartao": 80.0,
    }

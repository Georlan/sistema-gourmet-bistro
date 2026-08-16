import datetime
import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, current_restaurante_id, get_db
from app.financial_models import PagamentoAlocacao
from app.main import app
from app.models import CaixaTurno, Comanda, Pagamento, Restaurante, Usuario
from app.operational_models import AtendimentoComanda, AtendimentoMesa
from app.security import get_password_hash


DB_FILE = "./test_financial_read_adversarial_stage3b.db"
engine = create_engine(
    f"sqlite:///{DB_FILE}",
    connect_args={"check_same_thread": False, "timeout": 30},
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
TENANT = 3304
ADMIN = "usr-stage3b-adversarial"


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def setup_db():
    token = current_restaurante_id.set(TENANT)
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        db.add(Restaurante(id=TENANT, nome="Stage 3B Adversarial", plano="bistro"))
        db.flush()
        db.add(
            Usuario(
                id=ADMIN,
                restaurante_id=TENANT,
                nome="Admin Stage 3B",
                usuario="stage3b-adversarial",
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


def headers(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/auth/login",
        json={"username": "stage3b-adversarial", "password": "123"},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def add_turn(db, turn_id: int, opened_utc: datetime.datetime):
    db.add(
        CaixaTurno(
            id=turn_id,
            restaurante_id=TENANT,
            aberto_por_id=ADMIN,
            aberto_em=opened_utc,
            fechado_em=opened_utc + datetime.timedelta(hours=8),
            fechado_por_id=ADMIN,
            saldo_inicial=0,
            status="fechado",
        )
    )
    db.flush()


def add_account(db, attendance_id: str, number: int, command_id: str):
    db.add(
        AtendimentoMesa(
            id=attendance_id,
            restaurante_id=TENANT,
            numero_conta=number,
            periodo_ref="2026-08",
            mesa_id=None,
            status="fechado",
            proxima_sequencia=2,
        )
    )
    db.add(
        Comanda(
            id=command_id,
            restaurante_id=TENANT,
            garcom_id=ADMIN,
            mesa_id=None,
            tipo="Consumo no Local",
            numero_pedido=number,
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


def add_payment(db, payment_id: str, turn_id: int, command_id: str, value: float, paid_at: datetime.datetime):
    payment = Pagamento(
        id=payment_id,
        restaurante_id=TENANT,
        comanda_id=command_id,
        turno_id=turn_id,
        valor=value,
        metodo="pix",
        status="aprovado",
        criado_em=paid_at,
        idempotency_key=f"idem-{payment_id}",
    )
    db.add(payment)
    db.flush()
    return payment


def test_same_account_paid_across_two_operational_days_is_one_sale_in_period():
    db = TestingSessionLocal()
    try:
        add_turn(db, 1, datetime.datetime(2026, 8, 16, 21, 0))
        add_turn(db, 2, datetime.datetime(2026, 8, 17, 21, 0))
        add_account(db, "att-cross-day", 120, "cmd-cross-day")

        p1 = add_payment(
            db,
            "pay-cross-20",
            1,
            "cmd-cross-day",
            20,
            datetime.datetime(2026, 8, 16, 23, 0),
        )
        db.add(
            PagamentoAlocacao(
                restaurante_id=TENANT,
                pagamento_id=p1.id,
                comanda_id="cmd-cross-day",
                atendimento_id="att-cross-day",
                valor=20,
                criado_em=p1.criado_em,
            )
        )
        p2 = add_payment(
            db,
            "pay-cross-80",
            2,
            "cmd-cross-day",
            80,
            datetime.datetime(2026, 8, 17, 23, 0),
        )
        db.add(
            PagamentoAlocacao(
                restaurante_id=TENANT,
                pagamento_id=p2.id,
                comanda_id="cmd-cross-day",
                atendimento_id="att-cross-day",
                valor=80,
                criado_em=p2.criado_em,
            )
        )
        db.commit()
    finally:
        db.close()

    client = TestClient(app)
    auth = headers(client)
    response = client.get(
        "/relatorios/visao-geral?data_inicio=2026-08-16&data_fim=2026-08-17",
        headers=auth,
    )
    assert response.status_code == 200, response.text
    data = response.json()

    assert data["vendas_brutas"] == 100.0
    assert data["vendas_liquidas"] == 100.0
    assert data["total_pedidos"] == 1
    assert data["ticket_medio_bruto"] == 100.0
    assert [row["total"] for row in data["vendas_por_dia"]] == [20.0, 80.0]
    # A mesma Conta teve recebimento nos dois dias; a soma das quantidades
    # diárias não deve ser interpretada como quantidade de Contas únicas do período.
    assert [row["quantidade_pedidos"] for row in data["vendas_por_dia"]] == [1, 1]

    details = client.get(
        "/relatorios/vendas-detalhes?data_inicio=2026-08-16&data_fim=2026-08-17",
        headers=auth,
    )
    assert details.status_code == 200
    assert len(details.json()) == 1
    assert details.json()[0]["valor_bruto"] == 100.0


def test_overallocated_corrupt_ledger_never_makes_detail_sum_exceed_payment_total():
    db = TestingSessionLocal()
    try:
        add_turn(db, 3, datetime.datetime(2026, 8, 16, 21, 0))
        add_account(db, "att-corrupt-a", 130, "cmd-corrupt-a")
        add_account(db, "att-corrupt-b", 131, "cmd-corrupt-b")
        payment = add_payment(
            db,
            "pay-corrupt",
            3,
            "cmd-corrupt-a",
            50,
            datetime.datetime(2026, 8, 16, 23, 0),
        )
        # Simula dado legado/corrompido: as alocações dizem 40 + 30 para um
        # pagamento de apenas 50. A leitura financeira não pode fabricar R$ 70.
        db.add_all(
            [
                PagamentoAlocacao(
                    restaurante_id=TENANT,
                    pagamento_id=payment.id,
                    comanda_id="cmd-corrupt-a",
                    atendimento_id="att-corrupt-a",
                    valor=40,
                    criado_em=payment.criado_em,
                ),
                PagamentoAlocacao(
                    restaurante_id=TENANT,
                    pagamento_id=payment.id,
                    comanda_id="cmd-corrupt-b",
                    atendimento_id="att-corrupt-b",
                    valor=30,
                    criado_em=payment.criado_em,
                ),
            ]
        )
        db.commit()
    finally:
        db.close()

    client = TestClient(app)
    auth = headers(client)
    query = "?data_inicio=2026-08-16&data_fim=2026-08-16"
    report = client.get(f"/relatorios/visao-geral{query}", headers=auth)
    details = client.get(f"/relatorios/vendas-detalhes{query}", headers=auth)

    assert report.status_code == 200, report.text
    assert details.status_code == 200, details.text
    assert report.json()["vendas_brutas"] == 50.0
    assert sum(row["valor_bruto"] for row in details.json()) == 50.0

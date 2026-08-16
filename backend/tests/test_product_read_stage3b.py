import datetime
import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, current_restaurante_id, get_db
from app.financial_models import PagamentoAlocacao
from app.main import app
from app.models import (
    CaixaTurno,
    Categoria,
    Comanda,
    Item,
    Lancamento,
    Pagamento,
    Produto,
    Restaurante,
    Usuario,
)
from app.operational_models import AtendimentoComanda, AtendimentoMesa
from app.security import get_password_hash


DB_FILE = "./test_product_read_stage3b.db"
engine = create_engine(
    f"sqlite:///{DB_FILE}",
    connect_args={"check_same_thread": False, "timeout": 30},
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
TENANT = 3303
ADMIN = "usr-product-stage3b"


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
        db.add(Restaurante(id=TENANT, nome="Product Stage 3B", plano="bistro"))
        db.flush()
        db.add(
            Usuario(
                id=ADMIN,
                restaurante_id=TENANT,
                nome="Admin Produto",
                usuario="product-stage3b",
                senha_hash=get_password_hash("123"),
                role="admin",
                cargo="admin",
                status="ativo",
            )
        )
        db.add(Categoria(id=3303, restaurante_id=TENANT, nome="Teste"))
        db.add(
            Produto(
                id="prod-100",
                restaurante_id=TENANT,
                nome="Produto R$ 100",
                categoria_id=3303,
                preco=100,
                ativo=True,
            )
        )
        db.add(
            CaixaTurno(
                id=1,
                restaurante_id=TENANT,
                aberto_por_id=ADMIN,
                aberto_em=datetime.datetime(2026, 8, 16, 21, 0),
                fechado_em=datetime.datetime(2026, 8, 17, 5, 0),
                fechado_por_id=ADMIN,
                saldo_inicial=0,
                status="fechado",
            )
        )
        db.add(
            AtendimentoMesa(
                id="att-product",
                restaurante_id=TENANT,
                numero_conta=100,
                periodo_ref="2026-08",
                mesa_id=None,
                status="fechado",
                proxima_sequencia=2,
            )
        )
        db.add(
            Comanda(
                id="cmd-product",
                restaurante_id=TENANT,
                mesa_id=None,
                garcom_id=ADMIN,
                tipo="Consumo no Local",
                numero_pedido=100,
                valor_pago=20,
                fechada=False,
            )
        )
        db.flush()
        db.add(
            AtendimentoComanda(
                restaurante_id=TENANT,
                atendimento_id="att-product",
                comanda_id="cmd-product",
            )
        )
        db.add(
            Lancamento(
                id="lan-product",
                comanda_id="cmd-product",
                garcom_id=ADMIN,
                timestamp=datetime.datetime(2026, 8, 16, 22, 0),
            )
        )
        db.flush()
        db.add(
            Item(
                id="item-product",
                restaurante_id=TENANT,
                comanda_id="cmd-product",
                lancamento_id="lan-product",
                produto_id="prod-100",
                preco_unit=100,
                status="entregue",
            )
        )
        payment = Pagamento(
            id="pay-product-partial",
            restaurante_id=TENANT,
            comanda_id="cmd-product",
            turno_id=1,
            valor=20,
            metodo="pix",
            status="aprovado",
            criado_em=datetime.datetime(2026, 8, 16, 23, 0),
            idempotency_key="product-stage3b-partial",
        )
        db.add(payment)
        db.flush()
        db.add(
            PagamentoAlocacao(
                restaurante_id=TENANT,
                pagamento_id=payment.id,
                comanda_id="cmd-product",
                atendimento_id="att-product",
                valor=20,
                criado_em=payment.criado_em,
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
        json={"username": "product-stage3b", "password": "123"},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_partial_payment_keeps_product_consumption_separate_from_revenue():
    client = TestClient(app)
    auth = headers(client)
    query = "?data_inicio=2026-08-16&data_fim=2026-08-16"

    finance = client.get(f"/relatorios/visao-geral{query}", headers=auth)
    products = client.get(f"/relatorios/produtos{query}", headers=auth)

    assert finance.status_code == 200, finance.text
    assert products.status_code == 200, products.text
    finance_data = finance.json()
    product_rows = products.json()

    assert finance_data["vendas_brutas"] == 20.0
    assert finance_data["vendas_liquidas"] == 20.0

    product = next(row for row in product_rows if row["produto_id"] == "prod-100")
    assert product["quantidade_consumida"] == 1
    assert product["valor_consumido"] == 100.0
    assert product["natureza_valor"] == "consumo_operacional_nao_receita"
    assert product["faturamento_total"] is None

    # A prova principal: R$ 100 consumidos não podem virar R$ 100 de receita
    # só porque houve um pagamento parcial de R$ 20.
    assert product["valor_consumido"] != finance_data["vendas_liquidas"]

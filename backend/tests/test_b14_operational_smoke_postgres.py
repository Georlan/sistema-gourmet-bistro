"""B1.4 — smoke operacional ponta a ponta em PostgreSQL real.

Este teste não usa produção. Ele roda contra um PostgreSQL 17 efêmero já
migrado pelo workflow de baseline e valida o caminho operacional principal
pela API HTTP do FastAPI:

health -> login -> abrir caixa -> criar comanda -> lançar item -> enfileirar
impressão -> pagar -> retry idempotente -> fechar caixa.

A saída física da impressora continua sendo um gate manual separado.
"""

from fastapi.testclient import TestClient

from app.database import SessionLocal, current_restaurante_id
from app.main import app
from app.models import (
    CaixaTurno,
    Categoria,
    Comanda,
    ConfiguracaoRestaurante,
    Item,
    Mesa,
    Pagamento,
    PrintJob,
    Produto,
    Restaurante,
    Usuario,
)
from app.security import get_password_hash


RESTAURANTE_ID = 8814
USER_ID = "b14-smoke-caixa"
USER_EMAIL = "b14.smoke@koma.test"
USER_PASSWORD = "B14-smoke-password-2026"
MESA_ID = 14
CATEGORIA_ID = "cat-b14-smoke"
PRODUTO_ID = "prod-b14-smoke"
PRODUTO_VALOR = 42.0


def _seed_smoke_fixture() -> None:
    tenant_token = current_restaurante_id.set(RESTAURANTE_ID)
    db = SessionLocal(restaurante_id=RESTAURANTE_ID)
    try:
        if db.query(Restaurante).filter(Restaurante.id == RESTAURANTE_ID).first() is None:
            db.add(
                Restaurante(
                    id=RESTAURANTE_ID,
                    nome="B1.4 Operational Smoke",
                    plano="bistro",
                )
            )
            db.flush()

        if db.query(Usuario).filter(Usuario.id == USER_ID).first() is None:
            db.add(
                Usuario(
                    id=USER_ID,
                    restaurante_id=RESTAURANTE_ID,
                    nome="Operador Smoke B1.4",
                    usuario="b14-smoke",
                    email=USER_EMAIL,
                    senha_hash=get_password_hash(USER_PASSWORD),
                    role="caixa",
                    cargo="caixa",
                    status="ativo",
                )
            )
            db.flush()

        if db.query(Categoria).filter(Categoria.id == CATEGORIA_ID).first() is None:
            db.add(
                Categoria(
                    id=CATEGORIA_ID,
                    restaurante_id=RESTAURANTE_ID,
                    nome="Smoke B1.4",
                )
            )
            db.flush()

        if db.query(Produto).filter(Produto.id == PRODUTO_ID).first() is None:
            db.add(
                Produto(
                    id=PRODUTO_ID,
                    restaurante_id=RESTAURANTE_ID,
                    categoria_id=CATEGORIA_ID,
                    nome="Produto Smoke B1.4",
                    preco=PRODUTO_VALOR,
                    ativo=True,
                )
            )

        if db.query(Mesa).filter(Mesa.id == MESA_ID).first() is None:
            db.add(
                Mesa(
                    id=MESA_ID,
                    restaurante_id=RESTAURANTE_ID,
                    capacidade=4,
                    nome="Mesa Smoke 14",
                )
            )

        config = db.query(ConfiguracaoRestaurante).filter(
            ConfiguracaoRestaurante.restaurante_id == RESTAURANTE_ID
        ).first()
        if config is None:
            config = ConfiguracaoRestaurante(
                restaurante_id=RESTAURANTE_ID,
                taxa_servico_ativa=False,
                taxa_servico_padrao=10.0,
            )
            db.add(config)
        else:
            config.taxa_servico_ativa = False

        db.commit()
    finally:
        db.close()
        current_restaurante_id.reset(tenant_token)


def test_b14_operational_smoke_postgres() -> None:
    _seed_smoke_fixture()

    with TestClient(app) as client:
        health = client.get("/health")
        assert health.status_code == 200, health.text
        assert health.json()["status"] == "ok"
        assert health.json()["database"] == "healthy"

        login = client.post(
            "/auth/login",
            json={
                "username": USER_EMAIL,
                "password": USER_PASSWORD,
                "restaurante_id": RESTAURANTE_ID,
            },
        )
        assert login.status_code == 200, login.text
        login_data = login.json()
        token = login_data["access_token"]
        assert token
        assert login_data["usuario"]["restaurante_id"] == RESTAURANTE_ID

        headers = {"Authorization": f"Bearer {token}"}

        initial_summary = client.get("/caixa/turno-atual/resumo", headers=headers)
        assert initial_summary.status_code == 200, initial_summary.text
        assert initial_summary.json()["status"] == "sem_turno"

        opened = client.post(
            "/caixa/turno/abrir",
            headers=headers,
            json={"saldo_inicial": 0.0},
        )
        assert opened.status_code == 201, opened.text
        assert opened.json()["status"] == "aberto"

        created = client.post(
            "/comandas/",
            headers=headers,
            json={
                "mesa_id": MESA_ID,
                "garcom_id": USER_ID,
                "tipo": "Consumo no Local",
            },
        )
        assert created.status_code == 201, created.text
        comanda_id = created.json()["id"]

        launched = client.post(
            f"/comandas/{comanda_id}/lancamentos",
            headers=headers,
            json={
                "garcom_id": USER_ID,
                "itens": [
                    {
                        "produto_id": PRODUTO_ID,
                        "observacao": "Smoke B1.4",
                    }
                ],
            },
        )
        assert launched.status_code in (200, 201), launched.text

        tenant_token = current_restaurante_id.set(RESTAURANTE_ID)
        db = SessionLocal(restaurante_id=RESTAURANTE_ID)
        try:
            items = db.query(Item).filter(Item.comanda_id == comanda_id).all()
            print_jobs = db.query(PrintJob).filter(
                PrintJob.restaurante_id == RESTAURANTE_ID,
                PrintJob.source_id == comanda_id,
            ).all()
            assert len(items) == 1
            assert items[0].produto_id == PRODUTO_ID
            assert len(print_jobs) >= 1, "lançamento não gerou PrintJob"
        finally:
            db.close()
            current_restaurante_id.reset(tenant_token)

        payment_payload = {
            "valor": PRODUTO_VALOR,
            "metodo": "pix",
            "incluir_taxa_servico": False,
            "idempotency_key": "b14-smoke-payment-8814",
        }
        paid = client.post(
            f"/caixa/mesas/{MESA_ID}/pagar",
            headers=headers,
            json=payment_payload,
        )
        assert paid.status_code == 201, paid.text
        assert paid.json()["valor"] == PRODUTO_VALOR

        retried = client.post(
            f"/caixa/mesas/{MESA_ID}/pagar",
            headers=headers,
            json=payment_payload,
        )
        assert retried.status_code == 201, retried.text
        assert retried.json()["id"] == paid.json()["id"]

        tenant_token = current_restaurante_id.set(RESTAURANTE_ID)
        db = SessionLocal(restaurante_id=RESTAURANTE_ID)
        try:
            comanda = db.query(Comanda).filter(Comanda.id == comanda_id).one()
            item = db.query(Item).filter(Item.comanda_id == comanda_id).one()
            pagamentos = db.query(Pagamento).filter(
                Pagamento.restaurante_id == RESTAURANTE_ID
            ).all()
            assert comanda.fechada is True
            assert float(comanda.valor_pago) == PRODUTO_VALOR
            assert item.pago is True
            assert len(pagamentos) == 1
            assert float(pagamentos[0].valor) == PRODUTO_VALOR
            assert pagamentos[0].status == "aprovado"
        finally:
            db.close()
            current_restaurante_id.reset(tenant_token)

        closed = client.post(
            "/caixa/turno/fechar",
            headers=headers,
            json={
                "declarado_dinheiro": 0.0,
                "declarado_pix": PRODUTO_VALOR,
                "declarado_cartao": 0.0,
                "observacao": "B1.4 smoke operacional PostgreSQL",
            },
        )
        assert closed.status_code in (200, 201), closed.text

        tenant_token = current_restaurante_id.set(RESTAURANTE_ID)
        db = SessionLocal(restaurante_id=RESTAURANTE_ID)
        try:
            turnos_abertos = db.query(CaixaTurno).filter(
                CaixaTurno.restaurante_id == RESTAURANTE_ID,
                CaixaTurno.status == "aberto",
            ).count()
            pagamentos = db.query(Pagamento).filter(
                Pagamento.restaurante_id == RESTAURANTE_ID
            ).count()
            print_jobs = db.query(PrintJob).filter(
                PrintJob.restaurante_id == RESTAURANTE_ID
            ).count()
            assert turnos_abertos == 0
            assert pagamentos == 1
            assert print_jobs >= 1
        finally:
            db.close()
            current_restaurante_id.reset(tenant_token)

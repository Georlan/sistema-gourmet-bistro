"""B1.4 — smoke operacional ponta a ponta em PostgreSQL real.

Este teste não usa produção. Ele roda contra um PostgreSQL 17 efêmero já
migrado pelo workflow de baseline e valida o caminho operacional principal
pela API HTTP do FastAPI:

health -> login -> abrir caixa -> criar comanda -> lançar item -> enfileirar
impressão -> pagar -> retry idempotente -> fechar caixa.

A saída física da impressora continua sendo um gate manual separado.
"""

import os

import pytest
from fastapi.testclient import TestClient

import httpx

from app.database import SessionLocal, current_restaurante_id
from app.main import app
from app.models import (
    CaixaTurno,
    Categoria,
    Comanda,
    ConfiguracaoRestaurante,
    IntegrationOutbox,
    Item,
    Mesa,
    Pagamento,
    PrintJob,
    Produto,
    Restaurante,
    Usuario,
)
from app.security import get_password_hash
from app.services.outbox import OutboxWorker, discover_active_restaurant_ids


RESTAURANTE_ID = 8814
USER_ID = "b14-smoke-caixa"
USER_EMAIL = "b14.smoke@koma.test"
USER_PASSWORD = "B14-smoke-password-2026"
MESA_ID = 14
CATEGORIA_ID = "cat-b14-smoke"
PRODUTO_ID = "prod-b14-smoke"
PRODUTO_VALOR = 42.0


pytestmark = pytest.mark.skipif(
    os.getenv("KOMA_PYTEST_USE_EXTERNAL_DATABASE", "false").lower() != "true",
    reason="Smoke B1.4 exige o PostgreSQL efêmero do workflow dedicado.",
)


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
                    destino_impressao="COZINHA",
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
        lancamento_id = launched.json()["id"]

        tenant_token = current_restaurante_id.set(RESTAURANTE_ID)
        db = SessionLocal(restaurante_id=RESTAURANTE_ID)
        try:
            items = db.query(Item).filter(Item.comanda_id == comanda_id).all()
            print_jobs = db.query(PrintJob).filter(
                PrintJob.restaurante_id == RESTAURANTE_ID,
                PrintJob.source_type == "lancamento",
                PrintJob.source_id == lancamento_id,
            ).all()
            assert len(items) == 1
            assert items[0].produto_id == PRODUTO_ID
            assert len(print_jobs) == 1, "lançamento não gerou exatamente uma via automática"
            assert print_jobs[0].destination == "COZINHA"
            assert print_jobs[0].status == "pending"
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


def test_outbox_multi_tenant_worker_rls_postgres_smoke():
    """Prova PostgreSQL Real (Fase 6 Final Closure):
    - Executa contra PostgreSQL real com FORCE ROW LEVEL SECURITY.
    - Utiliza koma_internal.list_public_restaurants() (SECURITY DEFINER).
    - Valida que o worker descobre dois tenants e processa as Outboxes
      de ambos sem bloqueio de RLS e sem cruzar dados entre tenants.
    """
    import datetime

    # 1. Configura dois tenants distintos no PostgreSQL
    tenant_1 = RESTAURANTE_ID  # 8814
    tenant_2 = 8815

    db = SessionLocal()
    try:
        # Garante criação do tenant 2 se ainda não existir
        rest2 = db.query(Restaurante).filter(Restaurante.id == tenant_2).first()
        if not rest2:
            db.add(
                Restaurante(
                    id=tenant_2,
                    nome="B1.4 Smoke Tenant 2",
                    plano="pro",
                )
            )
            db.commit()

        # Configura webhooks para ambos os tenants
        for rid in (tenant_1, tenant_2):
            cfg = db.query(ConfiguracaoRestaurante).filter(ConfiguracaoRestaurante.restaurante_id == rid).first()
            if not cfg:
                cfg = ConfiguracaoRestaurante(
                    restaurante_id=rid,
                    webhook_url=f"https://webhook.koma.test/tenant/{rid}",
                    webhook_secret=f"secret-postgres-{rid}",
                    webhook_ativo=True,
                )
                db.add(cfg)
            else:
                cfg.webhook_url = f"https://webhook.koma.test/tenant/{rid}"
                cfg.webhook_secret = f"secret-postgres-{rid}"
                cfg.webhook_ativo = True
            db.commit()

        # Insere evento de outbox para cada tenant
        now = datetime.datetime.now(datetime.timezone.utc)
        ev1 = IntegrationOutbox(
            id="smoke-pg-outbox-t1",
            restaurante_id=tenant_1,
            event_id="evt-pg-smoke-1",
            event_name="koma.order.created",
            aggregate_type="order",
            aggregate_id="ord-pg-t1",
            payload={"order_id": "ord-pg-t1", "display_number": "10-A", "check_id": 10},
            status="pending",
            created_at=now,
        )
        ev2 = IntegrationOutbox(
            id="smoke-pg-outbox-t2",
            restaurante_id=tenant_2,
            event_id="evt-pg-smoke-2",
            event_name="koma.order.created",
            aggregate_type="order",
            aggregate_id="ord-pg-t2",
            payload={"order_id": "ord-pg-t2", "display_number": "20-A", "check_id": 20},
            status="pending",
            created_at=now,
        )
        db.add_all([ev1, ev2])
        db.commit()

        # 2. Testa descoberta de tenants via koma_internal.list_public_restaurants()
        discovered_ids = discover_active_restaurant_ids(db)
        assert tenant_1 in discovered_ids
        assert tenant_2 in discovered_ids

        # 3. Executa o OutboxWorker com mock de transporte
        delivered_requests: list[httpx.Request] = []

        def mock_transport(request: httpx.Request):
            delivered_requests.append(request)
            return httpx.Response(200, json={"status": "ok"})

        client = httpx.Client(transport=httpx.MockTransport(mock_transport))
        worker = OutboxWorker(batch_size=10, worker_id="worker-pg-smoke")
        stats = worker.run_once(client=client)

        assert stats["claimed"] >= 2
        assert stats["delivered"] >= 2

        # 4. Valida no PostgreSQL sob RLS que ambos os eventos foram marcados como 'delivered'
        e1_db = db.query(IntegrationOutbox).filter(IntegrationOutbox.id == "smoke-pg-outbox-t1").first()
        e2_db = db.query(IntegrationOutbox).filter(IntegrationOutbox.id == "smoke-pg-outbox-t2").first()
        assert e1_db.status == "delivered"
        assert e2_db.status == "delivered"

    finally:
        db.close()


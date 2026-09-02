import pytest
from fastapi.testclient import TestClient

from app.application.printing import (
    PrintAction,
    PrintIntent,
    PrintSourceType,
    PrintingApplicationService,
)
from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.main import app
from app.models import Categoria, Comanda, Item, Lancamento, PrintJob, Produto, Restaurante, Usuario
from app.security import create_access_token


TENANT_ID = 2891
USER_ID = "usr-item-change-2891"
CATEGORY_BAR_ID = "cat-item-change-bar"
CATEGORY_SILENT_ID = "cat-item-change-silent"
PRODUCT_BAR_ID = "prod-item-change-suco"
PRODUCT_SILENT_ID = "prod-item-change-agua"
COMMAND_ID = "c-item-change"
LAUNCH_ID = "l-item-change"
ITEM_BAR_ID = "i-item-change-bar"
ITEM_SILENT_ID = "i-item-change-silent"

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_item_change_printing():
    Base.metadata.create_all(bind=engine)
    tenant_token = current_restaurante_id.set(None)
    db = SessionLocal(restaurante_id=None)
    try:
        db.query(PrintJob).filter(PrintJob.restaurante_id == TENANT_ID).delete(synchronize_session=False)
        db.query(Item).filter(Item.restaurante_id == TENANT_ID).delete(synchronize_session=False)
        db.query(Lancamento).filter(Lancamento.restaurante_id == TENANT_ID).delete(synchronize_session=False)
        db.query(Comanda).filter(Comanda.restaurante_id == TENANT_ID).delete(synchronize_session=False)
        db.query(Produto).filter(Produto.restaurante_id == TENANT_ID).delete(synchronize_session=False)
        db.query(Categoria).filter(Categoria.restaurante_id == TENANT_ID).delete(synchronize_session=False)
        db.query(Usuario).filter(Usuario.restaurante_id == TENANT_ID).delete(synchronize_session=False)
        db.query(Restaurante).filter(Restaurante.id == TENANT_ID).delete(synchronize_session=False)
        db.commit()

        db.add(Restaurante(id=TENANT_ID, nome="Bar Universal", plano="bistro"))
        db.flush()
        db.add(
            Usuario(
                id=USER_ID,
                restaurante_id=TENANT_ID,
                nome="Operador Delta",
                email="item-change@teste.local",
                role="admin",
                status="ativo",
            )
        )
        db.add_all(
            [
                Categoria(
                    id=CATEGORY_BAR_ID,
                    restaurante_id=TENANT_ID,
                    nome="Bebidas do bar",
                    destino_impressao="BAR",
                ),
                Categoria(
                    id=CATEGORY_SILENT_ID,
                    restaurante_id=TENANT_ID,
                    nome="Sem produção",
                    destino_impressao="NENHUM",
                ),
            ]
        )
        db.flush()
        db.add_all(
            [
                Produto(
                    id=PRODUCT_BAR_ID,
                    restaurante_id=TENANT_ID,
                    categoria_id=CATEGORY_BAR_ID,
                    nome="Suco Verde",
                    preco=12.0,
                    ativo=True,
                ),
                Produto(
                    id=PRODUCT_SILENT_ID,
                    restaurante_id=TENANT_ID,
                    categoria_id=CATEGORY_SILENT_ID,
                    nome="Água",
                    preco=5.0,
                    ativo=True,
                ),
            ]
        )
        db.add(
            Comanda(
                id=COMMAND_ID,
                restaurante_id=TENANT_ID,
                garcom_id=USER_ID,
                mesa_id=12,
                tipo="Consumo no Local",
                identificador="Mesa Delta",
                numero_pedido=912,
                fechada=False,
            )
        )
        db.flush()
        db.add(
            Lancamento(
                id=LAUNCH_ID,
                restaurante_id=TENANT_ID,
                comanda_id=COMMAND_ID,
                garcom_id=USER_ID,
                origem="garcom",
                status="producao",
            )
        )
        db.flush()
        db.add_all(
            [
                Item(
                    id=ITEM_BAR_ID,
                    restaurante_id=TENANT_ID,
                    comanda_id=COMMAND_ID,
                    lancamento_id=LAUNCH_ID,
                    produto_id=PRODUCT_BAR_ID,
                    preco_unit=12.0,
                    observacao="Sem açúcar",
                    cliente_nome="Ana",
                    status="preparando",
                    pago=False,
                ),
                Item(
                    id=ITEM_SILENT_ID,
                    restaurante_id=TENANT_ID,
                    comanda_id=COMMAND_ID,
                    lancamento_id=LAUNCH_ID,
                    produto_id=PRODUCT_SILENT_ID,
                    preco_unit=5.0,
                    observacao="",
                    cliente_nome="Ana",
                    status="preparando",
                    pago=False,
                ),
            ]
        )
        db.commit()

        current_restaurante_id.reset(tenant_token)
        tenant_token = current_restaurante_id.set(TENANT_ID)
        yield
    finally:
        db.close()
        current_restaurante_id.reset(tenant_token)


def _headers():
    token = create_access_token(
        subject=USER_ID,
        restaurante_id=TENANT_ID,
        role="admin",
    )
    return {"Authorization": f"Bearer {token}"}


def _jobs():
    db = SessionLocal(restaurante_id=TENANT_ID)
    try:
        return list(
            db.query(PrintJob)
            .filter(PrintJob.restaurante_id == TENANT_ID)
            .order_by(PrintJob.id.asc())
            .all()
        )
    finally:
        db.close()


def test_update_item_uses_universal_delta_and_routes_to_category_destination():
    response = client.put(
        f"/comandas/itens/{ITEM_BAR_ID}",
        headers=_headers(),
        json={"observacao": "Sem gelo"},
    )

    assert response.status_code == 200, response.text
    jobs = _jobs()
    assert len(jobs) == 1
    job = jobs[0]
    assert job.destination == "BAR"
    assert job.document_type == "producao"
    assert job.source_type == "item"
    assert job.source_id == ITEM_BAR_ID
    assert "ITEM ALTERADO/ADICIONADO" in job.payload_text
    assert "MESA: 12" in job.payload_text
    assert "PRODUTO: Suco Verde" in job.payload_text
    assert "OBS (EDITADO): Sem gelo" in job.payload_text
    assert "CLIENTE: Ana" in job.payload_text
    assert "Água" not in job.payload_text


def test_universal_item_intent_preserves_quantity_delta_without_full_order_snapshot():
    response = client.post(
        "/impressao",
        headers=_headers(),
        json={
            "source_type": "item",
            "source_id": ITEM_BAR_ID,
            "action": "alteracao_item",
            "quantity_added": 2,
            "idempotency_key": "item-change-http-912",
        },
    )

    assert response.status_code == 200, response.text
    jobs = _jobs()
    assert len(jobs) == 1
    assert jobs[0].destination == "BAR"
    assert "QTD ADICIONADA: +2" in jobs[0].payload_text
    assert "TOTAL" not in jobs[0].payload_text


def test_item_without_production_destination_stays_silent():
    db = SessionLocal(restaurante_id=TENANT_ID)
    try:
        jobs = PrintingApplicationService.request_print(
            db,
            PrintIntent(
                restaurant_id=TENANT_ID,
                source_type=PrintSourceType.ITEM,
                source_id=ITEM_SILENT_ID,
                action=PrintAction.ITEM_CHANGE,
            ),
        )
        db.commit()
        assert jobs == []
        assert db.query(PrintJob).filter(PrintJob.restaurante_id == TENANT_ID).count() == 0
    finally:
        db.close()


def test_http_item_without_destination_is_successful_noop_not_plan_error():
    response = client.post(
        "/impressao",
        headers=_headers(),
        json={
            "source_type": "item",
            "source_id": ITEM_SILENT_ID,
            "action": "alteracao_item",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["job_ids"] == []
    assert payload["jobs"] == []
    assert "Nenhuma via necessária" in payload["detail"]


def test_item_with_destination_and_plan_without_printing_returns_403():
    db = SessionLocal(restaurante_id=TENANT_ID)
    try:
        restaurante = db.query(Restaurante).filter(Restaurante.id == TENANT_ID).one()
        restaurante.plano = "pocket"
        db.commit()
    finally:
        db.close()

    response = client.post(
        "/impressao",
        headers=_headers(),
        json={
            "source_type": "item",
            "source_id": ITEM_BAR_ID,
            "action": "alteracao_item",
        },
    )

    assert response.status_code == 403, response.text
    assert "plano atual" in response.json()["detail"]
    assert _jobs() == []

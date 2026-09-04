import pytest
from fastapi.testclient import TestClient

from app.application.printing import (
    PrintAction,
    PrintIntent,
    PrintSourceType,
    PrintingApplicationService,
    UniversalPrintingError,
)
from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.main import app
from app.models import (
    Categoria,
    Comanda,
    Item,
    Lancamento,
    Mesa,
    PrintJob,
    Produto,
    Restaurante,
    Usuario,
)
from app.security import create_access_token


TENANT_ID = 2891
USER_ID = "usr-item-change-2891"
COMMAND_ID = "c-item-change"
LAUNCH_ID = "l-item-change"
TABLE_ID = 12

DESTINATIONS = {
    "bar": ("cat-item-change-bar", "prod-item-change-suco", "i-item-change-bar", "BAR"),
    "kitchen": (
        "cat-item-change-kitchen",
        "prod-item-change-lanche",
        "i-item-change-kitchen",
        "COZINHA",
    ),
    "silent": (
        "cat-item-change-silent",
        "prod-item-change-agua",
        "i-item-change-silent",
        "NENHUM",
    ),
}

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_item_change_printing():
    Base.metadata.create_all(bind=engine)
    tenant_token = current_restaurante_id.set(None)
    db = SessionLocal(restaurante_id=None)
    try:
        db.query(PrintJob).filter(PrintJob.restaurante_id == TENANT_ID).delete(
            synchronize_session=False
        )
        db.query(Item).filter(Item.restaurante_id == TENANT_ID).delete(
            synchronize_session=False
        )
        db.query(Lancamento).filter(Lancamento.restaurante_id == TENANT_ID).delete(
            synchronize_session=False
        )
        db.query(Comanda).filter(Comanda.restaurante_id == TENANT_ID).delete(
            synchronize_session=False
        )
        db.query(Mesa).filter(Mesa.restaurante_id == TENANT_ID).delete(
            synchronize_session=False
        )
        db.query(Produto).filter(Produto.restaurante_id == TENANT_ID).delete(
            synchronize_session=False
        )
        db.query(Categoria).filter(Categoria.restaurante_id == TENANT_ID).delete(
            synchronize_session=False
        )
        db.query(Usuario).filter(Usuario.restaurante_id == TENANT_ID).delete(
            synchronize_session=False
        )
        db.query(Restaurante).filter(Restaurante.id == TENANT_ID).delete(
            synchronize_session=False
        )
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
        db.add(
            Mesa(
                id=TABLE_ID,
                restaurante_id=TENANT_ID,
                capacidade=4,
                nome="Mesa Delta",
            )
        )
        for category_id, _product_id, _item_id, destination in DESTINATIONS.values():
            db.add(
                Categoria(
                    id=category_id,
                    restaurante_id=TENANT_ID,
                    nome=f"Categoria {destination}",
                    destino_impressao=destination,
                )
            )
        db.flush()

        product_names = {
            "bar": "Suco Verde",
            "kitchen": "Sanduíche",
            "silent": "Água",
        }
        prices = {"bar": 12.0, "kitchen": 18.0, "silent": 5.0}
        for key, (category_id, product_id, _item_id, _destination) in DESTINATIONS.items():
            db.add(
                Produto(
                    id=product_id,
                    restaurante_id=TENANT_ID,
                    categoria_id=category_id,
                    nome=product_names[key],
                    preco=prices[key],
                    ativo=True,
                )
            )
        db.add(
            Comanda(
                id=COMMAND_ID,
                restaurante_id=TENANT_ID,
                garcom_id=USER_ID,
                mesa_id=TABLE_ID,
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
        for key, (_category_id, product_id, item_id, _destination) in DESTINATIONS.items():
            db.add(
                Item(
                    id=item_id,
                    restaurante_id=TENANT_ID,
                    comanda_id=COMMAND_ID,
                    lancamento_id=LAUNCH_ID,
                    produto_id=product_id,
                    preco_unit=prices[key],
                    observacao="Sem açúcar" if key == "bar" else "",
                    cliente_nome="Ana",
                    status="preparando",
                    pago=False,
                )
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
            .order_by(PrintJob.created_at.asc())
            .all()
        )
    finally:
        db.close()


@pytest.mark.parametrize(
    ("item_key", "expected_destination"),
    [("bar", "BAR"), ("kitchen", "COZINHA")],
)
def test_update_item_routes_delta_to_category_destination(
    item_key,
    expected_destination,
):
    item_id = DESTINATIONS[item_key][2]
    response = client.put(
        f"/comandas/itens/{item_id}",
        headers=_headers(),
        json={"observacao": "Sem gelo"},
    )

    assert response.status_code == 200, response.text
    jobs = _jobs()
    assert len(jobs) == 1
    assert jobs[0].destination == expected_destination
    assert jobs[0].document_type == "producao"
    assert jobs[0].source_type == "item"
    assert jobs[0].source_id == item_id
    assert "ITEM ALTERADO/ADICIONADO" in jobs[0].payload_text
    assert f"MESA: {TABLE_ID}" in jobs[0].payload_text
    assert "OBS (EDITADO): Sem gelo" in jobs[0].payload_text


def test_added_item_copies_keep_tenant_and_print_only_the_delta():
    item_id = DESTINATIONS["bar"][2]
    response = client.put(
        f"/comandas/itens/{item_id}",
        headers=_headers(),
        json={"quantidade_adicional": 3},
    )

    assert response.status_code == 200, response.text
    db = SessionLocal(restaurante_id=TENANT_ID)
    try:
        matching_items = db.query(Item).filter(
            Item.comanda_id == COMMAND_ID,
            Item.produto_id == DESTINATIONS["bar"][1],
        ).all()
        assert len(matching_items) == 3
        assert {copy.restaurante_id for copy in matching_items} == {TENANT_ID}
    finally:
        db.close()

    jobs = _jobs()
    assert len(jobs) == 1
    assert jobs[0].destination == "BAR"
    assert "QTD ADICIONADA: +2" in jobs[0].payload_text
    assert "TOTAL" not in jobs[0].payload_text


def test_item_without_production_destination_is_a_successful_noop():
    response = client.post(
        "/impressao",
        headers=_headers(),
        json={
            "source_type": "item",
            "source_id": DESTINATIONS["silent"][2],
            "action": "alteracao_item",
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["job_ids"] == []
    assert "Nenhuma via necessária" in response.json()["detail"]
    assert _jobs() == []


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
            "source_id": DESTINATIONS["bar"][2],
            "action": "alteracao_item",
        },
    )

    assert response.status_code == 403, response.text
    assert "plano atual" in response.json()["detail"]
    assert _jobs() == []


def test_item_intent_rejects_invalid_quantity_delta():
    db = SessionLocal(restaurante_id=TENANT_ID)
    try:
        with pytest.raises(UniversalPrintingError, match="Quantidade adicionada inválida"):
            PrintingApplicationService.request_print(
                db,
                PrintIntent(
                    restaurant_id=TENANT_ID,
                    source_type=PrintSourceType.ITEM,
                    source_id=DESTINATIONS["bar"][2],
                    action=PrintAction.ITEM_CHANGE,
                    quantity_added=-1,
                ),
            )
    finally:
        db.close()


@pytest.mark.parametrize(
    "source_type",
    [PrintSourceType.ORDER, PrintSourceType.TABLE, PrintSourceType.CASH_SHIFT],
)
def test_item_change_action_rejects_every_non_item_source(source_type):
    db = SessionLocal(restaurante_id=TENANT_ID)
    try:
        with pytest.raises(
            UniversalPrintingError,
            match="Alteração de item exige origem de impressão item",
        ) as exc_info:
            PrintingApplicationService.request_print(
                db,
                PrintIntent(
                    restaurant_id=TENANT_ID,
                    source_type=source_type,
                    source_id="invalid-item-change-source",
                    action=PrintAction.ITEM_CHANGE,
                ),
            )
        assert exc_info.value.status_code == 422
        assert _jobs() == []
    finally:
        db.close()

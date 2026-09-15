import uuid

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import Comanda, Motoboy, Restaurante, Usuario
from app.security import create_access_token


def _ensure_restaurant(db, restaurant_id: int, slug: str) -> None:
    if db.query(Restaurante).filter(Restaurante.id == restaurant_id).first() is None:
        db.add(Restaurante(id=restaurant_id, nome=f"Restaurante {restaurant_id}", slug=slug))


def test_courier_preassignment_is_tenant_scoped_and_does_not_dispatch_order():
    client = TestClient(app)
    suffix = uuid.uuid4().hex[:8]
    user_id = f"u-courier-assign-{suffix}"
    order_id = f"cmd-courier-assign-{suffix}"
    courier_id = 810000 + int(uuid.uuid4().hex[:5], 16) % 80000
    foreign_courier_id = courier_id + 100000

    with SessionLocal() as db:
        _ensure_restaurant(db, 1, f"courier-assign-1-{suffix}")
        _ensure_restaurant(db, 2, f"courier-assign-2-{suffix}")
        # SQLite CI enforces the Motoboy -> Restaurante FK immediately. Flush
        # tenant fixtures first so the test validates assignment semantics, not
        # ORM insert ordering.
        db.flush()

        admin = Usuario(
            id=user_id,
            restaurante_id=1,
            nome="Admin Courier Assignment",
            cargo="admin",
            role="admin",
            status="ativo",
        )
        courier = Motoboy(
            id=courier_id,
            restaurante_id=1,
            nome="Entregador Local",
            telefone="81999990001",
            ativo=True,
        )
        foreign_courier = Motoboy(
            id=foreign_courier_id,
            restaurante_id=2,
            nome="Entregador Outro Tenant",
            telefone="81999990002",
            ativo=True,
        )
        order = Comanda(
            id=order_id,
            restaurante_id=1,
            garcom_id=user_id,
            numero_pedido=991101,
            identificador="Cliente Assignment",
            tipo="Entrega",
            delivery_status="pronto",
            delivery_endereco="Rua Teste, 20",
            motoboy_id=None,
            fechada=False,
        )
        db.add_all([admin, courier, foreign_courier, order])
        db.commit()

    token = create_access_token(subject=user_id, restaurante_id=1, role="admin")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.put(
        f"/comandas/{order_id}/delivery/entregador",
        headers=headers,
        json={"motoboy_id": courier_id},
    )
    assert response.status_code == 200, response.text
    assert response.json()["motoboy_id"] == courier_id
    assert response.json()["delivery_status"] == "pronto"

    with SessionLocal() as db:
        persisted = db.query(Comanda).filter(Comanda.id == order_id).one()
        assert persisted.motoboy_id == courier_id
        assert persisted.delivery_status == "pronto"

    foreign_response = client.put(
        f"/comandas/{order_id}/delivery/entregador",
        headers=headers,
        json={"motoboy_id": foreign_courier_id},
    )
    assert foreign_response.status_code == 404, foreign_response.text

    with SessionLocal() as db:
        persisted = db.query(Comanda).filter(Comanda.id == order_id).one()
        assert persisted.motoboy_id == courier_id
        assert persisted.delivery_status == "pronto"

    unassign_response = client.put(
        f"/comandas/{order_id}/delivery/entregador",
        headers=headers,
        json={"motoboy_id": None},
    )
    assert unassign_response.status_code == 200, unassign_response.text
    assert unassign_response.json()["motoboy_id"] is None
    assert unassign_response.json()["delivery_status"] == "pronto"

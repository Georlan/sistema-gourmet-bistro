import uuid

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import Comanda, Motoboy, Restaurante, Usuario
from app.security import create_access_token


def test_unassigned_delivery_cannot_be_claimed_by_any_courier_token():
    """Token de motoboy não é autorização para reivindicar entrega sem vínculo."""
    client = TestClient(app)
    user_id = f"u-security-courier-{uuid.uuid4().hex[:8]}"
    comanda_id = f"cmd-security-courier-{uuid.uuid4().hex[:8]}"
    motoboy_id = 910000 + int(uuid.uuid4().hex[:5], 16) % 80000

    with SessionLocal() as db:
        restaurante = db.query(Restaurante).filter(Restaurante.id == 1).first()
        if restaurante is None:
            restaurante = Restaurante(id=1, nome="Bistro Security", slug="bistro-security")
            db.add(restaurante)

        admin = Usuario(
            id=user_id,
            restaurante_id=1,
            nome="Admin Security",
            cargo="admin",
            role="admin",
            status="ativo",
        )
        motoboy = Motoboy(
            id=motoboy_id,
            restaurante_id=1,
            nome="Courier Security",
            telefone="81999990000",
            ativo=True,
        )
        comanda = Comanda(
            id=comanda_id,
            restaurante_id=1,
            garcom_id=user_id,
            numero_pedido=991001,
            identificador="Cliente Security",
            tipo="Entrega",
            delivery_status="transito",
            delivery_endereco="Rua Teste, 10",
            motoboy_id=None,
            fechada=False,
        )
        db.add_all([admin, motoboy, comanda])
        db.commit()

    admin_token = create_access_token(subject=user_id, restaurante_id=1, role="admin")
    link_response = client.post(
        f"/comandas/motoboys/{motoboy_id}/gerar-link",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert link_response.status_code == 200, link_response.text
    courier_token = link_response.json()["token"]

    response = client.post(
        f"/comandas/motoboys/pedidos/{comanda_id}/confirmar-entrega",
        headers={"X-Koma-Delivery-Token": courier_token},
    )

    assert response.status_code == 409, response.text
    assert response.json()["detail"] == "Este pedido não está atribuído a este motoboy."

    with SessionLocal() as db:
        persisted = db.query(Comanda).filter(Comanda.id == comanda_id).one()
        assert persisted.motoboy_id is None
        assert persisted.delivery_status == "transito"
        assert persisted.fechada is False

import uuid

from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.main import app
from app.models import (
    Categoria,
    ConfiguracaoRestaurante,
    Produto,
    Restaurante,
    Usuario,
)


client = TestClient(app)
RESTAURANTE_ID = 99118
USER_ID = "usr-delivery-disabled-diag"
PRODUCT_ID = "prod-delivery-disabled-diag"
CATEGORY_ID = "cat-delivery-disabled-diag"


def _seed_delivery_disabled_restaurant():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        restaurante = db.query(Restaurante).filter(Restaurante.id == RESTAURANTE_ID).first()
        if restaurante is None:
            restaurante = Restaurante(
                id=RESTAURANTE_ID,
                nome="Delivery Desligado Diagnostico",
                plano="pro",
                slug="delivery-desligado-diagnostico",
                status_override="Forçado Aberto",
            )
            db.add(restaurante)

        categoria = db.query(Categoria).filter(
            Categoria.restaurante_id == RESTAURANTE_ID,
            Categoria.id == CATEGORY_ID,
        ).first()
        if categoria is None:
            db.add(Categoria(
                id=CATEGORY_ID,
                restaurante_id=RESTAURANTE_ID,
                nome="Diagnostico",
                destino_impressao="COZINHA",
            ))

        produto = db.query(Produto).filter(
            Produto.restaurante_id == RESTAURANTE_ID,
            Produto.id == PRODUCT_ID,
        ).first()
        if produto is None:
            db.add(Produto(
                id=PRODUCT_ID,
                restaurante_id=RESTAURANTE_ID,
                categoria_id=CATEGORY_ID,
                nome="Produto Delivery Desligado",
                preco=20,
                ativo=True,
            ))

        usuario = db.query(Usuario).filter(
            Usuario.restaurante_id == RESTAURANTE_ID,
            Usuario.id == USER_ID,
        ).first()
        if usuario is None:
            db.add(Usuario(
                id=USER_ID,
                restaurante_id=RESTAURANTE_ID,
                nome="Operador Delivery Desligado",
                email="delivery-disabled-diag@koma.invalid",
                role="admin",
                cargo="admin",
                status="ativo",
            ))

        config = db.query(ConfiguracaoRestaurante).filter(
            ConfiguracaoRestaurante.restaurante_id == RESTAURANTE_ID,
        ).first()
        if config is None:
            config = ConfiguracaoRestaurante(restaurante_id=RESTAURANTE_ID)
            db.add(config)
        config.delivery_ativo = False
        db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()


def test_diag_public_menu_does_not_expose_delivery_enabled_flag():
    _seed_delivery_disabled_restaurant()

    response = client.get(
        f"/api/cardapio-digital/public?restaurante_id={RESTAURANTE_ID}",
    )

    assert response.status_code == 200, response.text
    restaurant = response.json()["restaurante"]
    assert "delivery_ativo" not in restaurant


def test_diag_public_delivery_order_is_accepted_even_when_delivery_is_disabled():
    _seed_delivery_disabled_restaurant()

    response = client.post(
        "/cardapio/pedidos",
        json={
            "restaurante_id": RESTAURANTE_ID,
            "itens": [{
                "produto_id": PRODUCT_ID,
                "quantidade": 1,
                "observacao": "delivery deveria estar desligado",
            }],
            "cliente_nome": "Cliente Delivery Desligado",
            "cliente_telefone": "85999991118",
            "endereco_entrega": "Rua Diagnostico, 118",
            "taxa_entrega": 7,
            "forma_pagamento": "na_entrega",
            "tipo_pedido": "delivery",
            "idempotency_key": f"diag-delivery-disabled-{uuid.uuid4().hex}",
        },
    )

    assert response.status_code == 201, response.text
    assert response.json()["total"] == 27.0

import concurrent.futures
import uuid

import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.main import app
from app.models import Categoria, Produto, Restaurante, Usuario


RESTAURANTE_ID = 99120
USER_ID = "usr-order-number-diag"
PRODUCT_ID = "prod-order-number-diag"
CATEGORY_ID = "cat-order-number-diag"


@pytest.fixture(scope="module", autouse=True)
def setup_order_number_data():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        if db.query(Restaurante).filter(Restaurante.id == RESTAURANTE_ID).first() is None:
            db.add(Restaurante(
                id=RESTAURANTE_ID,
                nome="Numeracao Concorrente Diagnostico",
                plano="pro",
                slug="numeracao-concorrente-diagnostico",
                status_override="Forçado Aberto",
            ))
        if db.query(Categoria).filter(
            Categoria.restaurante_id == RESTAURANTE_ID,
            Categoria.id == CATEGORY_ID,
        ).first() is None:
            db.add(Categoria(
                id=CATEGORY_ID,
                restaurante_id=RESTAURANTE_ID,
                nome="Diagnostico",
                destino_impressao="COZINHA",
            ))
        if db.query(Produto).filter(
            Produto.restaurante_id == RESTAURANTE_ID,
            Produto.id == PRODUCT_ID,
        ).first() is None:
            db.add(Produto(
                id=PRODUCT_ID,
                restaurante_id=RESTAURANTE_ID,
                categoria_id=CATEGORY_ID,
                nome="Produto Numeracao Diagnostico",
                preco=10,
                ativo=True,
            ))
        if db.query(Usuario).filter(
            Usuario.restaurante_id == RESTAURANTE_ID,
            Usuario.id == USER_ID,
        ).first() is None:
            db.add(Usuario(
                id=USER_ID,
                restaurante_id=RESTAURANTE_ID,
                nome="Operador Numeracao Diagnostico",
                email="order-number-diag@koma.invalid",
                role="admin",
                cargo="admin",
                status="ativo",
            ))
        db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()


def _submit(index: int):
    payload = {
        "restaurante_id": RESTAURANTE_ID,
        "itens": [{
            "produto_id": PRODUCT_ID,
            "quantidade": 1,
            "observacao": f"concorrente-{index}",
        }],
        "cliente_nome": f"Cliente Concorrente {index}",
        "cliente_telefone": f"8598{index:07d}",
        "endereco_entrega": "",
        "taxa_entrega": 0,
        "forma_pagamento": "na_entrega",
        "tipo_pedido": "retirada",
        "idempotency_key": f"diag-number-{index}-{uuid.uuid4().hex}",
    }
    with TestClient(app) as concurrent_client:
        response = concurrent_client.post("/cardapio/pedidos", json=payload)
        return response.status_code, response.json()


def test_distinct_concurrent_online_orders_keep_distinct_visible_order_numbers():
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(_submit, range(8)))

    assert all(status == 201 for status, _body in results), results
    ids = [body["comanda_id"] for _status, body in results]
    numbers = [body["numero_pedido"] for _status, body in results]

    assert len(set(ids)) == 8
    assert len(set(numbers)) == 8, numbers

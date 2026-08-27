from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.main import app
from app.models import (
    CaixaTurno,
    Categoria,
    Comanda,
    Insumo,
    MovimentacaoEstoque,
    Produto,
    ProdutoInsumo,
    Restaurante,
    Usuario,
)
from app.routes import orders as orders_routes
from app.security import create_access_token
from app.services.inventory import SALE_ORIGIN, SALE_REVERSAL_ORIGIN


client = TestClient(app)


def _seed_tenant(restaurante_id: int):
    Base.metadata.create_all(bind=engine)
    user_id = f"admin-accept-{restaurante_id}"
    category_id = f"cat-accept-{restaurante_id}"
    product_id = f"prod-accept-{restaurante_id}"
    insumo_id = f"ins-accept-{restaurante_id}"

    token = current_restaurante_id.set(restaurante_id)
    try:
        with SessionLocal() as db:
            db.add(
                Restaurante(
                    id=restaurante_id,
                    nome=f"Koma Aceite {restaurante_id}",
                    plano="premium",
                    slug=f"koma-aceite-{restaurante_id}",
                    status_override="Automático",
                )
            )
            db.commit()

            db.add(
                Usuario(
                    id=user_id,
                    restaurante_id=restaurante_id,
                    nome="Operador Aceite",
                    cargo="admin",
                    status="ativo",
                )
            )
            db.add(
                Categoria(
                    id=category_id,
                    restaurante_id=restaurante_id,
                    nome="Aceite",
                    destino_impressao="NENHUM",
                )
            )
            db.add(
                Insumo(
                    id=insumo_id,
                    restaurante_id=restaurante_id,
                    nome="Ingrediente do aceite",
                    estoque_atual=10.0,
                    estoque_minimo=1.0,
                    estoque_maximo=30.0,
                    unidade_medida="un",
                    preco_medio_custo=2.0,
                )
            )
            db.commit()

            db.add(
                Produto(
                    id=product_id,
                    restaurante_id=restaurante_id,
                    nome="Produto do aceite",
                    categoria_id=category_id,
                    preco=25.0,
                    ativo=True,
                )
            )
            db.commit()

            db.add(
                ProdutoInsumo(
                    restaurante_id=restaurante_id,
                    produto_id=product_id,
                    insumo_id=insumo_id,
                    quantidade=2.0,
                )
            )
            db.add(
                CaixaTurno(
                    restaurante_id=restaurante_id,
                    aberto_por_id=user_id,
                    saldo_inicial=0,
                    status="aberto",
                )
            )
            db.commit()
    finally:
        current_restaurante_id.reset(token)

    auth = create_access_token(
        subject=user_id,
        restaurante_id=restaurante_id,
        role="admin",
    )
    return {
        "user_id": user_id,
        "product_id": product_id,
        "insumo_id": insumo_id,
        "headers": {"Authorization": f"Bearer {auth}"},
    }


def _public_payload(restaurante_id: int, product_id: str, suffix: str):
    return {
        "restaurante_id": restaurante_id,
        "itens": [
            {
                "produto_id": product_id,
                "quantidade": 1,
                "observacao": "",
            }
        ],
        "cliente_nome": f"Cliente {suffix}",
        "cliente_telefone": f"8199{str(restaurante_id)[-4:]}{suffix[-2:].zfill(2)}",
        "endereco_entrega": "Rua do Aceite, 10",
        "taxa_entrega": 9999,
        "forma_pagamento": "na_entrega",
        "tipo_pedido": "delivery",
        "idempotency_key": f"aceite-{restaurante_id}-{suffix}-0001",
    }


def _stock_and_movements(restaurante_id: int, insumo_id: str):
    token = current_restaurante_id.set(restaurante_id)
    try:
        with SessionLocal() as db:
            stock = db.query(Insumo).filter(
                Insumo.restaurante_id == restaurante_id,
                Insumo.id == insumo_id,
            ).one().estoque_atual
            movements = db.query(MovimentacaoEstoque).filter(
                MovimentacaoEstoque.restaurante_id == restaurante_id,
                MovimentacaoEstoque.insumo_id == insumo_id,
            ).all()
            return float(stock), [(item.origem, item.referencia_id) for item in movements]
    finally:
        current_restaurante_id.reset(token)


def test_pendente_nao_baixa_e_primeiro_aceite_baixa_uma_unica_vez(monkeypatch):
    restaurante_id = 941101
    seeded = _seed_tenant(restaurante_id)
    monkeypatch.setattr(
        orders_routes,
        "_agendar_notificacao_whatsapp_status",
        lambda *args, **kwargs: None,
    )
    payload = _public_payload(restaurante_id, seeded["product_id"], "11")

    created = client.post(
        "/cardapio/pedidos",
        json=payload,
        headers={"X-Idempotency-Key": payload["idempotency_key"]},
    )
    assert created.status_code == 201, created.text
    assert created.json()["delivery_status"] == "pendente" if "delivery_status" in created.json() else True

    stock, movements = _stock_and_movements(restaurante_id, seeded["insumo_id"])
    assert stock == 10.0
    assert all(origin != SALE_ORIGIN for origin, _ in movements)

    comanda_id = created.json()["comanda_id"]
    accepted = client.put(
        f"/comandas/{comanda_id}/delivery/status?status_novo=producao",
        headers=seeded["headers"],
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["delivery_status"] == "producao"

    stock, movements = _stock_and_movements(restaurante_id, seeded["insumo_id"])
    assert stock == 8.0
    sale_movements = [item for item in movements if item[0] == SALE_ORIGIN]
    assert len(sale_movements) == 1

    repeated = client.put(
        f"/comandas/{comanda_id}/delivery/status?status_novo=producao",
        headers=seeded["headers"],
    )
    assert repeated.status_code == 200, repeated.text

    stock, movements = _stock_and_movements(restaurante_id, seeded["insumo_id"])
    assert stock == 8.0
    assert len([item for item in movements if item[0] == SALE_ORIGIN]) == 1


def test_recusa_pendente_nao_cria_estorno_de_estoque_inexistente(monkeypatch):
    restaurante_id = 941102
    seeded = _seed_tenant(restaurante_id)
    monkeypatch.setattr(
        orders_routes,
        "_agendar_notificacao_whatsapp_status",
        lambda *args, **kwargs: None,
    )
    payload = _public_payload(restaurante_id, seeded["product_id"], "12")

    created = client.post(
        "/cardapio/pedidos",
        json=payload,
        headers={"X-Idempotency-Key": payload["idempotency_key"]},
    )
    assert created.status_code == 201, created.text
    comanda_id = created.json()["comanda_id"]

    refused = client.put(
        f"/comandas/{comanda_id}/delivery/status?status_novo=recusado",
        headers=seeded["headers"],
    )
    assert refused.status_code == 200, refused.text
    assert refused.json()["delivery_status"] == "recusado"
    assert refused.json()["fechada"] is True

    stock, movements = _stock_and_movements(restaurante_id, seeded["insumo_id"])
    assert stock == 10.0
    assert all(origin not in {SALE_ORIGIN, SALE_REVERSAL_ORIGIN} for origin, _ in movements)


def test_salto_pendente_para_pronto_e_rejeitado_sem_baixa(monkeypatch):
    restaurante_id = 941103
    seeded = _seed_tenant(restaurante_id)
    monkeypatch.setattr(
        orders_routes,
        "_agendar_notificacao_whatsapp_status",
        lambda *args, **kwargs: None,
    )
    payload = _public_payload(restaurante_id, seeded["product_id"], "13")

    created = client.post(
        "/cardapio/pedidos",
        json=payload,
        headers={"X-Idempotency-Key": payload["idempotency_key"]},
    )
    assert created.status_code == 201, created.text

    invalid = client.put(
        f"/comandas/{created.json()['comanda_id']}/delivery/status?status_novo=pronto",
        headers=seeded["headers"],
    )
    assert invalid.status_code == 409
    assert "Transição de status inválida" in invalid.json()["detail"]

    stock, movements = _stock_and_movements(restaurante_id, seeded["insumo_id"])
    assert stock == 10.0
    assert all(origin != SALE_ORIGIN for origin, _ in movements)

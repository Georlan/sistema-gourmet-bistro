from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.main import app
from app.models import Categoria, Comanda, Produto, Restaurante, Usuario


RESTAURANTE_ID = 910100
PRODUTO_ID = "produto-online-robusto"
CATEGORIA_ID = "categoria-online-robusta"
USUARIO_ID = "usuario-online-robusto"

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_online_order_restaurant():
    """Semeia o tenant em commits ordenados para respeitar FKs da suíte SQLite."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        restaurante = db.query(Restaurante).filter(Restaurante.id == RESTAURANTE_ID).first()
        if restaurante is None:
            restaurante = Restaurante(
                id=RESTAURANTE_ID,
                nome="Koma Online Robustez",
                slug="koma-online-robustez",
                plano="premium",
                status_override="Automático",
            )
            db.add(restaurante)
        else:
            restaurante.status_override = "Automático"
        db.commit()

        categoria = db.query(Categoria).filter(
            Categoria.restaurante_id == RESTAURANTE_ID,
            Categoria.id == CATEGORIA_ID,
        ).first()
        if categoria is None:
            db.add(Categoria(
                id=CATEGORIA_ID,
                restaurante_id=RESTAURANTE_ID,
                nome="Robustez",
            ))
            db.commit()

        produto = db.query(Produto).filter(
            Produto.restaurante_id == RESTAURANTE_ID,
            Produto.id == PRODUTO_ID,
        ).first()
        if produto is None:
            db.add(Produto(
                id=PRODUTO_ID,
                restaurante_id=RESTAURANTE_ID,
                nome="Produto robusto",
                categoria_id=CATEGORIA_ID,
                preco=25.0,
                ativo=True,
            ))
        else:
            produto.ativo = True
            produto.preco = 25.0
        db.commit()

        usuario = db.query(Usuario).filter(
            Usuario.restaurante_id == RESTAURANTE_ID,
            Usuario.id == USUARIO_ID,
        ).first()
        if usuario is None:
            db.add(Usuario(
                id=USUARIO_ID,
                restaurante_id=RESTAURANTE_ID,
                nome="Operador Online",
                email="online-robustez@koma.test",
                cargo="admin",
                role="admin",
                status="ativo",
            ))
        else:
            usuario.role = "admin"
            usuario.cargo = "admin"
            usuario.status = "ativo"
        db.commit()
        yield
    finally:
        db.rollback()
        current_restaurante_id.reset(token)
        db.close()


def _payload(*, key: str = "pedido-online-robusto-0001", quantidade: int = 1):
    return {
        "restaurante_id": RESTAURANTE_ID,
        "itens": [{
            "produto_id": PRODUTO_ID,
            "quantidade": quantidade,
            "observacao": "Sem alterações",
        }],
        "cliente_nome": "Cliente Robustez",
        "cliente_telefone": "81999998888",
        "endereco_entrega": "Rua da Robustez, 100",
        "taxa_entrega": 5.0,
        "forma_pagamento": "na_entrega",
        "tipo_pedido": "delivery",
        "idempotency_key": key,
    }


def test_reenvio_com_mesma_chave_retorna_mesmo_pedido_e_total():
    payload = _payload()
    headers = {"X-Idempotency-Key": payload["idempotency_key"]}

    first = client.post("/cardapio/pedidos", json=payload, headers=headers)
    second = client.post("/cardapio/pedidos", json=payload, headers=headers)

    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert second.json()["comanda_id"] == first.json()["comanda_id"]
    assert second.json()["numero_pedido"] == first.json()["numero_pedido"]
    assert second.json()["total"] == 32.0
    assert second.json()["pagamento"]["cobranca_online"] is False

    db = SessionLocal()
    token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        assert db.query(Comanda).filter(
            Comanda.restaurante_id == RESTAURANTE_ID,
            Comanda.idempotency_key == payload["idempotency_key"],
        ).count() == 1
    finally:
        current_restaurante_id.reset(token)
        db.close()


def test_chave_do_header_e_body_nao_podem_divergir():
    response = client.post(
        "/cardapio/pedidos",
        json=_payload(key="pedido-body-0001"),
        headers={"X-Idempotency-Key": "pedido-header-0002"},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "A chave idempotente do pedido é inconsistente."


def test_pedido_publico_limita_quantidade_total_antes_de_gravar():
    response = client.post(
        "/cardapio/pedidos",
        json=_payload(key="pedido-grande-0001", quantidade=100),
        headers={"X-Idempotency-Key": "pedido-grande-0001"},
    )
    assert response.status_code == 201

    payload = _payload(key="pedido-grande-0002", quantidade=100)
    payload["itens"].append({
        "produto_id": PRODUTO_ID,
        "quantidade": 100,
        "observacao": "Segundo lote",
    })
    payload["itens"].append({
        "produto_id": PRODUTO_ID,
        "quantidade": 1,
        "observacao": "Excesso",
    })
    response = client.post(
        "/cardapio/pedidos",
        json=payload,
        headers={"X-Idempotency-Key": "pedido-grande-0002"},
    )

    assert response.status_code == 422
    assert "no máximo 200 unidades" in response.json()["detail"]


def test_restaurante_forcado_fechado_nao_recebe_novo_pedido():
    db = SessionLocal()
    token = current_restaurante_id.set(RESTAURANTE_ID)
    try:
        restaurante = db.query(Restaurante).filter(Restaurante.id == RESTAURANTE_ID).one()
        restaurante.status_override = "Forçado Fechado"
        db.commit()
    finally:
        current_restaurante_id.reset(token)
        db.close()

    response = client.post(
        "/cardapio/pedidos",
        json=_payload(key="pedido-fechado-0001"),
        headers={"X-Idempotency-Key": "pedido-fechado-0001"},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "O restaurante está fechado para novos pedidos online no momento."
    )


def test_checkout_persiste_tentativa_e_reutiliza_chave_apos_timeout():
    source = Path("src/cardapio/components/CardapioDigital.tsx").read_text(encoding="utf-8")

    assert "koma_pending_order_submission" in source
    assert "PENDING_ORDER_TTL_MS" in source
    assert "resolvePersistentIdempotencyKey" in source
    assert "AbortController" in source
    assert "X-Idempotency-Key" in source
    assert "reutiliza a mesma tentativa sem duplicar o pedido" in source


def test_configuracao_visual_usa_uploader_compacto():
    source = Path("src/components/CardapioAssetUploader.tsx").read_text(encoding="utf-8")

    assert "Marca exibida no topo do cardápio." in source
    assert "Capa horizontal exibida no cabeçalho." in source
    assert "h-20 w-24" in source
    assert "p-6 text-center" not in source

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.main import app
from app.models import (
    CaixaTurno,
    Categoria,
    Comanda,
    Item,
    Lancamento,
    Mesa,
    Pagamento,
    Produto,
    Restaurante,
    Usuario,
)
from app.security import create_access_token
from app.smartpos_models import RestauranteCapability, SmartPosPaymentIntent


client = TestClient(app)
RESTAURANTE_ID = 9404
USER_ID = "smartpos-intent-garcom"


@pytest.fixture(autouse=True)
def setup_smartpos_payment_intent():
    Base.metadata.create_all(bind=engine)
    token = current_restaurante_id.set(RESTAURANTE_ID)
    db = SessionLocal()
    try:
        db.query(SmartPosPaymentIntent).filter(
            SmartPosPaymentIntent.restaurante_id == RESTAURANTE_ID
        ).delete()
        db.query(Pagamento).filter(Pagamento.restaurante_id == RESTAURANTE_ID).delete()
        db.query(Item).filter(Item.restaurante_id == RESTAURANTE_ID).delete()
        db.query(Lancamento).filter(Lancamento.restaurante_id == RESTAURANTE_ID).delete()
        db.query(Comanda).filter(Comanda.restaurante_id == RESTAURANTE_ID).delete()
        db.query(CaixaTurno).filter(CaixaTurno.restaurante_id == RESTAURANTE_ID).delete()

        restaurante = db.query(Restaurante).filter(Restaurante.id == RESTAURANTE_ID).first()
        if restaurante is None:
            db.add(Restaurante(id=RESTAURANTE_ID, nome="SmartPOS Intent", plano="pocket"))
            db.flush()

        usuario = db.query(Usuario).filter(Usuario.id == USER_ID).first()
        if usuario is None:
            db.add(Usuario(
                id=USER_ID,
                nome="Garçom Intent",
                email="smartpos-intent@koma.test",
                senha_hash="$2b$12$dummyhashsmartposintent",
                role="garcom",
                status="ativo",
                restaurante_id=RESTAURANTE_ID,
            ))
            db.flush()

        capability = db.query(RestauranteCapability).filter(
            RestauranteCapability.restaurante_id == RESTAURANTE_ID,
            RestauranteCapability.capability == "smartpos",
        ).first()
        if capability is None:
            db.add(RestauranteCapability(
                restaurante_id=RESTAURANTE_ID,
                capability="smartpos",
                enabled=True,
                source="beta",
            ))
        else:
            capability.enabled = True

        categoria = db.query(Categoria).filter(
            Categoria.restaurante_id == RESTAURANTE_ID,
            Categoria.id == "cat-intent",
        ).first()
        if categoria is None:
            db.add(Categoria(
                id="cat-intent",
                restaurante_id=RESTAURANTE_ID,
                nome="Intent",
            ))
            db.flush()

        produto = db.query(Produto).filter(
            Produto.restaurante_id == RESTAURANTE_ID,
            Produto.id == "prod-intent",
        ).first()
        if produto is None:
            db.add(Produto(
                id="prod-intent",
                restaurante_id=RESTAURANTE_ID,
                categoria_id="cat-intent",
                nome="Produto Intent",
                preco=42,
                ativo=True,
            ))
            db.flush()

        mesa = db.query(Mesa).filter(
            Mesa.restaurante_id == RESTAURANTE_ID,
            Mesa.id == 4,
        ).first()
        if mesa is None:
            db.add(Mesa(
                id=4,
                restaurante_id=RESTAURANTE_ID,
                capacidade=4,
                nome="Mesa 4",
            ))
            db.flush()

        turno = CaixaTurno(
            restaurante_id=RESTAURANTE_ID,
            aberto_por_id=USER_ID,
            saldo_inicial=0,
            status="aberto",
        )
        db.add(turno)
        db.flush()

        comanda = Comanda(
            id="cmd-smartpos-intent",
            restaurante_id=RESTAURANTE_ID,
            mesa_id=4,
            garcom_id=USER_ID,
            tipo="Consumo no Local",
            numero_pedido=9404,
            valor_pago=0,
            fechada=False,
        )
        db.add(comanda)
        db.flush()

        lancamento = Lancamento(
            id="lan-smartpos-intent",
            restaurante_id=RESTAURANTE_ID,
            comanda_id=comanda.id,
            garcom_id=USER_ID,
        )
        db.add(lancamento)
        db.flush()

        db.add_all([
            Item(
                id="item-smartpos-intent-a",
                restaurante_id=RESTAURANTE_ID,
                comanda_id=comanda.id,
                lancamento_id=lancamento.id,
                produto_id="prod-intent",
                preco_unit=30,
                status="pronto",
                pago=False,
            ),
            Item(
                id="item-smartpos-intent-b",
                restaurante_id=RESTAURANTE_ID,
                comanda_id=comanda.id,
                lancamento_id=lancamento.id,
                produto_id="prod-intent",
                preco_unit=12,
                status="pronto",
                pago=False,
            ),
        ])
        db.commit()
        yield
    finally:
        db.rollback()
        db.close()
        current_restaurante_id.reset(token)


def headers():
    token = create_access_token(subject=USER_ID, restaurante_id=RESTAURANTE_ID, role="garcom")
    return {"Authorization": f"Bearer {token}"}


def test_criar_intent_nao_cria_receita_nem_altera_mesa():
    response = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "42.00",
            "metodo": "pix",
            "escopo": "valor",
            "idempotency_key": "smartpos-intent-0001",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "criada"
    assert response.json()["origem"] == "smartpos"
    assert response.json()["captura"] == "provider_integrado"

    token = current_restaurante_id.set(RESTAURANTE_ID)
    db = SessionLocal()
    try:
        assert db.query(SmartPosPaymentIntent).filter(
            SmartPosPaymentIntent.restaurante_id == RESTAURANTE_ID
        ).count() == 1
        assert db.query(Pagamento).filter(Pagamento.restaurante_id == RESTAURANTE_ID).count() == 0
        comanda = db.query(Comanda).filter(Comanda.id == "cmd-smartpos-intent").one()
        itens = db.query(Item).filter(Item.comanda_id == comanda.id).all()
        assert Decimal(str(comanda.valor_pago)) == Decimal("0")
        assert comanda.fechada is False
        assert all(item.pago is False for item in itens)
    finally:
        db.close()
        current_restaurante_id.reset(token)


def test_idempotencia_retorna_mesma_intencao_e_rejeita_payload_diferente():
    payload = {
        "mesa_id": 4,
        "valor": "20.00",
        "metodo": "credito",
        "escopo": "valor",
        "idempotency_key": "smartpos-intent-0002",
    }
    first = client.post("/auth/smartpos/payment-intents", headers=headers(), json=payload)
    second = client.post("/auth/smartpos/payment-intents", headers=headers(), json=payload)
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert first.json()["id"] == second.json()["id"]
    assert first.json()["captura"] == "provider_integrado"

    conflict = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={**payload, "valor": "19.00"},
    )
    assert conflict.status_code == 409


def test_escopo_itens_exige_valor_exato_e_itens_da_mesa():
    ok = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "30.00",
            "metodo": "dinheiro",
            "escopo": "itens",
            "item_ids": ["item-smartpos-intent-a"],
            "idempotency_key": "smartpos-intent-0003",
        },
    )
    assert ok.status_code == 201, ok.text
    assert ok.json()["item_ids"] == ["item-smartpos-intent-a"]
    assert ok.json()["captura"] == "dinheiro_pendente"

    mismatch = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "29.00",
            "metodo": "dinheiro",
            "escopo": "itens",
            "item_ids": ["item-smartpos-intent-a"],
            "idempotency_key": "smartpos-intent-0004",
        },
    )
    assert mismatch.status_code == 422


def test_intent_rejeita_valor_acima_do_saldo():
    response = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "42.01",
            "metodo": "pix",
            "escopo": "valor",
            "idempotency_key": "smartpos-intent-0005",
        },
    )
    assert response.status_code == 422


@pytest.mark.parametrize("metodo", ["pix", "debito", "credito", "voucher"])
def test_metodos_digitais_derivam_captura_integrada(metodo):
    response = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "10.00",
            "metodo": metodo,
            "escopo": "valor",
            "idempotency_key": f"capture-{metodo}-0001",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["metodo"] == metodo
    assert response.json()["captura"] == "provider_integrado"


def test_cartao_generico_nao_e_aceito_em_novas_intencoes():
    response = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "10.00",
            "metodo": "cartao",
            "escopo": "valor",
            "idempotency_key": "cartao-generico-0001",
        },
    )
    assert response.status_code == 422

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.financial_models import PagamentoEstorno
from app.financial_refund_models import PagamentoEstornoAlocacao, PagamentoEstornoLiquidacao
from app.financial_models import PagamentoEstorno
from app.financial_refund_models import PagamentoEstornoAlocacao, PagamentoEstornoLiquidacao
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
from app.services.smartpos_payment_state import can_transition
from app.smartpos_models import (
    RestauranteCapability,
    SmartPosPaymentIntent,
    SmartPosPaymentIntentEvent,
)


client = TestClient(app)
RESTAURANTE_ID = 9404
USER_ID = "smartpos-intent-garcom"
CAIXA_USER_ID = "smartpos-intent-caixa"
CAIXA_USER_ID = "smartpos-intent-caixa"


@pytest.fixture(autouse=True)
def setup_smartpos_payment_intent():
    Base.metadata.create_all(bind=engine)
    token = current_restaurante_id.set(RESTAURANTE_ID)
    db = SessionLocal()
    try:
        db.query(PagamentoEstornoAlocacao).filter(
            PagamentoEstornoAlocacao.restaurante_id == RESTAURANTE_ID
        ).delete()
        db.query(PagamentoEstornoLiquidacao).filter(
            PagamentoEstornoLiquidacao.restaurante_id == RESTAURANTE_ID
        ).delete()
        db.query(PagamentoEstorno).filter(
            PagamentoEstorno.restaurante_id == RESTAURANTE_ID
        ).delete()
        db.query(PagamentoEstornoAlocacao).filter(
            PagamentoEstornoAlocacao.restaurante_id == RESTAURANTE_ID
        ).delete()
        db.query(PagamentoEstornoLiquidacao).filter(
            PagamentoEstornoLiquidacao.restaurante_id == RESTAURANTE_ID
        ).delete()
        db.query(PagamentoEstorno).filter(
            PagamentoEstorno.restaurante_id == RESTAURANTE_ID
        ).delete()
        db.query(SmartPosPaymentIntentEvent).filter(
            SmartPosPaymentIntentEvent.restaurante_id == RESTAURANTE_ID
        ).delete()
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

        caixa_user = db.query(Usuario).filter(Usuario.id == CAIXA_USER_ID).first()
        if caixa_user is None:
            db.add(Usuario(
                id=CAIXA_USER_ID,
                nome="Caixa SmartPOS",
                email="smartpos-caixa@koma.test",
                senha_hash="$2b$12$dummyhashsmartposcaixa",
                role="caixa",
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


def caixa_headers():
    token = create_access_token(
        subject=CAIXA_USER_ID,
        restaurante_id=RESTAURANTE_ID,
        role="caixa",
    )
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


def test_idempotencia_considera_modo_de_captura():
    payload = {
        "mesa_id": 4,
        "valor": "10.00",
        "metodo": "debito",
        "captura": "provider_integrado",
        "escopo": "valor",
        "idempotency_key": "smartpos-capture-idem-01",
    }
    first = client.post("/auth/smartpos/payment-intents", headers=headers(), json=payload)
    assert first.status_code == 201, first.text

    conflict = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={**payload, "captura": "registro_externo"},
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
    assert ok.json()["status"] == "pendente"

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


@pytest.mark.parametrize("metodo", ["pix", "debito", "credito"])
def test_metodos_digitais_usam_integracao_por_padrao(metodo):
    response = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "10.00",
            "metodo": metodo,
            "escopo": "valor",
            "idempotency_key": f"capture-{metodo}-integrado",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["metodo"] == metodo
    assert response.json()["captura"] == "provider_integrado"
    assert response.json()["status"] == "criada"


@pytest.mark.parametrize("metodo", ["pix", "debito", "credito"])
def test_metodos_digitais_aceitam_registro_em_outra_maquininha(metodo):
    response = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "10.00",
            "metodo": metodo,
            "captura": "registro_externo",
            "escopo": "valor",
            "idempotency_key": f"capture-{metodo}-externo",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["metodo"] == metodo
    assert response.json()["captura"] == "registro_externo"
    assert response.json()["status"] == "pendente"

    token = current_restaurante_id.set(RESTAURANTE_ID)
    db = SessionLocal()
    try:
        assert db.query(Pagamento).filter(Pagamento.restaurante_id == RESTAURANTE_ID).count() == 0
        comanda = db.query(Comanda).filter(Comanda.id == "cmd-smartpos-intent").one()
        assert Decimal(str(comanda.valor_pago)) == Decimal("0")
        assert comanda.fechada is False
    finally:
        db.close()
        current_restaurante_id.reset(token)


def test_dinheiro_deriva_captura_manual_e_rejeita_captura_forcada():
    ok = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "10.00",
            "metodo": "dinheiro",
            "escopo": "valor",
            "idempotency_key": "dinheiro-pendente-0001",
        },
    )
    assert ok.status_code == 201, ok.text
    assert ok.json()["captura"] == "dinheiro_pendente"
    assert ok.json()["status"] == "pendente"

    invalid = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "10.00",
            "metodo": "dinheiro",
            "captura": "registro_externo",
            "escopo": "valor",
            "idempotency_key": "dinheiro-externo-0001",
        },
    )
    assert invalid.status_code == 422


def test_confirmacao_manual_e_idempotente_e_liquida_financeiro():
    created = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "10.00",
            "metodo": "debito",
            "captura": "registro_externo",
            "escopo": "valor",
            "idempotency_key": "manual-external-create-01",
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["status"] == "pendente"
    intent_id = created.json()["id"]

    confirm_payload = {
        "idempotency_key": "manual-external-confirm-01",
        "motivo": "Operador confirmou a transação na maquininha externa.",
    }
    first = client.post(
        f"/auth/smartpos/payment-intents/{intent_id}/confirmar-manual",
        headers=headers(),
        json=confirm_payload,
    )
    replay = client.post(
        f"/auth/smartpos/payment-intents/{intent_id}/confirmar-manual",
        headers=headers(),
        json=confirm_payload,
    )
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "aprovada"
    assert first.json()["transition_replayed"] is False
    assert first.json()["settled"] is True
    assert first.json()["financial_effect"] is True
    assert first.json()["payment_id"]
    assert replay.status_code == 200, replay.text
    assert replay.json()["status"] == "aprovada"
    assert replay.json()["transition_replayed"] is True
    assert replay.json()["payment_id"] == first.json()["payment_id"]

    token = current_restaurante_id.set(RESTAURANTE_ID)
    db = SessionLocal()
    try:
        events = db.query(SmartPosPaymentIntentEvent).filter(
            SmartPosPaymentIntentEvent.intent_id == intent_id
        ).order_by(SmartPosPaymentIntentEvent.criado_em.asc()).all()
        assert [(event.from_status, event.to_status) for event in events] == [
            ("criada", "pendente"),
            ("pendente", "aprovada"),
        ]
        pagamentos = db.query(Pagamento).filter(Pagamento.restaurante_id == RESTAURANTE_ID).all()
        assert len(pagamentos) == 1
        assert pagamentos[0].metodo == "cartao_debito"
        assert Decimal(str(pagamentos[0].valor)) == Decimal("10")
        comanda = db.query(Comanda).filter(Comanda.id == "cmd-smartpos-intent").one()
        assert Decimal(str(comanda.valor_pago)) == Decimal("10")
        assert comanda.fechada is False
    finally:
        db.close()
        current_restaurante_id.reset(token)


def test_dinheiro_confirma_troco_e_fecha_mesa_sem_inflar_receita():
    created = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "42.00",
            "metodo": "dinheiro",
            "escopo": "valor",
            "idempotency_key": "cash-full-create-f10",
        },
    )
    assert created.status_code == 201, created.text
    confirmed = client.post(
        f"/auth/smartpos/payment-intents/{created.json()['id']}/confirmar-manual",
        headers=headers(),
        json={
            "idempotency_key": "cash-full-confirm-f10",
            "valor_recebido": "50.00",
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    assert Decimal(str(confirmed.json()["troco"])) == Decimal("8.00")
    assert confirmed.json()["settled"] is True

    token = current_restaurante_id.set(RESTAURANTE_ID)
    db = SessionLocal()
    try:
        payment = db.query(Pagamento).filter(Pagamento.restaurante_id == RESTAURANTE_ID).one()
        assert payment.metodo == "dinheiro"
        assert Decimal(str(payment.valor)) == Decimal("42")
        comanda = db.query(Comanda).filter(Comanda.id == "cmd-smartpos-intent").one()
        assert Decimal(str(comanda.valor_pago)) == Decimal("42")
        assert comanda.fechada is True
        assert all(item.pago for item in db.query(Item).filter(Item.comanda_id == comanda.id).all())
    finally:
        db.close()
        current_restaurante_id.reset(token)


def test_dinheiro_rejeita_valor_recebido_menor_que_pagamento():
    created = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "10.00",
            "metodo": "dinheiro",
            "escopo": "valor",
            "idempotency_key": "cash-short-create-f10",
        },
    )
    response = client.post(
        f"/auth/smartpos/payment-intents/{created.json()['id']}/confirmar-manual",
        headers=headers(),
        json={
            "idempotency_key": "cash-short-confirm-f10",
            "valor_recebido": "9.99",
        },
    )
    assert response.status_code == 422


def test_voucher_falha_antes_de_criar_intent_sem_liquidacao():
    response = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "10.00",
            "metodo": "voucher",
            "captura": "registro_externo",
            "escopo": "valor",
            "idempotency_key": "voucher-blocked-f10",
        },
    )
    assert response.status_code == 422


def test_f11_pagamento_ativo_reserva_saldo_da_mesa():
    first = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "30.00",
            "metodo": "pix",
            "escopo": "valor",
            "idempotency_key": "f11-reserve-first-01",
        },
    )
    assert first.status_code == 201, first.text

    overflow = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "20.00",
            "metodo": "dinheiro",
            "escopo": "valor",
            "idempotency_key": "f11-reserve-overflow-01",
        },
    )
    assert overflow.status_code == 409, overflow.text
    assert "pagamentos em andamento" in overflow.json()["detail"]

    remaining = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "12.00",
            "metodo": "dinheiro",
            "escopo": "valor",
            "idempotency_key": "f11-reserve-remaining-01",
        },
    )
    assert remaining.status_code == 201, remaining.text


def test_f11_item_nao_pode_ser_reservado_por_duas_parcelas():
    first = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "30.00",
            "metodo": "pix",
            "escopo": "itens",
            "item_ids": ["item-smartpos-intent-a"],
            "idempotency_key": "f11-item-first-01",
        },
    )
    assert first.status_code == 201, first.text

    overlap = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "30.00",
            "metodo": "dinheiro",
            "escopo": "itens",
            "item_ids": ["item-smartpos-intent-a"],
            "idempotency_key": "f11-item-overlap-01",
        },
    )
    assert overlap.status_code == 409, overlap.text
    assert "itens já estão reservados" in overlap.json()["detail"]


def test_f11_divisao_sequencial_debito_externo_e_dinheiro_fecha_mesa():
    first = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "10.00",
            "metodo": "debito",
            "captura": "registro_externo",
            "escopo": "valor",
            "idempotency_key": "f11-split-debit-create",
        },
    )
    assert first.status_code == 201, first.text
    first_confirm = client.post(
        f"/auth/smartpos/payment-intents/{first.json()['id']}/confirmar-manual",
        headers=headers(),
        json={"idempotency_key": "f11-split-debit-confirm"},
    )
    assert first_confirm.status_code == 200, first_confirm.text
    assert first_confirm.json()["settled"] is True

    second = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "32.00",
            "metodo": "dinheiro",
            "escopo": "valor",
            "idempotency_key": "f11-split-cash-create",
        },
    )
    assert second.status_code == 201, second.text
    second_confirm = client.post(
        f"/auth/smartpos/payment-intents/{second.json()['id']}/confirmar-manual",
        headers=headers(),
        json={
            "idempotency_key": "f11-split-cash-confirm",
            "valor_recebido": "40.00",
        },
    )
    assert second_confirm.status_code == 200, second_confirm.text
    assert Decimal(str(second_confirm.json()["troco"])) == Decimal("8.00")

    token = current_restaurante_id.set(RESTAURANTE_ID)
    db = SessionLocal()
    try:
        pagamentos = db.query(Pagamento).filter(
            Pagamento.restaurante_id == RESTAURANTE_ID
        ).order_by(Pagamento.criado_em.asc()).all()
        assert len(pagamentos) == 2
        assert {pagamento.metodo for pagamento in pagamentos} == {"cartao_debito", "dinheiro"}
        assert sum(Decimal(str(pagamento.valor)) for pagamento in pagamentos) == Decimal("42")
        comanda = db.query(Comanda).filter(Comanda.id == "cmd-smartpos-intent").one()
        assert Decimal(str(comanda.valor_pago)) == Decimal("42")
        assert comanda.fechada is True
    finally:
        db.close()
        current_restaurante_id.reset(token)


def test_f12_cancelamento_pre_cobranca_libera_reserva_e_e_idempotente():
    first = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "30.00",
            "metodo": "pix",
            "escopo": "valor",
            "idempotency_key": "f12-cancel-create-01",
        },
    )
    assert first.status_code == 201, first.text
    intent_id = first.json()["id"]
    payload = {
        "idempotency_key": "f12-cancel-action-01",
        "motivo": "Cliente desistiu antes da cobrança.",
    }
    cancelled = client.post(
        f"/auth/smartpos/payment-intents/{intent_id}/cancelar",
        headers=headers(),
        json=payload,
    )
    replay = client.post(
        f"/auth/smartpos/payment-intents/{intent_id}/cancelar",
        headers=headers(),
        json=payload,
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelada"
    assert cancelled.json()["financial_effect"] is False
    assert replay.status_code == 200, replay.text
    assert replay.json()["transition_replayed"] is True

    full = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "42.00",
            "metodo": "dinheiro",
            "escopo": "valor",
            "idempotency_key": "f12-after-cancel-full",
        },
    )
    assert full.status_code == 201, full.text


def test_f12_cobranca_em_processamento_nao_pode_ser_cancelada():
    created = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "10.00",
            "metodo": "credito",
            "escopo": "valor",
            "idempotency_key": "f12-processing-create",
        },
    )
    intent_id = created.json()["id"]
    prepared = client.post(
        f"/auth/smartpos/payment-intents/{intent_id}/preparar-terminal",
        headers=headers(),
        json={
            "provider": "pagbank",
            "operation_key": "f12-processing-op-key",
            "terminal_id": "terminal-f12",
        },
    )
    assert prepared.status_code == 200, prepared.text
    assert prepared.json()["should_execute"] is True

    cancel = client.post(
        f"/auth/smartpos/payment-intents/{intent_id}/cancelar",
        headers=headers(),
        json={"idempotency_key": "f12-processing-cancel"},
    )
    assert cancel.status_code == 409, cancel.text
    assert "reconcil" in cancel.json()["detail"].lower()


def test_f12_pagamento_manual_pode_ser_estornado_no_caixa_sem_reabrir_comanda():
    created = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "42.00",
            "metodo": "dinheiro",
            "escopo": "valor",
            "idempotency_key": "f12-refund-cash-create",
        },
    )
    confirmed = client.post(
        f"/auth/smartpos/payment-intents/{created.json()['id']}/confirmar-manual",
        headers=headers(),
        json={
            "idempotency_key": "f12-refund-cash-confirm",
            "valor_recebido": "50.00",
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    payment_id = confirmed.json()["payment_id"]
    refund_payload = {
        "valor": "10.00",
        "motivo": "Devolução parcial solicitada pelo cliente.",
        "idempotency_key": "f12-refund-cash-action",
        "metodo_devolucao": "dinheiro",
    }
    refunded = client.post(
        f"/auth/caixa/pagamentos/{payment_id}/estornar",
        headers=caixa_headers(),
        json=refund_payload,
    )
    replay = client.post(
        f"/auth/caixa/pagamentos/{payment_id}/estornar",
        headers=caixa_headers(),
        json=refund_payload,
    )
    assert refunded.status_code == 201, refunded.text
    assert replay.status_code == 201, replay.text
    assert replay.json()["id"] == refunded.json()["id"]
    assert Decimal(str(refunded.json()["saldo_estornavel_pagamento"])) == Decimal("32.0")

    token = current_restaurante_id.set(RESTAURANTE_ID)
    db = SessionLocal()
    try:
        assert db.query(PagamentoEstorno).filter(
            PagamentoEstorno.restaurante_id == RESTAURANTE_ID,
            PagamentoEstorno.pagamento_id == payment_id,
        ).count() == 1
        comanda = db.query(Comanda).filter(Comanda.id == "cmd-smartpos-intent").one()
        assert comanda.fechada is True
        assert Decimal(str(comanda.valor_pago)) == Decimal("42")
    finally:
        db.close()
        current_restaurante_id.reset(token)


def test_f12_pagamento_provider_nao_pode_gerar_estorno_contabil_sem_reversao_real():
    created = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "42.00",
            "metodo": "pix",
            "escopo": "valor",
            "idempotency_key": "f12-provider-refund-create",
        },
    )
    intent_id = created.json()["id"]
    prepared = client.post(
        f"/auth/smartpos/payment-intents/{intent_id}/preparar-terminal",
        headers=headers(),
        json={
            "provider": "pagbank",
            "operation_key": "f12-provider-refund-op",
            "terminal_id": "terminal-f12-refund",
        },
    )
    assert prepared.status_code == 200, prepared.text
    approved = client.post(
        f"/auth/smartpos/payment-intents/{intent_id}/resultado-terminal",
        headers=headers(),
        json={
            "provider": "pagbank",
            "operation_key": "f12-provider-refund-op",
            "terminal_id": "terminal-f12-refund",
            "outcome": "approved",
            "reference": "provider-f12-approved",
        },
    )
    assert approved.status_code == 200, approved.text
    payment_id = approved.json()["payment_id"]
    assert payment_id

    listing = client.get(
        "/auth/caixa/pagamentos/estornaveis",
        headers=caixa_headers(),
    )
    assert listing.status_code == 200, listing.text
    assert payment_id not in {str(row["id"]) for row in listing.json()}

    refund = client.post(
        f"/auth/caixa/pagamentos/{payment_id}/estornar",
        headers=caixa_headers(),
        json={
            "valor": "42.00",
            "motivo": "Tentativa sem reversão no provider.",
            "idempotency_key": "f12-provider-refund-block",
            "metodo_devolucao": "pix",
        },
    )
    assert refund.status_code == 409, refund.text
    assert "provider" in refund.json()["detail"].lower()

    token = current_restaurante_id.set(RESTAURANTE_ID)
    db = SessionLocal()
    try:
        assert db.query(PagamentoEstorno).filter(
            PagamentoEstorno.restaurante_id == RESTAURANTE_ID,
            PagamentoEstorno.pagamento_id == payment_id,
        ).count() == 0
    finally:
        db.close()
        current_restaurante_id.reset(token)


def test_estado_terminal_exige_novo_intent_para_nova_tentativa():
    created = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "10.00",
            "metodo": "dinheiro",
            "escopo": "valor",
            "idempotency_key": "terminal-create-0001",
        },
    )
    intent_id = created.json()["id"]
    confirmed = client.post(
        f"/auth/smartpos/payment-intents/{intent_id}/confirmar-manual",
        headers=headers(),
        json={"idempotency_key": "terminal-confirm-0001"},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "aprovada"

    second_confirmation = client.post(
        f"/auth/smartpos/payment-intents/{intent_id}/confirmar-manual",
        headers=headers(),
        json={"idempotency_key": "terminal-confirm-0002"},
    )
    assert second_confirmation.status_code == 409

    new_intent = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "10.00",
            "metodo": "dinheiro",
            "escopo": "valor",
            "idempotency_key": "terminal-create-0002",
        },
    )
    assert new_intent.status_code == 201, new_intent.text
    assert new_intent.json()["id"] != intent_id
    assert new_intent.json()["status"] == "pendente"


def test_integrado_nao_pode_ser_aprovado_manualmente():
    created = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers(),
        json={
            "mesa_id": 4,
            "valor": "10.00",
            "metodo": "pix",
            "escopo": "valor",
            "idempotency_key": "integrated-create-0001",
        },
    )
    assert created.status_code == 201, created.text
    response = client.post(
        f"/auth/smartpos/payment-intents/{created.json()['id']}/confirmar-manual",
        headers=headers(),
        json={"idempotency_key": "integrated-confirm-01"},
    )
    assert response.status_code == 409


def test_grafo_de_estados_bloqueia_saltos_e_estados_terminais():
    assert can_transition("criada", "pendente") is True
    assert can_transition("criada", "aprovada") is False
    assert can_transition("pendente", "processando") is True
    assert can_transition("pendente", "aprovada") is True
    assert can_transition("processando", "aprovada") is True
    assert can_transition("processando", "recusada") is True
    for terminal in ("aprovada", "recusada", "cancelada", "expirada"):
        assert can_transition(terminal, "pendente") is False
        assert can_transition(terminal, "processando") is False


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


def test_schema_mantem_leitura_de_cartao_legado():
    token = current_restaurante_id.set(RESTAURANTE_ID)
    db = SessionLocal()
    try:
        turno = db.query(CaixaTurno).filter(
            CaixaTurno.restaurante_id == RESTAURANTE_ID,
            CaixaTurno.status == "aberto",
        ).one()
        legacy = SmartPosPaymentIntent(
            restaurante_id=RESTAURANTE_ID,
            turno_id=turno.id,
            mesa_id=4,
            operador_id=USER_ID,
            valor=Decimal("5.00"),
            metodo="cartao",
            captura="provider_integrado",
            escopo="valor",
            idempotency_key="legacy-cartao-0001",
            status="criada",
            origem="smartpos",
        )
        db.add(legacy)
        db.commit()
        db.refresh(legacy)
        assert legacy.metodo == "cartao"
        assert legacy.captura == "provider_integrado"
        assert legacy.status_em is not None
    finally:
        db.close()
        current_restaurante_id.reset(token)

from decimal import Decimal

import pytest

from app.database import Base, SessionLocal, current_restaurante_id, engine
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
from app.services.payment_providers.base import ProviderOutcome
from app.services.payment_providers.pagbank_simulator import PagBankSimulatorProvider
from app.services.smartpos_provider_orchestrator import (
    SmartPosProviderError,
    execute_provider_payment,
)
from app.smartpos_models import (
    RestauranteCapability,
    SmartPosPaymentIntent,
    SmartPosPaymentIntentEvent,
)


RESTAURANTE_ID = 9810
USER_ID = "smartpos-provider-user"


@pytest.fixture(autouse=True)
def setup_provider_flow():
    Base.metadata.create_all(bind=engine)
    token = current_restaurante_id.set(RESTAURANTE_ID)
    db = SessionLocal()
    try:
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
            db.add(Restaurante(id=RESTAURANTE_ID, nome="SmartPOS Provider", plano="pocket"))
            db.flush()

        usuario = db.query(Usuario).filter(Usuario.id == USER_ID).first()
        if usuario is None:
            db.add(Usuario(
                id=USER_ID,
                nome="Provider User",
                email="provider@koma.test",
                senha_hash="$2b$12$dummyhashprovider",
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

        categoria = db.query(Categoria).filter(Categoria.id == "cat-provider").first()
        if categoria is None:
            db.add(Categoria(id="cat-provider", restaurante_id=RESTAURANTE_ID, nome="Provider"))
            db.flush()
        produto = db.query(Produto).filter(Produto.id == "prod-provider").first()
        if produto is None:
            db.add(Produto(
                id="prod-provider",
                restaurante_id=RESTAURANTE_ID,
                categoria_id="cat-provider",
                nome="Produto Provider",
                preco=42,
                ativo=True,
            ))
            db.flush()
        mesa = db.query(Mesa).filter(
            Mesa.restaurante_id == RESTAURANTE_ID, Mesa.id == 81
        ).first()
        if mesa is None:
            db.add(Mesa(id=81, restaurante_id=RESTAURANTE_ID, capacidade=4, nome="Mesa 81"))
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
            id="cmd-provider",
            restaurante_id=RESTAURANTE_ID,
            mesa_id=81,
            garcom_id=USER_ID,
            tipo="Consumo no Local",
            numero_pedido=9810,
            valor_pago=0,
            fechada=False,
        )
        db.add(comanda)
        db.flush()
        lancamento = Lancamento(
            id="lan-provider",
            restaurante_id=RESTAURANTE_ID,
            comanda_id=comanda.id,
            garcom_id=USER_ID,
        )
        db.add(lancamento)
        db.flush()
        db.add(Item(
            id="item-provider",
            restaurante_id=RESTAURANTE_ID,
            comanda_id=comanda.id,
            lancamento_id=lancamento.id,
            produto_id="prod-provider",
            preco_unit=42,
            status="pronto",
            pago=False,
        ))
        db.commit()
        yield
    finally:
        db.rollback()
        db.close()
        current_restaurante_id.reset(token)


def _new_intent(db, *, method="credito", capture="provider_integrado", key="intent-provider-0001"):
    turno = db.query(CaixaTurno).filter(
        CaixaTurno.restaurante_id == RESTAURANTE_ID,
        CaixaTurno.status == "aberto",
    ).one()
    intent = SmartPosPaymentIntent(
        restaurante_id=RESTAURANTE_ID,
        turno_id=turno.id,
        mesa_id=81,
        operador_id=USER_ID,
        valor=Decimal("42.00"),
        metodo=method,
        captura=capture,
        escopo="valor",
        idempotency_key=key,
        status="criada" if capture == "provider_integrado" else "pendente",
        origem="smartpos",
    )
    db.add(intent)
    db.commit()
    db.refresh(intent)
    return intent


def _assert_no_financial_effect(db):
    assert db.query(Pagamento).filter(Pagamento.restaurante_id == RESTAURANTE_ID).count() == 0
    comanda = db.query(Comanda).filter(Comanda.id == "cmd-provider").one()
    item = db.query(Item).filter(Item.id == "item-provider").one()
    assert Decimal(str(comanda.valor_pago)) == Decimal("0")
    assert comanda.fechada is False
    assert item.pago is False


def test_pagbank_simulator_approved_moves_state_without_financial_effect():
    db = SessionLocal()
    try:
        intent = _new_intent(db)
        execution = execute_provider_payment(
            db,
            intent=intent,
            provider=PagBankSimulatorProvider(ProviderOutcome.APPROVED),
            operation_key="provider-operation-approved",
            terminal_id="POS-01",
            actor_id=USER_ID,
        )
        assert execution.intent.status == "aprovada"
        assert execution.intent.provider_name == "pagbank"
        assert execution.intent.provider_operation_key == "provider-operation-approved"
        assert execution.intent.provider_reference.startswith("pbsim-")
        events = db.query(SmartPosPaymentIntentEvent).filter(
            SmartPosPaymentIntentEvent.intent_id == intent.id
        ).all()
        assert [event.to_status for event in events] == ["pendente", "processando", "aprovada"]
        _assert_no_financial_effect(db)
    finally:
        db.close()


def test_provider_declined_is_terminal_and_same_key_replays_without_new_charge():
    db = SessionLocal()
    try:
        intent = _new_intent(db, key="intent-provider-0002")
        provider = PagBankSimulatorProvider(ProviderOutcome.DECLINED)
        first = execute_provider_payment(
            db,
            intent=intent,
            provider=provider,
            operation_key="provider-operation-declined",
            terminal_id="POS-01",
            actor_id=USER_ID,
        )
        assert first.intent.status == "recusada"
        replay = execute_provider_payment(
            db,
            intent=intent,
            provider=provider,
            operation_key="provider-operation-declined",
            terminal_id="POS-01",
            actor_id=USER_ID,
        )
        assert replay.replayed is True
        assert replay.result is None
        with pytest.raises(SmartPosProviderError):
            execute_provider_payment(
                db,
                intent=intent,
                provider=provider,
                operation_key="provider-operation-other",
                terminal_id="POS-01",
                actor_id=USER_ID,
            )
        _assert_no_financial_effect(db)
    finally:
        db.close()


def test_timeout_stays_processing_and_same_operation_can_reconcile():
    db = SessionLocal()
    try:
        intent = _new_intent(db, key="intent-provider-0003")
        timed_out = execute_provider_payment(
            db,
            intent=intent,
            provider=PagBankSimulatorProvider(ProviderOutcome.TIMEOUT),
            operation_key="provider-operation-timeout",
            terminal_id="POS-01",
            actor_id=USER_ID,
        )
        assert timed_out.intent.status == "processando"
        assert timed_out.intent.provider_last_error

        reconciled = execute_provider_payment(
            db,
            intent=intent,
            provider=PagBankSimulatorProvider(ProviderOutcome.APPROVED),
            operation_key="provider-operation-timeout",
            terminal_id="POS-01",
            actor_id=USER_ID,
        )
        assert reconciled.intent.status == "aprovada"
        assert reconciled.intent.provider_last_error is None
        _assert_no_financial_effect(db)
    finally:
        db.close()


def test_manual_capture_cannot_enter_provider_flow():
    db = SessionLocal()
    try:
        intent = _new_intent(
            db,
            method="credito",
            capture="registro_externo",
            key="intent-provider-0004",
        )
        with pytest.raises(SmartPosProviderError):
            execute_provider_payment(
                db,
                intent=intent,
                provider=PagBankSimulatorProvider(ProviderOutcome.APPROVED),
                operation_key="provider-operation-manual",
                terminal_id="POS-01",
                actor_id=USER_ID,
            )
        _assert_no_financial_effect(db)
    finally:
        db.close()

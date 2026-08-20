from decimal import Decimal

import pytest
from fastapi import BackgroundTasks

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
from app.routes.smartpos_provider import (
    SmartPosTerminalResultRequest,
    registrar_resultado_terminal,
)
from app.services.smartpos_settlement import (
    SmartPosSettlementError,
    settle_approved_smartpos_intent,
)
from app.services.smartpos_terminal_bridge import prepare_terminal_command
from app.smartpos_models import (
    RestauranteCapability,
    SmartPosPaymentIntent,
    SmartPosPaymentIntentEvent,
)


RESTAURANTE_ID = 9820
USER_ID = "smartpos-settlement-user"


@pytest.fixture(autouse=True)
def setup_settlement_flow(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.setenv("KOMA_SMARTPOS_PROVIDER", "pagbank_simulator")
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

        if db.query(Restaurante).filter(Restaurante.id == RESTAURANTE_ID).first() is None:
            db.add(Restaurante(id=RESTAURANTE_ID, nome="SmartPOS Settlement", plano="pocket"))
            db.flush()
        if db.query(Usuario).filter(Usuario.id == USER_ID).first() is None:
            db.add(Usuario(
                id=USER_ID,
                nome="Settlement User",
                email="settlement@koma.test",
                senha_hash="$2b$12$dummyhashsettlement",
                role="garcom",
                cargo="garcom",
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
        if db.query(Categoria).filter(Categoria.id == "cat-settlement").first() is None:
            db.add(Categoria(id="cat-settlement", restaurante_id=RESTAURANTE_ID, nome="Settlement"))
            db.flush()
        if db.query(Produto).filter(Produto.id == "prod-settlement").first() is None:
            db.add(Produto(
                id="prod-settlement",
                restaurante_id=RESTAURANTE_ID,
                categoria_id="cat-settlement",
                nome="Produto Settlement",
                preco=42,
                ativo=True,
            ))
            db.flush()
        if db.query(Mesa).filter(Mesa.restaurante_id == RESTAURANTE_ID, Mesa.id == 82).first() is None:
            db.add(Mesa(id=82, restaurante_id=RESTAURANTE_ID, capacidade=4, nome="Mesa 82"))
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
            id="cmd-settlement",
            restaurante_id=RESTAURANTE_ID,
            mesa_id=82,
            garcom_id=USER_ID,
            tipo="Consumo no Local",
            numero_pedido=9820,
            valor_pago=0,
            fechada=False,
        )
        db.add(comanda)
        db.flush()
        lancamento = Lancamento(
            id="lan-settlement",
            restaurante_id=RESTAURANTE_ID,
            comanda_id=comanda.id,
            garcom_id=USER_ID,
        )
        db.add(lancamento)
        db.flush()
        db.add(Item(
            id="item-settlement",
            restaurante_id=RESTAURANTE_ID,
            comanda_id=comanda.id,
            lancamento_id=lancamento.id,
            produto_id="prod-settlement",
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


def _turno(db):
    return db.query(CaixaTurno).filter(
        CaixaTurno.restaurante_id == RESTAURANTE_ID,
        CaixaTurno.status == "aberto",
    ).one()


def _approved_intent(db, *, value="42.00", method="debito", key="settlement-intent-0001"):
    intent = SmartPosPaymentIntent(
        restaurante_id=RESTAURANTE_ID,
        turno_id=_turno(db).id,
        mesa_id=82,
        operador_id=USER_ID,
        valor=Decimal(value),
        metodo=method,
        captura="provider_integrado",
        escopo="valor",
        idempotency_key=key,
        status="aprovada",
        provider_name="pagbank",
        provider_operation_key=f"provider-{key}",
        provider_terminal_id="POS-SETTLEMENT-01",
        provider_reference="PB-NSU-001",
        origem="smartpos",
    )
    db.add(intent)
    db.commit()
    db.refresh(intent)
    return intent


def test_approved_debit_settles_into_canonical_payment_and_closes_table():
    db = SessionLocal()
    try:
        intent = _approved_intent(db)
        result = settle_approved_smartpos_intent(
            db,
            restaurante_id=RESTAURANTE_ID,
            intent_id=intent.id,
        )
        assert result.replayed is False
        assert result.mesa_liberada is True
        assert result.pagamento.metodo == "cartao_debito"
        assert result.pagamento.status == "aprovado"
        assert Decimal(str(result.pagamento.valor)) == Decimal("42.0")
        assert result.pagamento.idempotency_key == f"smartpos:settlement:{intent.id}"
        assert result.pagamento.nsu_cartao == "PB-NSU-001"

        refreshed_intent = db.query(SmartPosPaymentIntent).filter_by(id=intent.id).one()
        comanda = db.query(Comanda).filter_by(id="cmd-settlement").one()
        item = db.query(Item).filter_by(id="item-settlement").one()
        assert refreshed_intent.pagamento_id == result.pagamento.id
        assert refreshed_intent.liquidado_em is not None
        assert Decimal(str(comanda.valor_pago)) == Decimal("42.0")
        assert comanda.fechada is True
        assert item.pago is True
    finally:
        db.close()


def test_settlement_replay_never_creates_second_payment():
    db = SessionLocal()
    try:
        intent = _approved_intent(db, key="settlement-intent-0002")
        first = settle_approved_smartpos_intent(db, restaurante_id=RESTAURANTE_ID, intent_id=intent.id)
        second = settle_approved_smartpos_intent(db, restaurante_id=RESTAURANTE_ID, intent_id=intent.id)
        assert second.replayed is True
        assert second.pagamento.id == first.pagamento.id
        assert db.query(Pagamento).filter(Pagamento.restaurante_id == RESTAURANTE_ID).count() == 1
    finally:
        db.close()


def test_partial_settlement_keeps_table_open_and_updates_balance_only():
    db = SessionLocal()
    try:
        intent = _approved_intent(db, value="19.00", key="settlement-intent-0003")
        result = settle_approved_smartpos_intent(db, restaurante_id=RESTAURANTE_ID, intent_id=intent.id)
        comanda = db.query(Comanda).filter_by(id="cmd-settlement").one()
        item = db.query(Item).filter_by(id="item-settlement").one()
        assert result.mesa_liberada is False
        assert Decimal(str(comanda.valor_pago)) == Decimal("19.0")
        assert comanda.fechada is False
        assert item.pago is False
    finally:
        db.close()


def test_closed_original_shift_blocks_settlement_without_losing_provider_approval():
    db = SessionLocal()
    try:
        intent = _approved_intent(db, key="settlement-intent-0004")
        turno = _turno(db)
        turno.status = "fechado"
        db.commit()
        with pytest.raises(SmartPosSettlementError):
            settle_approved_smartpos_intent(db, restaurante_id=RESTAURANTE_ID, intent_id=intent.id)
        db.rollback()
        persisted = db.query(SmartPosPaymentIntent).filter_by(id=intent.id).one()
        assert persisted.status == "aprovada"
        assert persisted.pagamento_id is None
        assert db.query(Pagamento).filter(Pagamento.restaurante_id == RESTAURANTE_ID).count() == 0
    finally:
        db.close()


def test_voucher_waits_for_future_financial_contract_instead_of_being_misclassified():
    db = SessionLocal()
    try:
        intent = _approved_intent(db, method="voucher", key="settlement-intent-0005")
        with pytest.raises(SmartPosSettlementError):
            settle_approved_smartpos_intent(db, restaurante_id=RESTAURANTE_ID, intent_id=intent.id)
        db.rollback()
        assert db.query(Pagamento).filter(Pagamento.restaurante_id == RESTAURANTE_ID).count() == 0
    finally:
        db.close()


def test_terminal_result_route_automatically_settles_approved_payment():
    db = SessionLocal()
    try:
        intent = SmartPosPaymentIntent(
            restaurante_id=RESTAURANTE_ID,
            turno_id=_turno(db).id,
            mesa_id=82,
            operador_id=USER_ID,
            valor=Decimal("42.00"),
            metodo="debito",
            captura="provider_integrado",
            escopo="valor",
            idempotency_key="settlement-route-intent-0001",
            status="criada",
            origem="smartpos",
        )
        db.add(intent)
        db.commit()
        db.refresh(intent)
        prepare_terminal_command(
            db,
            intent=intent,
            provider="pagbank",
            operation_key="settlement-route-op-0001",
            terminal_id="POS-SETTLEMENT-01",
            actor_id=USER_ID,
        )
        user = db.query(Usuario).filter(Usuario.id == USER_ID).one()
        response = registrar_resultado_terminal(
            intent.id,
            SmartPosTerminalResultRequest(
                provider="pagbank",
                operation_key="settlement-route-op-0001",
                terminal_id="POS-SETTLEMENT-01",
                outcome="approved",
                reference="PB-ROUTE-001",
                message="Aprovado no FakeBridge",
            ),
            BackgroundTasks(),
            db,
            user,
        )
        assert response["status"] == "aprovada"
        assert response["settled"] is True
        assert response["financial_effect"] is True
        assert response["payment_id"]
        assert db.query(Pagamento).filter(Pagamento.restaurante_id == RESTAURANTE_ID).count() == 1
    finally:
        db.close()

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
from app.routes.smartpos_cash_projection import projetar_operacao_smartpos_no_caixa
from app.routes.smartpos_provider import SmartPosTerminalResultRequest, registrar_resultado_terminal
from app.services.smartpos_terminal_bridge import prepare_terminal_command
from app.smartpos_models import (
    RestauranteCapability,
    SmartPosPaymentIntent,
    SmartPosPaymentIntentEvent,
)


RESTAURANTE_ID = 9840
USER_ID = "smartpos-e2e-cashier"
MESA_ID = 84


@pytest.fixture(autouse=True)
def setup_simulated_e2e(monkeypatch):
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
            db.add(Restaurante(id=RESTAURANTE_ID, nome="SmartPOS E2E", plano="pocket"))
            db.flush()
        if db.query(Usuario).filter(Usuario.id == USER_ID).first() is None:
            db.add(Usuario(
                id=USER_ID,
                nome="SmartPOS E2E Cashier",
                email="smartpos-e2e@koma.test",
                senha_hash="$2b$12$dummysmartpose2e",
                role="caixa",
                cargo="caixa",
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

        if db.query(Categoria).filter(Categoria.id == "cat-smartpos-e2e").first() is None:
            db.add(Categoria(
                id="cat-smartpos-e2e",
                restaurante_id=RESTAURANTE_ID,
                nome="SmartPOS E2E",
            ))
            db.flush()
        if db.query(Produto).filter(Produto.id == "prod-smartpos-e2e").first() is None:
            db.add(Produto(
                id="prod-smartpos-e2e",
                restaurante_id=RESTAURANTE_ID,
                categoria_id="cat-smartpos-e2e",
                nome="Produto SmartPOS E2E",
                preco=31,
                ativo=True,
            ))
            db.flush()
        if db.query(Mesa).filter(
            Mesa.restaurante_id == RESTAURANTE_ID,
            Mesa.id == MESA_ID,
        ).first() is None:
            db.add(Mesa(
                id=MESA_ID,
                restaurante_id=RESTAURANTE_ID,
                capacidade=4,
                nome=f"Mesa {MESA_ID}",
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
            id="cmd-smartpos-e2e",
            restaurante_id=RESTAURANTE_ID,
            mesa_id=MESA_ID,
            garcom_id=USER_ID,
            tipo="Consumo no Local",
            numero_pedido=9840,
            valor_pago=0,
            fechada=False,
        )
        db.add(comanda)
        db.flush()
        lancamento = Lancamento(
            id="lan-smartpos-e2e",
            restaurante_id=RESTAURANTE_ID,
            comanda_id=comanda.id,
            garcom_id=USER_ID,
        )
        db.add(lancamento)
        db.flush()
        db.add(Item(
            id="item-smartpos-e2e",
            restaurante_id=RESTAURANTE_ID,
            comanda_id=comanda.id,
            lancamento_id=lancamento.id,
            produto_id="prod-smartpos-e2e",
            preco_unit=31,
            status="pronto",
            pago=False,
        ))
        db.commit()
        yield
    finally:
        db.rollback()
        db.close()
        current_restaurante_id.reset(token)


def _new_intent(db, key: str) -> SmartPosPaymentIntent:
    turno = db.query(CaixaTurno).filter(
        CaixaTurno.restaurante_id == RESTAURANTE_ID,
        CaixaTurno.status == "aberto",
    ).one()
    intent = SmartPosPaymentIntent(
        restaurante_id=RESTAURANTE_ID,
        turno_id=turno.id,
        mesa_id=MESA_ID,
        operador_id=USER_ID,
        valor=Decimal("31.00"),
        metodo="debito",
        captura="provider_integrado",
        escopo="valor",
        idempotency_key=key,
        status="criada",
        origem="smartpos",
    )
    db.add(intent)
    db.commit()
    db.refresh(intent)
    return intent


def _prepare(db, intent: SmartPosPaymentIntent, operation_key: str):
    prepare_terminal_command(
        db,
        intent=intent,
        provider="pagbank",
        operation_key=operation_key,
        terminal_id="DEV-E2E-ANDROID",
        actor_id=USER_ID,
    )


def _terminal_result(db, intent: SmartPosPaymentIntent, operation_key: str, outcome: str, message: str):
    user = db.query(Usuario).filter(Usuario.id == USER_ID).one()
    return registrar_resultado_terminal(
        intent.id,
        SmartPosTerminalResultRequest(
            provider="pagbank",
            operation_key=operation_key,
            terminal_id="DEV-E2E-ANDROID",
            outcome=outcome,
            reference=(f"fake-{outcome}-{intent.id[:8]}" if outcome in {"approved", "declined"} else None),
            message=message,
        ),
        BackgroundTasks(),
        db,
        user,
    )


def test_timeout_remains_reconcilable_and_is_visible_to_cashier_without_financial_effect():
    db = SessionLocal()
    try:
        intent = _new_intent(db, "e2e-timeout-intent")
        _prepare(db, intent, "e2e-timeout-operation")
        response = _terminal_result(
            db,
            intent,
            "e2e-timeout-operation",
            "timeout",
            "Timeout simulado no FakeBridge Android",
        )

        assert response["status"] == "processando"
        assert response["settled"] is False
        assert response["financial_effect"] is False
        assert db.query(Pagamento).filter(Pagamento.restaurante_id == RESTAURANTE_ID).count() == 0

        user = db.query(Usuario).filter(Usuario.id == USER_ID).one()
        rows = projetar_operacao_smartpos_no_caixa(db=db, current_user=user)
        assert len(rows) == 1
        row = rows[0]
        assert row.estado_operacional == "pagamento_processando"
        assert row.pagamento is not None
        assert row.pagamento.intent_id == intent.id
        assert row.pagamento.terminal_id == "DEV-E2E-ANDROID"
        assert row.pagamento.provider_last_error == "Timeout simulado no FakeBridge Android"
    finally:
        db.close()


def test_approved_fakebridge_result_settles_once_and_removes_closed_table_from_projection():
    db = SessionLocal()
    try:
        intent = _new_intent(db, "e2e-approved-intent")
        _prepare(db, intent, "e2e-approved-operation")

        first = _terminal_result(
            db,
            intent,
            "e2e-approved-operation",
            "approved",
            "Aprovado no FakeBridge Android",
        )
        second = _terminal_result(
            db,
            intent,
            "e2e-approved-operation",
            "approved",
            "Replay do mesmo resultado local",
        )

        assert first["status"] == "aprovada"
        assert first["settled"] is True
        assert first["financial_effect"] is True
        assert first["payment_id"]
        assert second["payment_id"] == first["payment_id"]
        assert second["replayed"] is True
        assert db.query(Pagamento).filter(Pagamento.restaurante_id == RESTAURANTE_ID).count() == 1

        comanda = db.query(Comanda).filter(Comanda.id == "cmd-smartpos-e2e").one()
        item = db.query(Item).filter(Item.id == "item-smartpos-e2e").one()
        assert comanda.fechada is True
        assert Decimal(str(comanda.valor_pago)) == Decimal("31.0")
        assert item.pago is True

        user = db.query(Usuario).filter(Usuario.id == USER_ID).one()
        assert projetar_operacao_smartpos_no_caixa(db=db, current_user=user) == []
    finally:
        db.close()

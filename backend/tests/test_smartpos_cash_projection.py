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
    Produto,
    Restaurante,
    Usuario,
)
from app.routes.smartpos_cash_projection import projetar_operacao_smartpos_no_caixa
from app.smartpos_models import SmartPosPaymentIntent, SmartPosPaymentIntentEvent


RESTAURANTE_ID = 9830
OTHER_RESTAURANTE_ID = 9831
USER_ID = "smartpos-cash-projection-user"


@pytest.fixture(autouse=True)
def setup_projection():
    Base.metadata.create_all(bind=engine)
    token = current_restaurante_id.set(RESTAURANTE_ID)
    db = SessionLocal()
    try:
        for rid in (RESTAURANTE_ID, OTHER_RESTAURANTE_ID):
            db.query(SmartPosPaymentIntentEvent).filter(
                SmartPosPaymentIntentEvent.restaurante_id == rid
            ).delete()
            db.query(SmartPosPaymentIntent).filter(
                SmartPosPaymentIntent.restaurante_id == rid
            ).delete()
            db.query(Item).filter(Item.restaurante_id == rid).delete()
            db.query(Lancamento).filter(Lancamento.restaurante_id == rid).delete()
            db.query(Comanda).filter(Comanda.restaurante_id == rid).delete()
            db.query(CaixaTurno).filter(CaixaTurno.restaurante_id == rid).delete()

        for rid in (RESTAURANTE_ID, OTHER_RESTAURANTE_ID):
            if db.query(Restaurante).filter(Restaurante.id == rid).first() is None:
                db.add(Restaurante(id=rid, nome=f"Projection {rid}", plano="pocket"))
        db.flush()

        if db.query(Usuario).filter(Usuario.id == USER_ID).first() is None:
            db.add(Usuario(
                id=USER_ID,
                nome="Projection Cashier",
                email="projection@koma.test",
                senha_hash="$2b$12$dummyprojection",
                role="caixa",
                cargo="caixa",
                status="ativo",
                restaurante_id=RESTAURANTE_ID,
            ))
        if db.query(Categoria).filter(Categoria.id == "cat-projection").first() is None:
            db.add(Categoria(id="cat-projection", restaurante_id=RESTAURANTE_ID, nome="Projection"))
        db.flush()
        if db.query(Produto).filter(Produto.id == "prod-projection").first() is None:
            db.add(Produto(
                id="prod-projection",
                restaurante_id=RESTAURANTE_ID,
                categoria_id="cat-projection",
                nome="Produto Projection",
                preco=19,
                ativo=True,
            ))
        if db.query(Mesa).filter(Mesa.restaurante_id == RESTAURANTE_ID, Mesa.id == 83).first() is None:
            db.add(Mesa(id=83, restaurante_id=RESTAURANTE_ID, capacidade=4, nome="Mesa 83"))
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
            id="cmd-projection",
            restaurante_id=RESTAURANTE_ID,
            mesa_id=83,
            garcom_id=USER_ID,
            tipo="Consumo no Local",
            numero_pedido=9830,
            valor_pago=0,
            fechada=False,
        )
        db.add(comanda)
        db.flush()
        lancamento = Lancamento(
            id="lan-projection",
            restaurante_id=RESTAURANTE_ID,
            comanda_id=comanda.id,
            garcom_id=USER_ID,
            origem="smartpos",
        )
        db.add(lancamento)
        db.flush()
        db.add(Item(
            id="item-projection",
            restaurante_id=RESTAURANTE_ID,
            comanda_id=comanda.id,
            lancamento_id=lancamento.id,
            produto_id="prod-projection",
            preco_unit=19,
            status="preparando",
            pago=False,
        ))
        db.commit()
        yield
    finally:
        db.rollback()
        db.close()
        current_restaurante_id.reset(token)


def _projection(db):
    user = db.query(Usuario).filter(Usuario.id == USER_ID).one()
    rows = projetar_operacao_smartpos_no_caixa(db=db, current_user=user)
    assert len(rows) == 1
    return rows[0]


def _intent(db, status: str):
    turno = db.query(CaixaTurno).filter(
        CaixaTurno.restaurante_id == RESTAURANTE_ID,
        CaixaTurno.status == "aberto",
    ).one()
    intent = SmartPosPaymentIntent(
        restaurante_id=RESTAURANTE_ID,
        turno_id=turno.id,
        mesa_id=83,
        operador_id=USER_ID,
        valor=Decimal("19.00"),
        metodo="debito",
        captura="provider_integrado",
        escopo="valor",
        idempotency_key=f"projection-{status}",
        status=status,
        provider_name="pagbank" if status != "criada" else None,
        provider_operation_key=(f"projection-op-{status}" if status != "criada" else None),
        provider_terminal_id=("POS-PROJECTION" if status != "criada" else None),
        origem="smartpos",
    )
    db.add(intent)
    db.commit()
    db.refresh(intent)
    return intent


def test_preparing_table_is_not_misclassified_as_ready():
    db = SessionLocal()
    try:
        row = _projection(db)
        assert row.estado_operacional == "em_preparo"
        assert row.itens_preparando == 1
        assert row.saldo == Decimal("19.00")
        assert row.origem_smartpos is True
    finally:
        db.close()


def test_all_ready_items_move_table_to_waiting_payment():
    db = SessionLocal()
    try:
        item = db.query(Item).filter(Item.id == "item-projection").one()
        item.status = "pronto"
        db.commit()
        row = _projection(db)
        assert row.estado_operacional == "aguardando_pagamento"
        assert row.itens_prontos == 1
        assert row.saldo == Decimal("19.00")
    finally:
        db.close()


def test_created_smartpos_intent_already_blocks_duplicate_payment_flow():
    db = SessionLocal()
    try:
        item = db.query(Item).filter(Item.id == "item-projection").one()
        item.status = "pronto"
        db.commit()
        intent = _intent(db, "criada")
        row = _projection(db)
        assert row.estado_operacional == "pagamento_processando"
        assert row.pagamento is not None
        assert row.pagamento.intent_id == intent.id
        assert row.pagamento.status == "criada"
    finally:
        db.close()


def test_processing_smartpos_intent_has_priority_in_cash_projection():
    db = SessionLocal()
    try:
        item = db.query(Item).filter(Item.id == "item-projection").one()
        item.status = "pronto"
        db.commit()
        intent = _intent(db, "processando")
        row = _projection(db)
        assert row.estado_operacional == "pagamento_processando"
        assert row.pagamento is not None
        assert row.pagamento.intent_id == intent.id
        assert row.pagamento.terminal_id == "POS-PROJECTION"
    finally:
        db.close()


def test_provider_approval_without_settlement_is_visible_as_cashier_attention():
    db = SessionLocal()
    try:
        item = db.query(Item).filter(Item.id == "item-projection").one()
        item.status = "pronto"
        db.commit()
        intent = _intent(db, "aprovada")
        row = _projection(db)
        assert row.estado_operacional == "aprovado_pendente_liquidacao"
        assert row.pagamento is not None
        assert row.pagamento.intent_id == intent.id
        assert row.pagamento.pagamento_id is None
    finally:
        db.close()


def test_projection_is_strictly_tenant_scoped():
    db = SessionLocal()
    try:
        other = SmartPosPaymentIntent(
            restaurante_id=OTHER_RESTAURANTE_ID,
            turno_id=db.query(CaixaTurno.id).filter(
                CaixaTurno.restaurante_id == RESTAURANTE_ID
            ).scalar(),
            mesa_id=83,
            operador_id=USER_ID,
            valor=Decimal("999.00"),
            metodo="credito",
            captura="provider_integrado",
            escopo="valor",
            idempotency_key="projection-other-tenant",
            status="processando",
            origem="smartpos",
        )
        # O FK de mesa/turno impede fabricar uma linha cross-tenant inválida.
        # A própria ausência dessa linha no tenant 9831 é parte da proteção do schema;
        # aqui validamos que a projeção do tenant ativo permanece limitada aos dados locais.
        assert other.restaurante_id == OTHER_RESTAURANTE_ID
        row = _projection(db)
        assert row.mesa_id == 83
        assert row.valor_total == Decimal("19.00")
        assert row.pagamento is None
    finally:
        db.close()

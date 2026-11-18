from decimal import Decimal
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models as _models  # noqa: F401
from app import smartpos_models as _smartpos_models  # noqa: F401
from app.database import Base, SessionLocal, current_restaurante_id, engine as app_engine
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
from app.operational_models import AtendimentoComanda, AtendimentoMesa
from app.security import create_access_token
from app.services.smartpos_payment_state import (
    InvalidSmartPosTransition,
    transition_intent,
)
from app.smartpos_models import (
    RestauranteCapability,
    SmartPosPaymentIntent,
    SmartPosPaymentIntentEvent,
)


def test_stale_intent_snapshot_cannot_overwrite_newer_transition(tmp_path):
    """Uma sessão atrasada não pode criar uma segunda saída para o mesmo estado."""
    engine = create_engine(
        f"sqlite:///{tmp_path / 'smartpos-state.db'}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)

    first = SessionLocal()
    second = SessionLocal()
    verify = SessionLocal()
    try:
        first.add(
            SmartPosPaymentIntent(
                id="intent-concurrency-1",
                restaurante_id=1,
                turno_id=1,
                mesa_id=1,
                operador_id="operator-1",
                valor=25,
                metodo="pix",
                captura="registro_externo",
                escopo="valor",
                idempotency_key="intent-concurrency-key",
                status="pendente",
                origem="smartpos",
            )
        )
        first.commit()

        stale = first.query(SmartPosPaymentIntent).filter_by(
            id="intent-concurrency-1"
        ).one()
        concurrent = second.query(SmartPosPaymentIntent).filter_by(
            id="intent-concurrency-1"
        ).one()
        concurrent.status = "processando"
        second.commit()

        with pytest.raises(
            InvalidSmartPosTransition,
            match=r"processando -> cancelada",
        ):
            transition_intent(
                first,
                intent=stale,
                target_status="cancelada",
                transition_key="late-cancel-retry",
                actor_id=None,
            )
        first.rollback()

        persisted = verify.query(SmartPosPaymentIntent).filter_by(
            id="intent-concurrency-1"
        ).one()
        assert persisted.status == "processando"
        assert (
            verify.query(SmartPosPaymentIntentEvent)
            .filter_by(
                intent_id="intent-concurrency-1",
                transition_key="late-cancel-retry",
            )
            .count()
            == 0
        )
    finally:
        first.close()
        second.close()
        verify.close()
        engine.dispose()


def test_partial_item_settlement_allocates_to_owning_comanda_and_releases_table_when_all_paid(
    monkeypatch,
):
    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.setenv("KOMA_SMARTPOS_PROVIDER", "pagbank_simulator")
    Base.metadata.create_all(bind=app_engine)
    rid = 9551
    user_id = "smartpos-multi-garcom"
    mesa_id = 12
    token_ctx = current_restaurante_id.set(rid)
    db = SessionLocal()
    try:
        db.query(SmartPosPaymentIntentEvent).filter(
            SmartPosPaymentIntentEvent.restaurante_id == rid
        ).delete()
        db.query(SmartPosPaymentIntent).filter(
            SmartPosPaymentIntent.restaurante_id == rid
        ).delete()
        db.query(AtendimentoComanda).filter(
            AtendimentoComanda.restaurante_id == rid
        ).delete()
        db.query(AtendimentoMesa).filter(
            AtendimentoMesa.restaurante_id == rid
        ).delete()
        db.query(Pagamento).filter(Pagamento.restaurante_id == rid).delete()
        db.query(Item).filter(Item.restaurante_id == rid).delete()
        db.query(Lancamento).filter(Lancamento.restaurante_id == rid).delete()
        db.query(Comanda).filter(Comanda.restaurante_id == rid).delete()
        db.query(CaixaTurno).filter(CaixaTurno.restaurante_id == rid).delete()
        db.query(Mesa).filter(Mesa.restaurante_id == rid, Mesa.id == mesa_id).delete()
        db.query(RestauranteCapability).filter(
            RestauranteCapability.restaurante_id == rid
        ).delete()

        if db.query(Restaurante).filter(Restaurante.id == rid).first() is None:
            db.add(Restaurante(id=rid, nome="Multi Comanda SmartPOS", plano="pocket"))
            db.flush()
        if db.query(Usuario).filter(Usuario.id == user_id).first() is None:
            db.add(Usuario(
                id=user_id,
                nome="Garçom Multi",
                email="smartpos-multi@koma.test",
                senha_hash="$2b$12$dummyhashsmartposmulti",
                role="garcom",
                status="ativo",
                restaurante_id=rid,
            ))
            db.flush()
        db.add(RestauranteCapability(
            restaurante_id=rid,
            capability="smartpos",
            enabled=True,
            source="beta",
        ))
        if db.query(Categoria).filter(
            Categoria.restaurante_id == rid, Categoria.id == "cat-multi"
        ).first() is None:
            db.add(Categoria(id="cat-multi", restaurante_id=rid, nome="Lanches"))
            db.flush()
        if db.query(Produto).filter(
            Produto.restaurante_id == rid, Produto.id == "prod-multi"
        ).first() is None:
            db.add(Produto(
                id="prod-multi",
                restaurante_id=rid,
                categoria_id="cat-multi",
                nome="X-Bacon",
                preco=25,
                ativo=True,
            ))
            db.flush()
        db.add(Mesa(id=mesa_id, restaurante_id=rid, capacidade=4, nome="Mesa 12"))
        db.flush()
        db.add(CaixaTurno(
            restaurante_id=rid,
            aberto_por_id=user_id,
            saldo_inicial=0,
            status="aberto",
        ))
        db.flush()
        cmd_a = Comanda(
            id="cmd-multi-a",
            restaurante_id=rid,
            mesa_id=mesa_id,
            garcom_id=user_id,
            tipo="Consumo no Local",
            identificador="Ana",
            numero_pedido=9551,
            valor_pago=0,
            fechada=False,
        )
        cmd_b = Comanda(
            id="cmd-multi-b",
            restaurante_id=rid,
            mesa_id=mesa_id,
            garcom_id=user_id,
            tipo="Consumo no Local",
            identificador="Beto",
            numero_pedido=9551,
            valor_pago=0,
            fechada=False,
        )
        db.add_all([cmd_a, cmd_b])
        db.flush()
        lan_a = Lancamento(
            id="lan-multi-a", restaurante_id=rid, comanda_id=cmd_a.id, garcom_id=user_id
        )
        lan_b = Lancamento(
            id="lan-multi-b", restaurante_id=rid, comanda_id=cmd_b.id, garcom_id=user_id
        )
        db.add_all([lan_a, lan_b])
        db.flush()
        db.add_all([
            Item(
                id="item-multi-a1",
                restaurante_id=rid,
                comanda_id=cmd_a.id,
                lancamento_id=lan_a.id,
                produto_id="prod-multi",
                preco_unit=25,
                status="pronto",
                pago=False,
            ),
            Item(
                id="item-multi-b1",
                restaurante_id=rid,
                comanda_id=cmd_b.id,
                lancamento_id=lan_b.id,
                produto_id="prod-multi",
                preco_unit=40,
                status="pronto",
                pago=False,
            ),
        ])
        db.commit()
    finally:
        db.close()
        current_restaurante_id.reset(token_ctx)

    client = TestClient(app)
    token = create_access_token(subject=user_id, restaurante_id=rid, role="garcom")
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Paga apenas o item da segunda comanda (Beto = R$ 40,00)
    first_intent = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers,
        json={
            "mesa_id": mesa_id,
            "valor": "40.00",
            "metodo": "pix",
            "captura": "registro_externo",
            "escopo": "itens",
            "item_ids": ["item-multi-b1"],
            "idempotency_key": "multi-item-b-create-1",
        },
    )
    assert first_intent.status_code == 201, first_intent.text
    first_confirm = client.post(
        f"/auth/smartpos/payment-intents/{first_intent.json()['id']}/confirmar-manual",
        headers=headers,
        json={"idempotency_key": "multi-item-b-confirm-1"},
    )
    assert first_confirm.status_code == 200, first_confirm.text
    assert first_confirm.json()["mesa_liberada"] is False

    token_ctx = current_restaurante_id.set(rid)
    db = SessionLocal()
    try:
        cmd_a = db.query(Comanda).filter(Comanda.id == "cmd-multi-a").one()
        cmd_b = db.query(Comanda).filter(Comanda.id == "cmd-multi-b").one()
        assert Decimal(str(cmd_a.valor_pago)) == Decimal("0.00")
        assert cmd_a.fechada is False
        assert Decimal(str(cmd_b.valor_pago)) == Decimal("40.00")
        assert cmd_b.fechada is True
        atendimento = db.query(AtendimentoMesa).filter(
            AtendimentoMesa.restaurante_id == rid,
            AtendimentoMesa.mesa_id == mesa_id,
        ).one()
        assert atendimento.status == "aberto"
    finally:
        db.close()
        current_restaurante_id.reset(token_ctx)

    # 2. Quita o restante (Ana = R$ 25,00) via terminal integrado com perda de resposta e reconciliação
    second_intent = client.post(
        "/auth/smartpos/payment-intents",
        headers=headers,
        json={
            "mesa_id": mesa_id,
            "valor": "25.00",
            "metodo": "credito",
            "captura": "provider_integrado",
            "escopo": "valor",
            "idempotency_key": "multi-rest-create-2",
        },
    )
    assert second_intent.status_code == 201, second_intent.text
    intent_id = second_intent.json()["id"]

    prep1 = client.post(
        f"/auth/smartpos/payment-intents/{intent_id}/preparar-terminal",
        headers=headers,
        json={
            "provider": "pagbank",
            "operation_key": "op-multi-reconcile-01",
            "terminal_id": "POS-MULTI-1",
        },
    )
    assert prep1.status_code == 200, prep1.text
    assert prep1.json()["mode"] == "charge"
    assert prep1.json()["should_execute"] is True

    # Retry após queda antes da confirmação deve retornar mode=reconcile e should_execute=False
    prep2 = client.post(
        f"/auth/smartpos/payment-intents/{intent_id}/preparar-terminal",
        headers=headers,
        json={
            "provider": "pagbank",
            "operation_key": "op-multi-reconcile-01",
            "terminal_id": "POS-MULTI-1",
        },
    )
    assert prep2.status_code == 200, prep2.text
    assert prep2.json()["mode"] == "reconcile"
    assert prep2.json()["should_execute"] is False

    settled = client.post(
        f"/auth/smartpos/payment-intents/{intent_id}/resultado-terminal",
        headers=headers,
        json={
            "provider": "pagbank",
            "operation_key": "op-multi-reconcile-01",
            "terminal_id": "POS-MULTI-1",
            "outcome": "approved",
            "reference": "TXN-PAGBANK-9551",
        },
    )
    assert settled.status_code == 200, settled.text
    assert settled.json()["settled"] is True
    assert settled.json()["mesa_liberada"] is True

    token_ctx = current_restaurante_id.set(rid)
    db = SessionLocal()
    try:
        cmd_a = db.query(Comanda).filter(Comanda.id == "cmd-multi-a").one()
        assert cmd_a.fechada is True
        atendimento = db.query(AtendimentoMesa).filter(
            AtendimentoMesa.restaurante_id == rid,
            AtendimentoMesa.mesa_id == mesa_id,
        ).one()
        assert atendimento.status == "fechado"
        assert atendimento.fechado_em is not None
    finally:
        db.close()
        current_restaurante_id.reset(token_ctx)

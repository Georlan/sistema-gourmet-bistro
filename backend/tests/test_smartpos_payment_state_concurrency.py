import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models as _models  # noqa: F401
from app import smartpos_models as _smartpos_models  # noqa: F401
from app.database import Base
from app.services.smartpos_payment_state import (
    InvalidSmartPosTransition,
    transition_intent,
)
from app.smartpos_models import SmartPosPaymentIntent, SmartPosPaymentIntentEvent


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

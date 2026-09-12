from dataclasses import dataclass

import pytest

from app.database import SessionLocal
from app.models import IntegrationOutbox
from app.services.outbox.publisher import enqueue_outbox_event_in_session
from tests.characterization.orders.fixtures import (
    CHAR_RESTAURANT_ID,
    char_client,
    char_setup,
)


@dataclass(frozen=True)
class StableTestEvent:
    event_id: str
    restaurant_id: int
    order_id: str
    marker: str = "same"


def test_same_stable_event_is_materialized_once_in_outbox(char_setup):
    db = SessionLocal(restaurante_id=CHAR_RESTAURANT_ID)
    event_id = "evt-outbox-idempotency-regression"
    try:
        db.query(IntegrationOutbox).filter(
            IntegrationOutbox.restaurante_id == CHAR_RESTAURANT_ID,
            IntegrationOutbox.event_id == event_id,
        ).delete()
        db.commit()

        event = StableTestEvent(
            event_id=event_id,
            restaurant_id=CHAR_RESTAURANT_ID,
            order_id="order-idempotency-regression",
        )

        first = enqueue_outbox_event_in_session(db, event)
        second = enqueue_outbox_event_in_session(db, event)
        db.commit()

        rows = db.query(IntegrationOutbox).filter(
            IntegrationOutbox.restaurante_id == CHAR_RESTAURANT_ID,
            IntegrationOutbox.event_id == event_id,
        ).all()

        assert second.id == first.id
        assert len(rows) == 1
    finally:
        db.close()


def test_same_event_id_rejects_payload_drift(char_setup):
    db = SessionLocal(restaurante_id=CHAR_RESTAURANT_ID)
    event_id = "evt-outbox-payload-drift-regression"
    try:
        db.query(IntegrationOutbox).filter(
            IntegrationOutbox.restaurante_id == CHAR_RESTAURANT_ID,
            IntegrationOutbox.event_id == event_id,
        ).delete()
        db.commit()

        enqueue_outbox_event_in_session(
            db,
            StableTestEvent(
                event_id=event_id,
                restaurant_id=CHAR_RESTAURANT_ID,
                order_id="order-original",
            ),
        )

        with pytest.raises(ValueError, match="conteúdo diferente"):
            enqueue_outbox_event_in_session(
                db,
                StableTestEvent(
                    event_id=event_id,
                    restaurant_id=CHAR_RESTAURANT_ID,
                    order_id="order-drifted",
                ),
            )
    finally:
        db.rollback()
        db.close()

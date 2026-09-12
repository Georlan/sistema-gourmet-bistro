from __future__ import annotations

import datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Comanda, Restaurante, Usuario
from app.order_chat_models import OrderConversation, OrderMessage, OrderPushSubscription
from app.services.order_chat_retention import purge_expired_closed_conversations_in_session
from app.services.outbox.worker import OutboxWorker


def _session():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    return engine, Session()


def _seed_tenant(db, *, restaurante_id: int, suffix: str, pedido_ids: list[str]):
    restaurante = Restaurante(
        id=restaurante_id,
        nome=f"Retention {suffix}",
        plano="pro",
        slug=f"retention-{suffix.lower()}",
    )
    user_id = restaurante_id * 10
    usuario = Usuario(
        id=user_id,
        restaurante_id=restaurante_id,
        nome=f"Operador {suffix}",
        email=f"retention-{suffix.lower()}@example.com",
        cargo="caixa",
        status="ativo",
    )
    db.add_all([restaurante, usuario])
    db.flush()

    for index, pedido_id in enumerate(pedido_ids, start=1):
        db.add(
            Comanda(
                id=pedido_id,
                restaurante_id=restaurante_id,
                garcom_id=str(user_id),
                numero_pedido=(restaurante_id * 1000) + index,
                tipo="Retirada",
                delivery_status="finalizado",
                idempotency_key=f"retention-{pedido_id}",
            )
        )
    db.flush()


def _conversation(
    *,
    conversation_id: str,
    restaurante_id: int,
    pedido_id: str,
    token_char: str,
    closed_at: datetime.datetime | None,
) -> OrderConversation:
    return OrderConversation(
        id=conversation_id,
        restaurante_id=restaurante_id,
        pedido_id=pedido_id,
        public_access_token_hash=token_char * 64,
        closed_at=closed_at,
    )


def test_retention_purges_only_expired_closed_target_tenant_rows_and_preserves_orders():
    engine, db = _session()
    now = datetime.datetime(2026, 9, 9, 12, 0, tzinfo=datetime.timezone.utc)
    try:
        _seed_tenant(
            db,
            restaurante_id=9101,
            suffix="Alpha",
            pedido_ids=["ret-old", "ret-recent", "ret-open"],
        )
        _seed_tenant(
            db,
            restaurante_id=9102,
            suffix="Beta",
            pedido_ids=["ret-other-tenant"],
        )

        old = _conversation(
            conversation_id="conv-old",
            restaurante_id=9101,
            pedido_id="ret-old",
            token_char="a",
            closed_at=now - datetime.timedelta(days=91),
        )
        recent = _conversation(
            conversation_id="conv-recent",
            restaurante_id=9101,
            pedido_id="ret-recent",
            token_char="b",
            closed_at=now - datetime.timedelta(days=89),
        )
        opened = _conversation(
            conversation_id="conv-open",
            restaurante_id=9101,
            pedido_id="ret-open",
            token_char="c",
            closed_at=None,
        )
        other_tenant = _conversation(
            conversation_id="conv-other",
            restaurante_id=9102,
            pedido_id="ret-other-tenant",
            token_char="d",
            closed_at=now - datetime.timedelta(days=365),
        )
        db.add_all([old, recent, opened, other_tenant])
        db.flush()

        db.add(
            OrderMessage(
                id="message-old",
                restaurante_id=9101,
                conversation_id=old.id,
                pedido_id=old.pedido_id,
                sender_type="customer",
                body="mensagem expirada",
                body_format="plain_text_v2",
            )
        )
        db.add(
            OrderPushSubscription(
                id="push-old",
                restaurante_id=9101,
                conversation_id=old.id,
                pedido_id=old.pedido_id,
                endpoint_hash="e" * 64,
                endpoint_ciphertext="encrypted-endpoint",
                p256dh_ciphertext="encrypted-p256dh",
                auth_ciphertext="encrypted-auth",
            )
        )
        db.commit()

        stats = purge_expired_closed_conversations_in_session(
            db,
            restaurante_id=9101,
            retention_days=90,
            batch_size=100,
            now=now,
        )
        db.commit()
        db.expire_all()

        assert stats == {
            "conversations_deleted": 1,
            "messages_deleted": 1,
            "push_subscriptions_deleted": 1,
        }
        assert db.get(OrderConversation, "conv-old") is None
        assert db.get(OrderMessage, "message-old") is None
        assert db.get(OrderPushSubscription, "push-old") is None

        assert db.get(OrderConversation, "conv-recent") is not None
        assert db.get(OrderConversation, "conv-open") is not None
        assert db.get(OrderConversation, "conv-other") is not None

        # Retenção de chat nunca apaga o pedido/comanda de origem.
        assert db.get(Comanda, "ret-old") is not None
        assert db.query(Comanda).filter(Comanda.id.in_([
            "ret-old",
            "ret-recent",
            "ret-open",
            "ret-other-tenant",
        ])).count() == 4
    finally:
        db.close()
        engine.dispose()


def test_retention_is_batch_bounded_and_disabled_worker_is_noop():
    engine, db = _session()
    now = datetime.datetime(2026, 9, 9, 12, 0, tzinfo=datetime.timezone.utc)
    try:
        pedido_ids = ["ret-batch-1", "ret-batch-2", "ret-batch-3"]
        _seed_tenant(
            db,
            restaurante_id=9201,
            suffix="Batch",
            pedido_ids=pedido_ids,
        )
        for index, pedido_id in enumerate(pedido_ids, start=1):
            db.add(
                _conversation(
                    conversation_id=f"conv-batch-{index}",
                    restaurante_id=9201,
                    pedido_id=pedido_id,
                    token_char=str(index),
                    closed_at=now - datetime.timedelta(days=100 + index),
                )
            )
        db.commit()

        stats = purge_expired_closed_conversations_in_session(
            db,
            restaurante_id=9201,
            retention_days=90,
            batch_size=2,
            now=now,
        )
        db.commit()
        db.expire_all()
        assert stats["conversations_deleted"] == 2
        assert db.query(OrderConversation).filter(
            OrderConversation.restaurante_id == 9201
        ).count() == 1

        disabled_worker = OutboxWorker(chat_retention_enabled=False)
        assert disabled_worker.run_chat_retention_sweep(restaurant_id=9201) == {
            "conversations_deleted": 0,
            "messages_deleted": 0,
            "push_subscriptions_deleted": 0,
        }

        with pytest.raises(ValueError):
            purge_expired_closed_conversations_in_session(
                db,
                restaurante_id=9201,
                retention_days=0,
                now=now,
            )
    finally:
        db.close()
        engine.dispose()

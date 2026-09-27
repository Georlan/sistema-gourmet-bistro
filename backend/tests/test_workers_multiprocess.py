"""Exercise the real PostgreSQL worker claims from two separate processes."""

import datetime as dt
import json
import multiprocessing as mp
import os
import uuid

import pytest


def _worker(kind, name, gate, output, url, restaurant_id):
    os.environ["DATABASE_URL"] = url
    os.environ["MIGRATION_DATABASE_URL"] = url
    try:
        gate.wait(10)
        if kind == "signup":
            from app.services import signup_notifications

            signup_notifications._deliver = lambda _payload, delivery_id: output.put((name, delivery_id))
            signup_notifications.dispatch_batch()
        elif kind == "outbox":
            from sqlalchemy.orm import Session
            from app.database import engine
            from app.services.outbox.dispatcher import claim_outbox_batch

            with Session(engine) as db:
                for row in claim_outbox_batch(db, batch_size=10, worker_id=name, restaurant_id=restaurant_id):
                    output.put((name, row["id"]))
        else:
            from sqlalchemy.orm import Session
            from app.database import engine
            from app.services.scheduled_orders import release_due_scheduled_orders_in_session

            with Session(engine) as db:
                released = release_due_scheduled_orders_in_session(db, restaurante_id=restaurant_id)
                db.commit()
                output.put((name, str(released)))
        output.put((name, "DONE"))
    except Exception as exc:
        output.put((name, f"ERROR:{type(exc).__name__}:{exc}"))


def test_signup_and_outbox_claims_are_disjoint_between_processes():
    url = os.getenv("KOMA_WORKER_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set KOMA_WORKER_TEST_DATABASE_URL to a migrated disposable PostgreSQL database")

    import psycopg2
    from psycopg2.extras import Json
    from app.crypt import encrypt_field

    dsn = url.replace("postgresql+psycopg2://", "postgresql://", 1)
    marker = uuid.uuid4().hex
    signup_ids = [f"worker-{marker}-{index}:test:email" for index in range(20)]
    outbox_ids = [f"{marker}-{index:02}" for index in range(20)]
    user_id = marker
    order_id = f"{marker}-s"
    schedule_id = f"{marker}-d"
    now = dt.datetime.now(dt.timezone.utc)
    payload = encrypt_field(json.dumps({
        "channel": "email", "recipient": "worker-test@koma.test",
        "subject": "QA", "message": "QA only",
    }))
    with psycopg2.connect(dsn) as connection, connection.cursor() as cursor:
        cursor.execute("INSERT INTO restaurantes(nome, plano) VALUES (%s, %s) RETURNING id", (f"worker-{marker}", "basic"))
        restaurant_id = cursor.fetchone()[0]
        cursor.execute("INSERT INTO usuarios(id,restaurante_id,nome) VALUES (%s,%s,'Worker QA')", (user_id, restaurant_id))
        cursor.execute(
            "INSERT INTO comandas(id,restaurante_id,garcom_id,numero_pedido,valor_pago,fechada) VALUES (%s,%s,%s,1,0,false)",
            (order_id, restaurant_id, user_id),
        )
        cursor.execute(
            "INSERT INTO scheduled_orders(id,restaurante_id,comanda_id,scheduled_for,created_at) VALUES (%s,%s,%s,%s,%s)",
            (schedule_id, restaurant_id, order_id, now - dt.timedelta(minutes=1), now),
        )
        for signup_id in signup_ids:
            cursor.execute(
                "INSERT INTO signup_notifications(id,payload_encrypted,status,attempts,next_attempt_at,expires_at) "
                "VALUES (%s,%s,'pending',0,%s,%s)",
                (signup_id, payload, now, now + dt.timedelta(hours=1)),
            )
        for outbox_id in outbox_ids:
            cursor.execute(
                "INSERT INTO integration_outbox(id,restaurante_id,event_id,event_name,aggregate_id,payload,created_at) "
                "VALUES (%s,%s,%s,'koma.order.created',%s,%s,%s)",
                (outbox_id, restaurant_id, outbox_id, outbox_id, Json({"test": marker}), now),
            )

    context = mp.get_context("spawn")
    try:
        for kind, expected in (("signup", set(signup_ids)), ("outbox", set(outbox_ids))):
            gate = context.Event()
            output = context.Queue()
            names = [f"{kind}-A", f"{kind}-B"]
            processes = [context.Process(target=_worker, args=(kind, name, gate, output, url, restaurant_id)) for name in names]
            for process in processes:
                process.start()
            gate.set()
            received = [output.get(timeout=20) for _ in range(22)]
            for process in processes:
                process.join(timeout=10)
                assert process.exitcode == 0
            assert {name for name, item in received if item == "DONE"} == set(names)
            claimed = [(name, item) for name, item in received if item != "DONE"]
            assert len(claimed) == 20
            assert {item for _, item in claimed} == expected
            assert len({item for _, item in claimed}) == 20
            assert all(any(name == worker for name, _ in claimed) for worker in names)

        with psycopg2.connect(dsn) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT status, attempts, count(*) FROM signup_notifications WHERE id = ANY(%s) GROUP BY status, attempts", (signup_ids,))
            assert cursor.fetchall() == [("sent", 1, 20)]
            cursor.execute("SELECT status, count(DISTINCT locked_by), count(*) FROM integration_outbox WHERE id = ANY(%s) GROUP BY status", (outbox_ids,))
            assert cursor.fetchall() == [("processing", 2, 20)]

        gate = context.Event()
        output = context.Queue()
        processes = [context.Process(target=_worker, args=("scheduled", name, gate, output, url, restaurant_id))
                     for name in ("scheduled-A", "scheduled-B")]
        for process in processes:
            process.start()
        gate.set()
        received = [output.get(timeout=20) for _ in range(4)]
        for process in processes:
            process.join(timeout=10)
            assert process.exitcode == 0
        assert sum(int(item) for _, item in received if item != "DONE") == 1
        with psycopg2.connect(dsn) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT released_at IS NOT NULL FROM scheduled_orders WHERE id=%s", (schedule_id,))
            assert cursor.fetchone() == (True,)
    finally:
        with psycopg2.connect(dsn) as connection, connection.cursor() as cursor:
            cursor.execute("DELETE FROM signup_notifications WHERE id = ANY(%s)", (signup_ids,))
            cursor.execute("DELETE FROM integration_outbox WHERE id = ANY(%s)", (outbox_ids,))
            cursor.execute("DELETE FROM scheduled_orders WHERE id = %s", (schedule_id,))
            cursor.execute("DELETE FROM comandas WHERE id = %s", (order_id,))
            cursor.execute("DELETE FROM usuarios WHERE id = %s", (user_id,))
            cursor.execute("DELETE FROM restaurantes WHERE id = %s", (restaurant_id,))

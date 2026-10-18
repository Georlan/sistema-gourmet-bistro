"""Two operators must not bypass the confirmed-contact cooldown concurrently."""
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Cliente, Restaurante
from app.crm_models import CrmContatoCliente
from app.services.customer_crm import record_crm_customer_contact


def test_concurrent_manual_confirmations_create_one_contact():
    url = os.environ.get("CRM_POSTGRES_TEST_URL")
    if not url:
        pytest.skip("Requires disposable local PostgreSQL via CRM_POSTGRES_TEST_URL")
    assert make_url(url).host in {"localhost", "127.0.0.1"}, "Only local test PostgreSQL is allowed"
    engine = create_engine(url)
    customer_id = str(uuid.uuid4())
    restaurant_id = 9347
    try:
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            if db.get(Restaurante, restaurant_id) is None:
                db.add(Restaurante(id=restaurant_id, nome="Concurrent contact fixture"))
                db.flush()
            db.add(Cliente(id=customer_id, restaurante_id=restaurant_id,
                nome="Synthetic customer", telefone="85999993305"))
            db.commit()

        # Without a customer lock, both SELECTs observe no contact before
        # either INSERT commits. With the lock, the second SELECT must wait
        # for the first transaction, then observe its confirmed contact.
        rendezvous = threading.Barrier(2)

        @event.listens_for(engine, "after_cursor_execute")
        def synchronize_contact_reads(conn, cursor, statement, parameters, context, executemany):
            if "FROM crm_contatos_clientes" in statement and "ORDER BY" in statement:
                try:
                    rendezvous.wait(timeout=2)
                except threading.BrokenBarrierError:
                    pass

        def confirm(_):
            with Session(engine) as db:
                try:
                    record_crm_customer_contact(db, restaurante_id=restaurant_id,
                        usuario_id=None, cliente_id=customer_id,
                        acao_executada="CONTATO_MANUAL_CONFIRMADO")
                    return 201
                except HTTPException as exc:
                    db.rollback()
                    return exc.status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(confirm, range(2)))
        assert sorted(statuses) == [201, 409]
        with Session(engine) as db:
            assert db.query(CrmContatoCliente).filter_by(
                restaurante_id=restaurant_id, cliente_id=customer_id).count() == 1
    finally:
        engine.dispose()

"""Exercise real row locks using synthetic data in a disposable local database."""
import datetime
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.database import Base, TenantSession, current_restaurante_id
from app.models import Comanda, Mesa, Restaurante, Usuario
from app.operational_models import MovimentoAtendimento
from app.routes.atendimentos import transferir_atendimento_compativel
from app.services import atendimentos as service

POSTGRES_URL = os.getenv("KOMA_CONCURRENCY_DATABASE_URL", "").strip()
pytestmark = pytest.mark.skipif(not POSTGRES_URL, reason="Requires disposable local PostgreSQL")


@pytest.mark.parametrize("scenario", ["same_destination", "duplicate", "reciprocal", "diverging_duplicate"])
def test_simultaneous_transfers_preserve_accounts_and_audit(scenario, monkeypatch):
    assert make_url(POSTGRES_URL).host in {"localhost", "127.0.0.1"}, "Only disposable local PostgreSQL is allowed"
    engine = create_engine(POSTGRES_URL, pool_size=4, max_overflow=0)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, class_=TenantSession, expire_on_commit=False)
    tenant = 880000 + (uuid.uuid4().int % 1000000000)
    database_conflicts = []

    @event.listens_for(engine, "handle_error")
    def record_conflict(context):
        code = getattr(context.original_exception, "pgcode", None)
        if code in {"40P01", "40001"}:
            database_conflicts.append(code)
    actor = "actor-" + uuid.uuid4().hex
    token = current_restaurante_id.set(tenant)
    try:
        with Session(restaurante_id=tenant) as db:
            db.add(Restaurante(id=tenant, nome="Synthetic concurrency", plano="bistro"))
            db.flush()
            db.add(Usuario(id=actor, restaurante_id=tenant, nome="Synthetic operator",
                           email=actor + "@example.test", role="caixa", status="ativo"))
            db.add_all([Mesa(id=i, restaurante_id=tenant, capacidade=4, nome=f"Mesa {i}") for i in (1, 2, 3)])
            db.flush()
            command_ids = []
            for table in (1, 2):
                command = Comanda(id="cmd-" + uuid.uuid4().hex, restaurante_id=tenant,
                                  mesa_id=table, garcom_id=actor, tipo="Consumo no Local",
                                  numero_pedido=table, fechada=False,
                                  criado_em=datetime.datetime.now(datetime.timezone.utc))
                db.add(command)
                db.flush()
                service.ensure_atendimento_for_comanda(db, command, actor_id=actor)
                command_ids.append(command.id)
            db.commit()
    finally:
        current_restaurante_id.reset(token)

    # Both workers must enter their first lock attempt. With the old
    # destination-first order, reciprocal moves reliably deadlock. With a
    # shared order, the second worker waits and both return legitimate 409.
    entered = [threading.Event(), threading.Event()]
    local = threading.local()
    original_lock = service.lock_table_for_service

    def observed_lock(*args, **kwargs):
        first = not getattr(local, "entered", False)
        if first:
            local.entered = True
            entered[local.worker].set()
        result = original_lock(*args, **kwargs)
        if first:
            assert entered[1 - local.worker].wait(timeout=10)
        return result

    monkeypatch.setattr(service, "lock_table_for_service", observed_lock)
    pairs = [(command_ids[0], 3), (command_ids[1], 3)]
    if scenario == "duplicate":
        pairs = [(command_ids[0], 3), (command_ids[0], 3)]
    elif scenario == "reciprocal":
        pairs = [(command_ids[0], 2), (command_ids[1], 1)]
    elif scenario == "diverging_duplicate":
        pairs = [(command_ids[0], 3), (command_ids[0], 2)]
    ready = threading.Barrier(2)

    def move(index):
        local.worker = index
        token = current_restaurante_id.set(tenant)
        try:
            with Session(restaurante_id=tenant) as db:
                db.execute(text("SET statement_timeout='10s'"))
                user = db.query(Usuario).filter(Usuario.id == actor).one()
                ready.wait(timeout=10)
                try:
                    transferir_atendimento_compativel(*pairs[index], BackgroundTasks(), db, user)
                    return 200
                except HTTPException as exc:
                    return exc.status_code
        finally:
            current_restaurante_id.reset(token)

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = sorted(pool.map(move, (0, 1)))
        expected = {"same_destination": [200, 409], "duplicate": [200, 200],
                    "reciprocal": [409, 409], "diverging_duplicate": [200, 409]}
        assert outcomes == expected[scenario]
        assert not database_conflicts, "Ordered locks must prevent, not merely translate, reciprocal deadlocks"
        with Session(restaurante_id=tenant) as db:
            tables = [command.mesa_id for command in db.query(Comanda).filter(
                Comanda.restaurante_id == tenant).order_by(Comanda.numero_pedido).all()]
            movements = db.query(MovimentoAtendimento).filter(
                MovimentoAtendimento.restaurante_id == tenant,
                MovimentoAtendimento.tipo == "transferencia").count()
            if scenario == "reciprocal":
                assert tables == [1, 2]
                assert movements == 0
            else:
                assert tables.count(3) == 1
                assert movements == 1
    finally:
        # The entire database/container is disposable; do not imitate this
        # fixture against a live database or alter real tenant records.
        engine.dispose()

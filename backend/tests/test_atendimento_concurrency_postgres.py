from __future__ import annotations

import datetime
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import TenantSession, current_restaurante_id
from app.models import Comanda, Mesa, Restaurante, Usuario
from app.security import get_password_hash
from app.operational_models import (
    AtendimentoComanda,
    AtendimentoMesa,
    MovimentoAtendimento,
    NumeradorOperacional,
)
from app.services.atendimentos import (
    allocate_account_number,
    ensure_atendimento_for_comanda,
    lock_table_for_service,
)


POSTGRES_URL = os.getenv("KOMA_CONCURRENCY_DATABASE_URL", "").strip()


@pytest.mark.skipif(not POSTGRES_URL, reason="PostgreSQL concorrente não configurado")
def test_two_simultaneous_table_openings_converge_to_one_command_and_account():
    engine = create_engine(POSTGRES_URL, pool_size=4, max_overflow=0, pool_pre_ping=True)
    Session = sessionmaker(class_=TenantSession, bind=engine, autocommit=False, autoflush=False)

    tenant_id = 880000 + (uuid.uuid4().int % 10000)
    user_id = f"usr-race-{tenant_id}"
    table_id = 91
    seed = Session(restaurante_id=tenant_id)
    try:
        seed.add(Restaurante(id=tenant_id, nome="Concorrência H3O", plano="bistro"))
        seed.flush()
        seed.add(
            Usuario(
                id=user_id,
                restaurante_id=tenant_id,
                nome="Operador H3O",
                email=f"race-{tenant_id}@koma.test",
                role="caixa",
                status="ativo",
                senha_hash=get_password_hash("local-race-test-password"),
            )
        )
        seed.add(Mesa(id=table_id, restaurante_id=tenant_id, capacidade=4, nome="Mesa 91"))
        seed.commit()
    finally:
        seed.close()

    ready = threading.Barrier(2)

    def open_or_reuse(command_suffix: str) -> str:
        token = current_restaurante_id.set(tenant_id)
        db = Session(restaurante_id=tenant_id)
        try:
            ready.wait(timeout=10)
            lock_table_for_service(db, tenant_id, table_id)
            existing = (
                db.query(Comanda)
                .filter(
                    Comanda.restaurante_id == tenant_id,
                    Comanda.mesa_id == table_id,
                    Comanda.fechada == False,
                    Comanda.tipo == "Consumo no Local",
                )
                .order_by(Comanda.criado_em.asc(), Comanda.id.asc())
                .first()
            )
            if existing is None:
                order_number, _period = allocate_account_number(db, tenant_id)
                existing = Comanda(
                    id=f"c-race-{command_suffix}-{uuid.uuid4().hex[:6]}",
                    restaurante_id=tenant_id,
                    mesa_id=table_id,
                    garcom_id=user_id,
                    tipo="Consumo no Local",
                    numero_pedido=order_number,
                    fechada=False,
                    criado_em=datetime.datetime.now(datetime.timezone.utc),
                )
                db.add(existing)
                db.flush()
            ensure_atendimento_for_comanda(db, existing, actor_id=user_id)
            command_id = existing.id
            db.commit()
            return command_id
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()
            current_restaurante_id.reset(token)

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            command_ids = list(executor.map(open_or_reuse, ("a", "b")))

        assert len(set(command_ids)) == 1
        verify = Session(restaurante_id=tenant_id)
        try:
            assert verify.query(Comanda).filter(
                Comanda.restaurante_id == tenant_id,
                Comanda.mesa_id == table_id,
                Comanda.fechada == False,
            ).count() == 1
            assert verify.query(AtendimentoMesa).filter(
                AtendimentoMesa.restaurante_id == tenant_id,
                AtendimentoMesa.mesa_id == table_id,
                AtendimentoMesa.status == "aberto",
            ).count() == 1
            assert verify.query(AtendimentoComanda).filter(
                AtendimentoComanda.restaurante_id == tenant_id,
            ).count() == 1
        finally:
            verify.close()
    finally:
        cleanup = Session(restaurante_id=tenant_id)
        try:
            cleanup.query(AtendimentoComanda).filter(
                AtendimentoComanda.restaurante_id == tenant_id
            ).delete()
            cleanup.query(MovimentoAtendimento).filter(
                MovimentoAtendimento.restaurante_id == tenant_id
            ).delete()
            cleanup.query(AtendimentoMesa).filter(
                AtendimentoMesa.restaurante_id == tenant_id
            ).delete()
            cleanup.query(Comanda).filter(Comanda.restaurante_id == tenant_id).delete()
            cleanup.query(NumeradorOperacional).filter(
                NumeradorOperacional.restaurante_id == tenant_id
            ).delete()
            cleanup.query(Mesa).filter(Mesa.restaurante_id == tenant_id).delete()
            cleanup.query(Usuario).filter(Usuario.restaurante_id == tenant_id).delete()
            cleanup.query(Restaurante).filter(Restaurante.id == tenant_id).delete()
            cleanup.commit()
        finally:
            cleanup.close()
            engine.dispose()

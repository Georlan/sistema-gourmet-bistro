from __future__ import annotations

import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import TenantSession, current_restaurante_id
from app.fiscal_models import FiscalSequence
from app.models import Restaurante
from app.services.fiscal_documents import reserve_fiscal_number


POSTGRES_URL = os.getenv("KOMA_CONCURRENCY_DATABASE_URL", "").strip()


@pytest.mark.skipif(not POSTGRES_URL, reason="PostgreSQL concorrente não configurado")
def test_two_simultaneous_nfce_number_reservations_are_unique_and_monotonic():
    engine = create_engine(POSTGRES_URL, pool_size=4, max_overflow=0, pool_pre_ping=True)
    Session = sessionmaker(class_=TenantSession, bind=engine, autocommit=False, autoflush=False)
    tenant_id = 940000 + (uuid.uuid4().int % 50000)

    seed = Session(restaurante_id=tenant_id)
    token = current_restaurante_id.set(tenant_id)
    try:
        seed.add(Restaurante(id=tenant_id, nome="Fiscal Sequence Race", plano="pocket"))
        seed.commit()
    finally:
        seed.close()
        current_restaurante_id.reset(token)

    ready = threading.Barrier(2)

    def reserve() -> int:
        context_token = current_restaurante_id.set(tenant_id)
        db = Session(restaurante_id=tenant_id)
        try:
            ready.wait(timeout=10)
            number = reserve_fiscal_number(
                db,
                restaurante_id=tenant_id,
                environment="homologacao",
                model="65",
                series=1,
            )
            db.commit()
            return number
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()
            current_restaurante_id.reset(context_token)

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            numbers = list(executor.map(lambda _index: reserve(), range(2)))

        assert sorted(numbers) == [1, 2]
        verify_token = current_restaurante_id.set(tenant_id)
        verify = Session(restaurante_id=tenant_id)
        try:
            sequence = verify.query(FiscalSequence).filter(
                FiscalSequence.restaurante_id == tenant_id,
                FiscalSequence.environment == "homologacao",
                FiscalSequence.model == "65",
                FiscalSequence.series == 1,
            ).one()
            assert sequence.next_number == 3
            assert sequence.version == 2
        finally:
            verify.close()
            current_restaurante_id.reset(verify_token)
    finally:
        cleanup_token = current_restaurante_id.set(tenant_id)
        cleanup = Session(restaurante_id=tenant_id)
        try:
            cleanup.query(FiscalSequence).filter(
                FiscalSequence.restaurante_id == tenant_id
            ).delete()
            cleanup.query(Restaurante).filter(Restaurante.id == tenant_id).delete()
            cleanup.commit()
        finally:
            cleanup.close()
            current_restaurante_id.reset(cleanup_token)
            engine.dispose()

"""Regressão de concorrência: criação idempotente do OnlineOrderControl sem 500."""

from __future__ import annotations

import concurrent.futures
from app.database import SessionLocal, engine
from app.models import Base, Restaurante
from app.online_order_control_models import OnlineOrderControl
from app.services.online_order_control import get_or_create_control, operational_status


def test_concurrent_get_or_create_control_is_idempotent():
    Base.metadata.create_all(bind=engine)
    rid = 998877

    # Garantir que o restaurante fictício existe e não tem controle prévio
    db = SessionLocal()
    try:
        existing_rest = db.query(Restaurante).filter(Restaurante.id == rid).first()
        if not existing_rest:
            rest = Restaurante(id=rid, nome="Restaurante Concorrência Teste", slug=f"rest-teste-{rid}")
            db.add(rest)
            db.commit()
        db.query(OnlineOrderControl).filter(OnlineOrderControl.restaurante_id == rid).delete()
        db.commit()
    finally:
        db.close()

    errors: list[Exception] = []
    results: list[int] = []

    def worker():
        session = SessionLocal()
        try:
            ctrl = get_or_create_control(session, rid)
            session.commit()
            results.append(ctrl.restaurante_id)
        except Exception as exc:
            errors.append(exc)
            session.rollback()
        finally:
            session.close()

    # Disparar 10 workers simultâneos tentando inicializar o mesmo tenant
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(worker) for _ in range(10)]
        concurrent.futures.wait(futures)

    assert not errors, f"Erros inesperados durante concorrência: {errors}"
    assert len(results) == 10

    # Verificar que existe exatamente 1 linha no banco
    db = SessionLocal()
    try:
        count = db.query(OnlineOrderControl).filter(OnlineOrderControl.restaurante_id == rid).count()
        assert count == 1, f"Esperado exatamente 1 registro, encontrado {count}"
        status = operational_status(db, rid)
        assert status["level"] == "normal"
    finally:
        db.close()

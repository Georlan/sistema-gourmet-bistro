import datetime
from decimal import Decimal

import pytest

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.models import CaixaTurno, Mesa, Restaurante, Usuario
from app.routes.smartpos_provider import _load_pending_provider_intents
from app.smartpos_models import SmartPosPaymentIntent


RID = 9840
OTHER_RID = 9841
USER_ID = "smartpos-queue-user"
OTHER_USER_ID = "smartpos-queue-other"


def _ensure_tenant(db, restaurante_id: int, user_id: str, mesa_id: int):
    if db.query(Restaurante).filter(Restaurante.id == restaurante_id).first() is None:
        db.add(Restaurante(id=restaurante_id, nome=f"Queue {restaurante_id}", plano="pocket"))
        db.flush()
    if db.query(Usuario).filter(Usuario.id == user_id).first() is None:
        db.add(Usuario(
            id=user_id,
            nome=f"Operador {restaurante_id}",
            email=f"queue-{restaurante_id}@koma.test",
            senha_hash="$2b$12$dummyqueuehash",
            role="caixa",
            status="ativo",
            restaurante_id=restaurante_id,
        ))
        db.flush()
    if db.query(Mesa).filter(Mesa.restaurante_id == restaurante_id, Mesa.id == mesa_id).first() is None:
        db.add(Mesa(id=mesa_id, restaurante_id=restaurante_id, capacidade=4, nome=f"Mesa {mesa_id}"))
        db.flush()
    turno = CaixaTurno(
        restaurante_id=restaurante_id,
        aberto_por_id=user_id,
        saldo_inicial=0,
        status="aberto",
    )
    db.add(turno)
    db.flush()
    return turno


def _intent(db, *, rid: int, turno_id: int, mesa_id: int, user_id: str, key: str,
            capture: str = "provider_integrado", status: str = "criada",
            provider: str | None = None, terminal: str | None = None):
    intent = SmartPosPaymentIntent(
        restaurante_id=rid,
        turno_id=turno_id,
        mesa_id=mesa_id,
        operador_id=user_id,
        valor=Decimal("21.50"),
        metodo="credito",
        captura=capture,
        escopo="valor",
        idempotency_key=key,
        status=status,
        provider_name=provider,
        provider_terminal_id=terminal,
        origem="smartpos",
    )
    db.add(intent)
    db.flush()
    return intent


@pytest.fixture(autouse=True)
def setup_queue_db():
    Base.metadata.create_all(bind=engine)
    token = current_restaurante_id.set(RID)
    db = SessionLocal()
    try:
        db.query(SmartPosPaymentIntent).filter(
            SmartPosPaymentIntent.restaurante_id.in_([RID, OTHER_RID])
        ).delete(synchronize_session=False)
        db.query(CaixaTurno).filter(CaixaTurno.restaurante_id.in_([RID, OTHER_RID])).delete(synchronize_session=False)
        db.commit()
        yield
    finally:
        db.rollback()
        db.close()
        current_restaurante_id.reset(token)


def test_queue_returns_only_active_integrated_intents_available_to_terminal():
    db = SessionLocal()
    try:
        turno = _ensure_tenant(db, RID, USER_ID, 84)
        visible_new = _intent(
            db, rid=RID, turno_id=turno.id, mesa_id=84, user_id=USER_ID,
            key="queue-visible-new",
        )
        visible_reconcile = _intent(
            db, rid=RID, turno_id=turno.id, mesa_id=84, user_id=USER_ID,
            key="queue-visible-reconcile", status="processando", provider="pagbank", terminal="POS-A",
        )
        _intent(
            db, rid=RID, turno_id=turno.id, mesa_id=84, user_id=USER_ID,
            key="queue-other-terminal", status="processando", provider="pagbank", terminal="POS-B",
        )
        _intent(
            db, rid=RID, turno_id=turno.id, mesa_id=84, user_id=USER_ID,
            key="queue-manual", capture="registro_externo", status="pendente",
        )
        _intent(
            db, rid=RID, turno_id=turno.id, mesa_id=84, user_id=USER_ID,
            key="queue-approved", status="aprovada", provider="pagbank", terminal="POS-A",
        )
        expired_unstarted = _intent(
            db, rid=RID, turno_id=turno.id, mesa_id=84, user_id=USER_ID,
            key="queue-expired-unstarted",
        )
        expired_unstarted.expira_em = datetime.datetime.now(
            datetime.timezone.utc
        ) - datetime.timedelta(seconds=1)
        db.commit()

        rows = _load_pending_provider_intents(
            db,
            restaurante_id=RID,
            provider="pagbank",
            terminal_id="POS-A",
        )
        ids = {row.id for row in rows}
        assert ids == {visible_new.id, visible_reconcile.id}
        db.refresh(expired_unstarted)
        assert expired_unstarted.status == "criada"
    finally:
        db.close()


def test_queue_has_explicit_tenant_boundary():
    db = SessionLocal()
    try:
        own_turno = _ensure_tenant(db, RID, USER_ID, 85)
        own = _intent(
            db, rid=RID, turno_id=own_turno.id, mesa_id=85, user_id=USER_ID,
            key="queue-own-tenant",
        )
        db.commit()

        other_token = current_restaurante_id.set(OTHER_RID)
        try:
            other_turno = _ensure_tenant(db, OTHER_RID, OTHER_USER_ID, 86)
            _intent(
                db, rid=OTHER_RID, turno_id=other_turno.id, mesa_id=86, user_id=OTHER_USER_ID,
                key="queue-other-tenant",
            )
            db.commit()
        finally:
            current_restaurante_id.reset(other_token)

        rows = _load_pending_provider_intents(
            db,
            restaurante_id=RID,
            provider="pagbank",
            terminal_id="POS-A",
        )
        assert [row.id for row in rows] == [own.id]
        assert all(row.restaurante_id == RID for row in rows)
    finally:
        db.close()

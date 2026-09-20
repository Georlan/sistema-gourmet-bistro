import datetime

import pytest

from app.application.printing import PrintingApplicationService
from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.models import (
    CaixaTurno,
    Comanda,
    IntegrationOutbox,
    Lancamento,
    Restaurante,
    Usuario,
)
from app.online_order_control_models import (
    OnlineOrderControl,
    OnlineOrderOperationalAudit,
)
from app.scheduled_models import ScheduledOrder
from app.services.online_order_auto_accept import (
    auto_accept_pending_online_orders_in_session,
    try_auto_accept_online_order_in_session,
)


RID = 8892
USER_ID = "online-autoaccept-admin-8892"


@pytest.fixture(autouse=True)
def setup_autoaccept_db():
    Base.metadata.create_all(bind=engine)
    token = current_restaurante_id.set(RID)
    db = SessionLocal()
    try:
        for model in (
            ScheduledOrder,
            IntegrationOutbox,
            Lancamento,
            Comanda,
            CaixaTurno,
            OnlineOrderOperationalAudit,
            OnlineOrderControl,
            Usuario,
        ):
            db.query(model).filter(model.restaurante_id == RID).delete(
                synchronize_session=False
            )
        db.query(Restaurante).filter(Restaurante.id == RID).delete(
            synchronize_session=False
        )
        db.commit()

        db.add(Restaurante(id=RID, nome="KOMA Autoaccept", plano="pro"))
        db.add(
            Usuario(
                id=USER_ID,
                restaurante_id=RID,
                nome="Operador Autoaccept",
                email="autoaccept@koma.test",
                cargo="admin",
                role="admin",
                status="ativo",
            )
        )
        db.commit()
        yield
    finally:
        db.rollback()
        db.close()
        current_restaurante_id.reset(token)


def _seed_order(
    db,
    *,
    suffix: str,
    tipo: str = "Retirada",
    origem: str = "cardapio",
    payment_status: str | None = None,
    open_shift: bool = True,
    auto_accept: bool = True,
):
    control = db.query(OnlineOrderControl).filter(
        OnlineOrderControl.restaurante_id == RID
    ).first()
    if control is None:
        control = OnlineOrderControl(
            restaurante_id=RID,
            auto_accept=auto_accept,
            auto_pause=False,
            paused=False,
        )
        db.add(control)
    else:
        control.auto_accept = auto_accept

    if open_shift and not db.query(CaixaTurno).filter(
        CaixaTurno.restaurante_id == RID,
        CaixaTurno.status == "aberto",
    ).first():
        db.add(
            CaixaTurno(
                restaurante_id=RID,
                aberto_por_id=USER_ID,
                saldo_inicial=0,
                status="aberto",
            )
        )

    comanda = Comanda(
        id=f"auto-{suffix}",
        restaurante_id=RID,
        garcom_id=USER_ID,
        numero_pedido=100 + len(suffix),
        tipo=tipo,
        identificador="Cliente Auto",
        delivery_status="pendente",
        online_payment_status=payment_status,
        fechada=False,
    )
    launch = Lancamento(
        id=f"launch-auto-{suffix}",
        restaurante_id=RID,
        comanda_id=comanda.id,
        garcom_id=USER_ID,
        origem=origem,
        status="pendente",
        timestamp=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add_all([comanda, launch])
    db.commit()
    return comanda, launch


@pytest.mark.parametrize("tipo", ["Retirada", "Delivery", "Consumo no Local"])
def test_server_autoaccept_accepts_all_online_fulfillments(tipo, monkeypatch):
    db = SessionLocal()
    try:
        comanda, launch = _seed_order(
            db,
            suffix=tipo.lower().replace(" ", "-"),
            tipo=tipo,
        )
        printed = []
        monkeypatch.setattr(
            PrintingApplicationService,
            "request_print",
            lambda db_session, intent: printed.append(intent) or [],
        )

        changed = try_auto_accept_online_order_in_session(
            db,
            restaurante_id=RID,
            comanda_id=comanda.id,
            operator_user_id=USER_ID,
        )
        db.commit()
        db.refresh(comanda)
        db.refresh(launch)

        assert changed is True
        assert comanda.delivery_status == "producao"
        assert launch.status == "producao"
        assert len(printed) == 1
        assert printed[0].source_id == comanda.id
        assert printed[0].idempotency_key == f"aceite:pedido:{comanda.id}:producao"
    finally:
        db.close()


def test_server_autoaccept_never_accepts_non_online_origin(monkeypatch):
    db = SessionLocal()
    try:
        comanda, launch = _seed_order(db, suffix="pos", origem="caixa")
        printed = []
        monkeypatch.setattr(
            PrintingApplicationService,
            "request_print",
            lambda db_session, intent: printed.append(intent) or [],
        )

        changed = try_auto_accept_online_order_in_session(
            db,
            restaurante_id=RID,
            comanda_id=comanda.id,
        )
        db.commit()
        db.refresh(comanda)
        db.refresh(launch)

        assert changed is False
        assert comanda.delivery_status == "pendente"
        assert launch.status == "pendente"
        assert printed == []
    finally:
        db.close()


@pytest.mark.parametrize("payment_status", ["pending", "created", "error"])
def test_server_autoaccept_waits_for_online_payment(payment_status, monkeypatch):
    db = SessionLocal()
    try:
        comanda, _ = _seed_order(
            db,
            suffix=f"payment-{payment_status}",
            payment_status=payment_status,
        )
        monkeypatch.setattr(
            PrintingApplicationService,
            "request_print",
            lambda db_session, intent: pytest.fail("não deveria imprimir"),
        )

        assert try_auto_accept_online_order_in_session(
            db,
            restaurante_id=RID,
            comanda_id=comanda.id,
        ) is False
        assert comanda.delivery_status == "pendente"
    finally:
        db.close()


def test_server_autoaccept_waits_for_open_shift(monkeypatch):
    db = SessionLocal()
    try:
        comanda, _ = _seed_order(db, suffix="closed-shift", open_shift=False)
        monkeypatch.setattr(
            PrintingApplicationService,
            "request_print",
            lambda db_session, intent: pytest.fail("não deveria imprimir"),
        )

        assert try_auto_accept_online_order_in_session(
            db,
            restaurante_id=RID,
            comanda_id=comanda.id,
        ) is False
        assert comanda.delivery_status == "pendente"
    finally:
        db.close()


def test_server_autoaccept_waits_for_scheduled_release(monkeypatch):
    db = SessionLocal()
    try:
        comanda, _ = _seed_order(db, suffix="scheduled")
        db.add(
            ScheduledOrder(
                restaurante_id=RID,
                comanda_id=comanda.id,
                scheduled_for=datetime.datetime.now(datetime.timezone.utc)
                + datetime.timedelta(hours=2),
                released_at=None,
            )
        )
        db.commit()
        monkeypatch.setattr(
            PrintingApplicationService,
            "request_print",
            lambda db_session, intent: pytest.fail("não deveria imprimir"),
        )

        assert try_auto_accept_online_order_in_session(
            db,
            restaurante_id=RID,
            comanda_id=comanda.id,
        ) is False
        assert comanda.delivery_status == "pendente"
    finally:
        db.close()


def test_backlog_accepts_only_eligible_online_orders(monkeypatch):
    db = SessionLocal()
    try:
        online, _ = _seed_order(db, suffix="backlog-online")
        manual, _ = _seed_order(db, suffix="backlog-manual", origem="caixa")
        unpaid, _ = _seed_order(
            db,
            suffix="backlog-unpaid",
            payment_status="pending",
        )
        monkeypatch.setattr(
            PrintingApplicationService,
            "request_print",
            lambda db_session, intent: [],
        )

        accepted = auto_accept_pending_online_orders_in_session(
            db,
            restaurante_id=RID,
            operator_user_id=USER_ID,
        )
        db.commit()
        db.refresh(online)
        db.refresh(manual)
        db.refresh(unpaid)

        assert accepted == [online.id]
        assert online.delivery_status == "producao"
        assert manual.delivery_status == "pendente"
        assert unpaid.delivery_status == "pendente"
    finally:
        db.close()

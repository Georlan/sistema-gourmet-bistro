"""Aceite automático persistente para pedidos originados em canais online."""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from ..application.orders.lifecycle import OrderLifecycleCoordinator
from ..application.printing import (
    PrintAction,
    PrintIntent,
    PrintSourceType,
    PrintTrigger,
    PrintingApplicationService,
    UniversalPrintingError,
)
from ..domain.orders.types import OrderStatus, normalize_to_order_status
from ..models import CaixaTurno, Comanda, Lancamento, Usuario
from ..online_order_control_models import OnlineOrderControl
from ..scheduled_models import ScheduledOrder


logger = logging.getLogger("koma.online_order_auto_accept")


def _is_online_order(db: Session, restaurante_id: int, comanda_id: str) -> bool:
    return (
        db.query(Lancamento.id)
        .filter(
            Lancamento.restaurante_id == restaurante_id,
            Lancamento.comanda_id == comanda_id,
            Lancamento.origem == "cardapio",
        )
        .first()
        is not None
    )


def _has_unreleased_schedule(db: Session, restaurante_id: int, comanda_id: str) -> bool:
    return (
        db.query(ScheduledOrder.id)
        .filter(
            ScheduledOrder.restaurante_id == restaurante_id,
            ScheduledOrder.comanda_id == comanda_id,
            ScheduledOrder.released_at.is_(None),
        )
        .first()
        is not None
    )


def auto_accept_order_if_enabled(
    db: Session,
    *,
    restaurante_id: int,
    comanda_id: str,
    commit: bool = False,
) -> bool:
    """Aceita um pedido online pendente quando a política do tenant está ativa.

    A função é deliberadamente fail-safe: ausência de turno, Pix ainda pendente,
    agendamento futuro ou corrida com outro aceitador deixam o pedido pendente.
    Uma falha de impressão não desfaz o aceite, replicando a semântica manual.
    """

    control = (
        db.query(OnlineOrderControl)
        .filter(OnlineOrderControl.restaurante_id == restaurante_id)
        .first()
    )
    if control is None or not bool(control.auto_accept):
        return False

    comanda = (
        db.query(Comanda)
        .filter(
            Comanda.restaurante_id == restaurante_id,
            Comanda.id == str(comanda_id),
            Comanda.fechada.is_(False),
        )
        .first()
    )
    if comanda is None:
        return False
    if normalize_to_order_status(comanda.delivery_status) != OrderStatus.PENDING:
        return False
    if comanda.online_payment_status not in {None, "approved"}:
        return False
    if _has_unreleased_schedule(db, restaurante_id, comanda.id):
        return False
    if not _is_online_order(db, restaurante_id, comanda.id):
        return False

    shift_exists = (
        db.query(CaixaTurno.id)
        .filter(
            CaixaTurno.restaurante_id == restaurante_id,
            CaixaTurno.status == "aberto",
        )
        .first()
        is not None
    )
    if not shift_exists:
        logger.info(
            "Autoaceite adiado para pedido %s: caixa fechado.",
            comanda.id,
        )
        return False

    operator_id = comanda.garcom_id
    operator_name = "AUTOACEITE"
    if operator_id:
        operator = (
            db.query(Usuario)
            .filter(
                Usuario.restaurante_id == restaurante_id,
                Usuario.id == operator_id,
            )
            .first()
        )
        if operator is not None and str(operator.nome or "").strip():
            operator_name = str(operator.nome).strip()

    try:
        with db.begin_nested():
            transition = OrderLifecycleCoordinator.transition_check_status(
                db,
                restaurant_id=restaurante_id,
                comanda_id=comanda.id,
                target_status=OrderStatus.PREPARING,
                operator_user_id=operator_id,
                commit=False,
            )
            if not transition.changed:
                return False

            if transition.first_accept:
                try:
                    PrintingApplicationService.request_print(
                        db,
                        PrintIntent(
                            restaurant_id=restaurante_id,
                            source_type=PrintSourceType.ORDER,
                            source_id=comanda.id,
                            action=PrintAction.PRINT,
                            trigger=PrintTrigger.AUTOMATIC,
                            requested_by=operator_name,
                            idempotency_key=f"aceite:pedido:{comanda.id}:producao",
                        ),
                    )
                except UniversalPrintingError as exc:
                    logger.warning(
                        "Falha de impressão no autoaceite do pedido %s: %s",
                        comanda.id,
                        exc,
                    )
        if commit:
            db.commit()
        return True
    except Exception:
        logger.exception("Autoaceite falhou para pedido %s; mantendo pendente.", comanda.id)
        return False


def auto_accept_pending_orders(
    db: Session,
    *,
    restaurante_id: int,
) -> int:
    """Aplica a política recém-ligada aos pedidos online pendentes já liberados."""

    pending_ids = [
        row[0]
        for row in (
            db.query(Comanda.id)
            .join(
                Lancamento,
                (Lancamento.restaurante_id == Comanda.restaurante_id)
                & (Lancamento.comanda_id == Comanda.id),
            )
            .filter(
                Comanda.restaurante_id == restaurante_id,
                Comanda.fechada.is_(False),
                Comanda.delivery_status == "pendente",
                Lancamento.origem == "cardapio",
            )
            .distinct()
            .all()
        )
    ]
    accepted = 0
    for comanda_id in pending_ids:
        if auto_accept_order_if_enabled(
            db,
            restaurante_id=restaurante_id,
            comanda_id=str(comanda_id),
            commit=True,
        ):
            accepted += 1
    return accepted

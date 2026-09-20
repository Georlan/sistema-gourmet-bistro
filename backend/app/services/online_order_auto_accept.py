"""Autoaceite server-side de pedidos originados no Cardápio Online.

A política pertence ao restaurante e continua ativa sem navegador aberto. Este
módulo só aceita pedidos já liberados para a operação: sem agendamento futuro,
sem Pix pendente e com turno de caixa aberto.
"""

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
from ..models import CaixaTurno, Comanda, Lancamento
from ..online_order_control_models import OnlineOrderControl
from ..scheduled_models import ScheduledOrder


logger = logging.getLogger("koma.services.online_order_auto_accept")


def _auto_accept_enabled(db: Session, restaurante_id: int) -> bool:
    control = db.query(OnlineOrderControl).filter(
        OnlineOrderControl.restaurante_id == restaurante_id,
    ).first()
    return bool(control and control.auto_accept)


def _has_open_shift(db: Session, restaurante_id: int) -> bool:
    return (
        db.query(CaixaTurno.id)
        .filter(
            CaixaTurno.restaurante_id == restaurante_id,
            CaixaTurno.status == "aberto",
        )
        .first()
        is not None
    )


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


def _has_unreleased_schedule(
    db: Session,
    restaurante_id: int,
    comanda_id: str,
) -> bool:
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


def try_auto_accept_online_order_in_session(
    db: Session,
    *,
    restaurante_id: int,
    comanda_id: str,
    operator_user_id: str | int | None = None,
    requested_by: str = "Autoaceite online",
) -> bool:
    """Aceita um pedido elegível sem assumir ownership do commit externo."""
    if not _auto_accept_enabled(db, restaurante_id):
        return False
    if not _has_open_shift(db, restaurante_id):
        return False

    comanda = (
        db.query(Comanda)
        .filter(
            Comanda.restaurante_id == restaurante_id,
            Comanda.id == str(comanda_id),
            Comanda.fechada.is_(False),
        )
        .with_for_update()
        .first()
    )
    if comanda is None:
        return False
    if str(comanda.delivery_status or "").strip().casefold() != "pendente":
        return False
    if str(comanda.online_payment_status or "").strip().casefold() not in {"", "approved"}:
        return False
    if not _is_online_order(db, restaurante_id, comanda.id):
        return False
    if _has_unreleased_schedule(db, restaurante_id, comanda.id):
        return False

    actor_id = operator_user_id or comanda.garcom_id
    transition = OrderLifecycleCoordinator.transition_check_status(
        db,
        restaurant_id=restaurante_id,
        comanda_id=comanda.id,
        target_status="producao",
        operator_user_id=actor_id,
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
                    requested_by=requested_by,
                    idempotency_key=f"aceite:pedido:{comanda.id}:producao",
                ),
            )
        except UniversalPrintingError as exc:
            # A impressão é projeção operacional: a aceitação canônica não regride.
            logger.warning(
                "Falha de impressão no autoaceite do pedido %s: %s",
                comanda.id,
                exc,
            )

    db.flush()
    return True


def auto_accept_pending_online_orders_in_session(
    db: Session,
    *,
    restaurante_id: int,
    operator_user_id: str | int | None = None,
    requested_by: str = "Autoaceite online",
    limit: int = 100,
) -> list[str]:
    """Processa backlog elegível ao habilitar a política ou abrir a operação."""
    if not _auto_accept_enabled(db, restaurante_id):
        return []
    if not _has_open_shift(db, restaurante_id):
        return []

    candidate_ids = [
        str(row[0])
        for row in (
            db.query(Comanda.id)
            .join(
                Lancamento,
                (Lancamento.comanda_id == Comanda.id)
                & (Lancamento.restaurante_id == Comanda.restaurante_id),
            )
            .filter(
                Comanda.restaurante_id == restaurante_id,
                Comanda.fechada.is_(False),
                Comanda.delivery_status == "pendente",
                Lancamento.origem == "cardapio",
            )
            .distinct()
            .order_by(Comanda.criado_em.asc(), Comanda.id.asc())
            .limit(max(1, min(int(limit or 100), 500)))
            .all()
        )
    ]

    accepted: list[str] = []
    for comanda_id in candidate_ids:
        if try_auto_accept_online_order_in_session(
            db,
            restaurante_id=restaurante_id,
            comanda_id=comanda_id,
            operator_user_id=operator_user_id,
            requested_by=requested_by,
        ):
            accepted.append(comanda_id)
    return accepted

"""Regras determinísticas de segurança operacional para pedidos online."""

from __future__ import annotations

import datetime
import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..models import Comanda, Lancamento
from ..online_order_control_models import (
    OnlineOrderControl,
    OnlineOrderCustomerBlock,
    OnlineOrderOperationalAudit,
)
from ..scheduled_models import ScheduledOrder
from .clientes import normalizar_telefone_cliente
from .customer_auth import hash_public_rate_key

# Estados que ainda ocupam a capacidade operacional do restaurante.
# ``transito`` já saiu da cozinha; finalizado/recusado também não contam.
ACTIVE_OPERATIONAL_STATUSES = ("analise", "pendente", "producao", "pronto")

logger = logging.getLogger("koma.online_order_control")


def utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _aware(value: datetime.datetime | None) -> datetime.datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=datetime.timezone.utc)
    return value


def get_or_create_control(
    db: Session,
    restaurante_id: int,
    *,
    for_update: bool = False,
) -> OnlineOrderControl:
    query = db.query(OnlineOrderControl).filter(
        OnlineOrderControl.restaurante_id == restaurante_id,
    )
    if for_update:
        query = query.with_for_update()
    control = query.first()
    if control is None:
        control = OnlineOrderControl(restaurante_id=restaurante_id)
        db.add(control)
        db.flush()
    return control


def is_effectively_paused(
    control: OnlineOrderControl | None,
    *,
    now: datetime.datetime | None = None,
) -> bool:
    if control is None or not bool(control.paused):
        return False
    pause_until = _aware(control.pause_until)
    if pause_until is None:
        return True
    return pause_until > (now or utcnow())


def operational_counts(db: Session, restaurante_id: int) -> dict[str, int]:
    """Conta somente pedidos liberados para operação, não agendados futuros."""
    unreleased_schedule = db.query(ScheduledOrder.id).filter(
        ScheduledOrder.restaurante_id == restaurante_id,
        ScheduledOrder.comanda_id == Comanda.id,
        ScheduledOrder.released_at.is_(None),
    ).exists()
    rows = (
        db.query(Comanda.delivery_status, func.count(Comanda.id))
        .filter(
            Comanda.restaurante_id == restaurante_id,
            Comanda.fechada.is_(False),
            Comanda.delivery_status.in_(ACTIVE_OPERATIONAL_STATUSES),
            or_(
                Comanda.online_payment_status.is_(None),
                Comanda.online_payment_status == "approved",
            ),
            ~unreleased_schedule,
        )
        .group_by(Comanda.delivery_status)
        .all()
    )
    counts = {status: 0 for status in ACTIVE_OPERATIONAL_STATUSES}
    for status_value, quantity in rows:
        if status_value in counts:
            counts[status_value] = int(quantity or 0)
    counts["active"] = sum(counts.values())
    return counts


def operational_status(db: Session, restaurante_id: int) -> dict[str, Any]:
    control = get_or_create_control(db, restaurante_id)
    counts = operational_counts(db, restaurante_id)
    active = counts["active"]
    capacity = int(control.max_active_orders) if control.max_active_orders else None
    ratio = (active / capacity) if capacity else None
    paused = is_effectively_paused(control)

    if paused:
        level = "paused"
    elif ratio is not None and ratio >= 1:
        level = "full"
    elif ratio is not None and ratio >= 0.8:
        level = "high"
    else:
        level = "normal"

    return {
        "paused": paused,
        "pause_reason": control.pause_reason if paused else None,
        "pause_until": control.pause_until.isoformat() if paused and control.pause_until else None,
        "max_active_orders": capacity,
        "auto_pause": bool(control.auto_pause),
        "auto_accept": bool(control.auto_accept),
        "counts": counts,
        "capacity_ratio": round(ratio, 4) if ratio is not None else None,
        "level": level,
    }


def _audit(
    db: Session,
    *,
    restaurante_id: int,
    actor_user_id: str | None,
    action: str,
    reason: str,
    before_data: dict[str, Any] | None,
    after_data: dict[str, Any] | None,
) -> None:
    db.add(
        OnlineOrderOperationalAudit(
            restaurante_id=restaurante_id,
            actor_user_id=actor_user_id,
            action=action,
            reason=reason,
            before_data=before_data,
            after_data=after_data,
        )
    )


def pause_online_orders(
    db: Session,
    *,
    restaurante_id: int,
    actor_user_id: str | None,
    reason: str,
    duration_minutes: int | None,
) -> OnlineOrderControl:
    control = get_or_create_control(db, restaurante_id, for_update=True)
    before = operational_status(db, restaurante_id)
    control.paused = True
    control.pause_reason = reason.strip()
    control.pause_until = (
        utcnow() + datetime.timedelta(minutes=duration_minutes)
        if duration_minutes is not None
        else None
    )
    control.paused_by_user_id = actor_user_id
    control.updated_at = utcnow()
    db.flush()
    after = operational_status(db, restaurante_id)
    _audit(
        db,
        restaurante_id=restaurante_id,
        actor_user_id=actor_user_id,
        action="online_orders_paused",
        reason=reason.strip(),
        before_data=before,
        after_data=after,
    )
    return control


def resume_online_orders(
    db: Session,
    *,
    restaurante_id: int,
    actor_user_id: str | None,
    reason: str,
) -> OnlineOrderControl:
    control = get_or_create_control(db, restaurante_id, for_update=True)
    before = operational_status(db, restaurante_id)
    control.paused = False
    control.pause_reason = None
    control.pause_until = None
    control.paused_by_user_id = None
    control.updated_at = utcnow()
    db.flush()
    after = operational_status(db, restaurante_id)
    _audit(
        db,
        restaurante_id=restaurante_id,
        actor_user_id=actor_user_id,
        action="online_orders_resumed",
        reason=reason.strip() or "Reabertura manual",
        before_data=before,
        after_data=after,
    )
    return control


def update_capacity(
    db: Session,
    *,
    restaurante_id: int,
    actor_user_id: str | None,
    max_active_orders: int | None,
    auto_pause: bool,
) -> OnlineOrderControl:
    control = get_or_create_control(db, restaurante_id, for_update=True)
    before = operational_status(db, restaurante_id)
    control.max_active_orders = max_active_orders
    control.auto_pause = bool(auto_pause)
    control.updated_at = utcnow()
    db.flush()
    after = operational_status(db, restaurante_id)
    _audit(
        db,
        restaurante_id=restaurante_id,
        actor_user_id=actor_user_id,
        action="online_orders_capacity_updated",
        reason="Capacidade operacional atualizada",
        before_data=before,
        after_data=after,
    )
    return control


def update_auto_accept(
    db: Session,
    *,
    restaurante_id: int,
    actor_user_id: str | None,
    enabled: bool,
) -> OnlineOrderControl:
    """Persiste a política de aceite automático no backend por tenant."""
    control = get_or_create_control(db, restaurante_id, for_update=True)
    before = operational_status(db, restaurante_id)
    control.auto_accept = bool(enabled)
    control.updated_at = utcnow()
    db.flush()
    after = operational_status(db, restaurante_id)
    _audit(
        db,
        restaurante_id=restaurante_id,
        actor_user_id=actor_user_id,
        action="online_orders_auto_accept_updated",
        reason=(
            "Aceite automático de pedidos online ativado"
            if enabled
            else "Aceite automático de pedidos online desativado"
        ),
        before_data=before,
        after_data=after,
    )
    return control


def auto_accept_online_order_if_enabled(
    db: Session,
    *,
    restaurante_id: int,
    comanda: Comanda,
    operator_user_id: str | int | None = None,
) -> bool:
    """Aceita no servidor um pedido online elegível quando a política está ativa.

    Pagamentos online só entram após aprovação; pedidos agendados apenas depois
    da liberação. A função não faz commit: o chamador mantém a atomicidade do
    fluxo que publicou o pedido.
    """
    control = db.query(OnlineOrderControl).filter(
        OnlineOrderControl.restaurante_id == restaurante_id,
    ).first()
    if control is None or not bool(control.auto_accept):
        return False
    if comanda.fechada or str(comanda.delivery_status or "").strip().lower() not in {
        "pendente",
        "analise",
    }:
        return False
    payment_status = str(comanda.online_payment_status or "").strip().lower()
    if payment_status and payment_status != "approved":
        return False

    launch = (
        db.query(Lancamento)
        .filter(
            Lancamento.restaurante_id == restaurante_id,
            Lancamento.comanda_id == comanda.id,
        )
        .order_by(Lancamento.timestamp.asc(), Lancamento.id.asc())
        .first()
    )
    if launch is None or str(launch.origem or "").strip().casefold() != "cardapio":
        return False

    unreleased_schedule = db.query(ScheduledOrder.id).filter(
        ScheduledOrder.restaurante_id == restaurante_id,
        ScheduledOrder.comanda_id == comanda.id,
        ScheduledOrder.released_at.is_(None),
    ).first()
    if unreleased_schedule is not None:
        return False

    # A política automática nunca contorna o gate operacional do caixa. Se o
    # turno fechou entre a criação e o aceite, o pedido permanece pendente.
    from fastapi import HTTPException
    from .shifts import require_open_cash_shift

    try:
        require_open_cash_shift(db, restaurante_id)
    except HTTPException:
        logger.warning(
            "Autoaceite ignorado para pedido %s: caixa fechado",
            comanda.id,
        )
        return False

    from ..application.orders.lifecycle import OrderLifecycleCoordinator
    from ..application.printing import (
        PrintAction,
        PrintIntent,
        PrintSourceType,
        PrintTrigger,
        PrintingApplicationService,
        UniversalPrintingError,
    )

    before_status = str(comanda.delivery_status or "pendente")
    transition = OrderLifecycleCoordinator.transition_check_status(
        db,
        restaurant_id=restaurante_id,
        comanda_id=comanda.id,
        target_status="producao",
        operator_user_id=operator_user_id or getattr(comanda, "garcom_id", None),
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
                    requested_by="Autoaceite online",
                    idempotency_key=f"aceite:pedido:{comanda.id}:producao",
                ),
            )
        except UniversalPrintingError as exc:
            logger.warning(
                "Impressão automática falhou no autoaceite do pedido %s: %s",
                comanda.id,
                exc,
            )

    _audit(
        db,
        restaurante_id=restaurante_id,
        actor_user_id=(
            str(operator_user_id)
            if operator_user_id is not None
            else str(getattr(comanda, "garcom_id", "") or "") or None
        ),
        action="online_order_auto_accepted",
        reason="Pedido online aceito automaticamente pela política do restaurante",
        before_data={"comanda_id": comanda.id, "status": before_status},
        after_data={"comanda_id": comanda.id, "status": "producao"},
    )
    db.flush()
    return True


@dataclass(frozen=True)
class CapacityGateResult:
    blocked: bool
    state_changed: bool = False
    reason: str | None = None


def capacity_gate_before_order(
    db: Session,
    *,
    restaurante_id: int,
) -> CapacityGateResult:
    """Serializa a entrada quando auto-pausa está habilitada.

    Com auto-pausa desligada, ``max_active_orders`` é apenas referência/alerta e
    não impede vendas. Com auto-pausa ligada, a linha de controle permanece
    bloqueada até o commit da criação do pedido. Assim duas requisições em 29/30
    não passam simultaneamente: a segunda espera o commit da primeira, enxerga
    30/30 e persiste a pausa antes de ser rejeitada.
    """
    snapshot = db.query(OnlineOrderControl).filter(
        OnlineOrderControl.restaurante_id == restaurante_id,
    ).first()
    if snapshot is None:
        return CapacityGateResult(blocked=False)
    if is_effectively_paused(snapshot):
        return CapacityGateResult(blocked=True, reason="paused")
    if not snapshot.auto_pause or not snapshot.max_active_orders:
        return CapacityGateResult(blocked=False)

    control = (
        db.query(OnlineOrderControl)
        .filter(OnlineOrderControl.restaurante_id == restaurante_id)
        .with_for_update()
        .one()
    )
    if is_effectively_paused(control):
        return CapacityGateResult(blocked=True, reason="paused")

    counts = operational_counts(db, restaurante_id)
    if counts["active"] < int(control.max_active_orders):
        # Não commit aqui: o lock precisa sobreviver até o commit da criação.
        return CapacityGateResult(blocked=False)

    before = operational_status(db, restaurante_id)
    control.paused = True
    control.pause_reason = "Capacidade operacional atingida"
    control.pause_until = None
    control.paused_by_user_id = None
    control.updated_at = utcnow()
    db.flush()
    after = operational_status(db, restaurante_id)
    _audit(
        db,
        restaurante_id=restaurante_id,
        actor_user_id=None,
        action="online_orders_auto_paused",
        reason="Capacidade operacional atingida",
        before_data=before,
        after_data=after,
    )
    return CapacityGateResult(
        blocked=True,
        state_changed=True,
        reason="capacity",
    )


def block_from_order(
    db: Session,
    *,
    restaurante_id: int,
    comanda: Comanda,
    actor_user_id: str | None,
    reason: str,
    duration_hours: int | None,
) -> OnlineOrderCustomerBlock:
    phone_hash = None
    raw_phone = getattr(comanda, "delivery_telefone", None)
    if raw_phone:
        try:
            normalized_phone = normalizar_telefone_cliente(raw_phone)
            phone_hash = hash_public_rate_key(
                restaurante_id,
                "online_order_customer_block",
                normalized_phone,
            )
        except ValueError:
            phone_hash = None

    cliente_id = getattr(comanda, "cliente_id", None)
    if not cliente_id and not phone_hash:
        raise ValueError("O pedido não possui identidade suficiente para bloqueio.")

    expires_at = (
        utcnow() + datetime.timedelta(hours=duration_hours)
        if duration_hours is not None
        else None
    )
    block = OnlineOrderCustomerBlock(
        restaurante_id=restaurante_id,
        cliente_id=cliente_id,
        phone_hash=phone_hash,
        reason=reason.strip(),
        expires_at=expires_at,
        active=True,
        created_by_user_id=actor_user_id,
    )
    db.add(block)
    db.flush()
    _audit(
        db,
        restaurante_id=restaurante_id,
        actor_user_id=actor_user_id,
        action="online_order_customer_blocked",
        reason=reason.strip(),
        before_data=None,
        after_data={
            "block_id": block.id,
            "cliente_id": cliente_id,
            "has_phone_fingerprint": bool(phone_hash),
            "expires_at": expires_at.isoformat() if expires_at else None,
        },
    )
    return block


def release_block(
    db: Session,
    *,
    restaurante_id: int,
    block: OnlineOrderCustomerBlock,
    actor_user_id: str | None,
    reason: str,
) -> None:
    block.active = False
    _audit(
        db,
        restaurante_id=restaurante_id,
        actor_user_id=actor_user_id,
        action="online_order_customer_unblocked",
        reason=reason.strip() or "Bloqueio removido",
        before_data={"block_id": block.id, "active": True},
        after_data={"block_id": block.id, "active": False},
    )


def customer_is_blocked(
    db: Session,
    *,
    restaurante_id: int,
    telefone: str,
    cliente_id: str | None = None,
) -> bool:
    now = utcnow()
    normalized_phone = normalizar_telefone_cliente(telefone)
    phone_hash = hash_public_rate_key(
        restaurante_id,
        "online_order_customer_block",
        normalized_phone,
    )
    query = db.query(OnlineOrderCustomerBlock).filter(
        OnlineOrderCustomerBlock.restaurante_id == restaurante_id,
        OnlineOrderCustomerBlock.active.is_(True),
    )
    identity_filters = [OnlineOrderCustomerBlock.phone_hash == phone_hash]
    if cliente_id:
        identity_filters.append(OnlineOrderCustomerBlock.cliente_id == cliente_id)
    blocks = query.filter(or_(*identity_filters)).all()
    for block in blocks:
        expires_at = _aware(block.expires_at)
        if expires_at is None or expires_at > now:
            return True
    return False

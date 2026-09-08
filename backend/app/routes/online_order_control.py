"""Controle operacional do canal público de pedidos.

A API é interna/autenticada. O Cardápio público apenas consome a política resultante
via ``online_order_policy``; não existe endpoint público para pausar/reabrir loja.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db, require_tenant_id
from ..models import Comanda, Usuario
from ..online_order_control_models import OnlineOrderCustomerBlock
from ..security import require_roles
from ..services.online_order_control import (
    block_from_order,
    operational_status,
    pause_online_orders,
    release_block,
    resume_online_orders,
    update_capacity,
)
from ..websocket_manager import manager

router = APIRouter(prefix="/api/online-orders", tags=["Online Order Operational Control"])


class PauseOrdersPayload(BaseModel):
    reason: str = Field(min_length=3, max_length=160)
    duration_minutes: Literal[15, 30, 60] | None = None


class ResumeOrdersPayload(BaseModel):
    reason: str = Field(default="Reabertura manual", min_length=3, max_length=160)


class CapacityPayload(BaseModel):
    max_active_orders: int | None = Field(default=None, ge=1, le=500)
    auto_pause: bool = False


class BlockCustomerPayload(BaseModel):
    reason: str = Field(min_length=3, max_length=240)
    duration_hours: Literal[24, 168, 720] | None = None


class ReleaseBlockPayload(BaseModel):
    reason: str = Field(default="Bloqueio removido pela operação", min_length=3, max_length=240)


def _authorized_operator(
    current_user: Usuario = Depends(require_roles("admin", "gerente", "caixa")),
) -> Usuario:
    return current_user


def _notify_public_menu(background_tasks: BackgroundTasks, restaurante_id: int) -> None:
    background_tasks.add_task(
        manager.broadcast,
        {"event": "config_updated", "source": "online_order_control"},
        restaurante_id,
    )


@router.get("/control")
def get_online_order_control(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(_authorized_operator),
):
    del current_user
    rid = require_tenant_id()
    result = operational_status(db, rid)
    db.commit()
    return result


@router.post("/pause")
def pause_orders(
    payload: PauseOrdersPayload,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(_authorized_operator),
):
    rid = require_tenant_id()
    pause_online_orders(
        db,
        restaurante_id=rid,
        actor_user_id=str(current_user.id),
        reason=payload.reason,
        duration_minutes=payload.duration_minutes,
    )
    db.commit()
    result = operational_status(db, rid)
    _notify_public_menu(background_tasks, rid)
    return result


@router.post("/resume")
def resume_orders(
    payload: ResumeOrdersPayload,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(_authorized_operator),
):
    rid = require_tenant_id()
    resume_online_orders(
        db,
        restaurante_id=rid,
        actor_user_id=str(current_user.id),
        reason=payload.reason,
    )
    db.commit()
    result = operational_status(db, rid)
    _notify_public_menu(background_tasks, rid)
    return result


@router.put("/capacity")
def configure_capacity(
    payload: CapacityPayload,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(_authorized_operator),
):
    rid = require_tenant_id()
    update_capacity(
        db,
        restaurante_id=rid,
        actor_user_id=str(current_user.id),
        max_active_orders=payload.max_active_orders,
        auto_pause=payload.auto_pause,
    )
    db.commit()
    result = operational_status(db, rid)
    _notify_public_menu(background_tasks, rid)
    return result


@router.get("/blocks")
def list_customer_blocks(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(_authorized_operator),
):
    del current_user
    rid = require_tenant_id()
    blocks = (
        db.query(OnlineOrderCustomerBlock)
        .filter(
            OnlineOrderCustomerBlock.restaurante_id == rid,
            OnlineOrderCustomerBlock.active.is_(True),
        )
        .order_by(OnlineOrderCustomerBlock.created_at.desc())
        .all()
    )
    return [
        {
            "id": block.id,
            "cliente_id": block.cliente_id,
            "reason": block.reason,
            "expires_at": block.expires_at.isoformat() if block.expires_at else None,
            "created_at": block.created_at.isoformat() if block.created_at else None,
        }
        for block in blocks
    ]


@router.post("/blocks/by-order/{comanda_id}", status_code=status.HTTP_201_CREATED)
def block_customer_from_order(
    comanda_id: str,
    payload: BlockCustomerPayload,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(_authorized_operator),
):
    rid = require_tenant_id()
    comanda = (
        db.query(Comanda)
        .filter(
            Comanda.restaurante_id == rid,
            Comanda.id == comanda_id,
        )
        .with_for_update()
        .first()
    )
    if comanda is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pedido não encontrado.")

    try:
        block = block_from_order(
            db,
            restaurante_id=rid,
            comanda=comanda,
            actor_user_id=str(current_user.id),
            reason=payload.reason,
            duration_hours=payload.duration_hours,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    db.commit()
    return {
        "id": block.id,
        "cliente_id": block.cliente_id,
        "reason": block.reason,
        "expires_at": block.expires_at.isoformat() if block.expires_at else None,
    }


@router.post("/blocks/{block_id}/release")
def unblock_customer(
    block_id: str,
    payload: ReleaseBlockPayload,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(_authorized_operator),
):
    rid = require_tenant_id()
    block = (
        db.query(OnlineOrderCustomerBlock)
        .filter(
            OnlineOrderCustomerBlock.restaurante_id == rid,
            OnlineOrderCustomerBlock.id == block_id,
            OnlineOrderCustomerBlock.active.is_(True),
        )
        .with_for_update()
        .first()
    )
    if block is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bloqueio não encontrado.")

    release_block(
        db,
        restaurante_id=rid,
        block=block,
        actor_user_id=str(current_user.id),
        reason=payload.reason,
    )
    db.commit()
    return {"status": "released", "id": block.id}

from __future__ import annotations

from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db, require_tenant_id
from ..models import Comanda, Item, Usuario
from ..schemas import ComandaResponse, ItemResponse
from ..security import get_current_user, require_permission
from ..services.atendimentos import (
    AtendimentoError,
    ensure_atendimento_for_comanda,
    get_table_family_snapshot,
    merge_tables,
    reopen_command_guarded,
    transfer_group_by_comanda,
    transfer_items_batch,
    unmerge_by_comanda,
)
from ..waiter_permissions import require_waiter_permission
from ..websocket_manager import manager


router = APIRouter(tags=["Atendimentos de Mesa"])


class TransferItemsBatchRequest(BaseModel):
    item_ids: List[str] = Field(min_length=1, max_length=100)


def _raise_domain(exc: AtendimentoError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


def _materialize_table_accounts(
    db: Session,
    restaurante_id: int,
    mesa_id: int,
    *,
    actor_id: str | None = None,
) -> None:
    """Torna comandas legadas compatíveis antes de uma operação estrutural."""
    commands = (
        db.query(Comanda)
        .filter(
            Comanda.restaurante_id == restaurante_id,
            Comanda.mesa_id == mesa_id,
            Comanda.fechada == False,
            Comanda.tipo == "Consumo no Local",
        )
        .order_by(Comanda.criado_em.asc(), Comanda.id.asc())
        .all()
    )
    for command in commands:
        ensure_atendimento_for_comanda(db, command, actor_id=actor_id)
    db.flush()


def _item_already_at_table(
    db: Session,
    restaurante_id: int,
    item_id: str,
    mesa_id: int,
) -> Item | None:
    """Compatibilidade para retries e para o frontend legado pós-batch."""
    return (
        db.query(Item)
        .join(Comanda, Comanda.id == Item.comanda_id)
        .filter(
            Item.restaurante_id == restaurante_id,
            Item.id == item_id,
            Comanda.restaurante_id == restaurante_id,
            Comanda.mesa_id == mesa_id,
            Comanda.fechada == False,
        )
        .first()
    )


@router.get("/atendimentos/mesas/{mesa_id}")
def listar_familias_mesa(
    mesa_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    rid = require_tenant_id()
    try:
        _materialize_table_accounts(db, rid, mesa_id, actor_id=current_user.id)
        data = get_table_family_snapshot(db, rid, mesa_id)
        db.commit()
        return {"mesa_id": mesa_id, "familias": data}
    except AtendimentoError as exc:
        db.rollback()
        _raise_domain(exc)


# Estas rotas entram antes do router legado de orders. Assim mantemos as URLs
# do frontend enquanto trocamos a unidade transacional de Comanda para Família.
@router.post(
    "/comandas/{comanda_id}/transferir/{nova_mesa_id}",
    response_model=ComandaResponse,
)
def transferir_atendimento_compativel(
    comanda_id: str,
    nova_mesa_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    require_waiter_permission(db, current_user, "perm_garcom_transferir_mesa")
    rid = require_tenant_id()
    try:
        _materialize_table_accounts(db, rid, nova_mesa_id, actor_id=current_user.id)
        command = transfer_group_by_comanda(
            db,
            rid,
            comanda_id,
            nova_mesa_id,
            actor_id=current_user.id,
        )
        db.commit()
        db.refresh(command)
    except AtendimentoError as exc:
        db.rollback()
        _raise_domain(exc)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"}, rid)
    return command


@router.post("/comandas/mesclar", response_model=ComandaResponse)
def mesclar_atendimentos_compativel(
    mesa_origem_id: int,
    mesa_destino_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    require_waiter_permission(db, current_user, "perm_garcom_transferir_mesa")
    rid = require_tenant_id()
    try:
        _materialize_table_accounts(db, rid, mesa_origem_id, actor_id=current_user.id)
        _materialize_table_accounts(db, rid, mesa_destino_id, actor_id=current_user.id)
        merge_tables(
            db,
            rid,
            mesa_origem_id,
            mesa_destino_id,
            actor_id=current_user.id,
        )
        command = (
            db.query(Comanda)
            .filter(
                Comanda.restaurante_id == rid,
                Comanda.mesa_id == mesa_destino_id,
                Comanda.fechada == False,
            )
            .order_by(Comanda.criado_em.asc(), Comanda.id.asc())
            .first()
        )
        if command is None:
            raise AtendimentoError("Atendimento mesclado sem comanda ativa", status_code=409)
        db.commit()
        db.refresh(command)
    except AtendimentoError as exc:
        db.rollback()
        _raise_domain(exc)
    background_tasks.add_task(
        manager.broadcast,
        {
            "event": "tables_updated",
            "detail": {
                "type": "mesclar_mesas",
                "mesa_origem": mesa_origem_id,
                "mesa_destino": mesa_destino_id,
            },
        },
        rid,
    )
    return command


@router.post("/comandas/desmesclar", response_model=ComandaResponse)
def desmesclar_atendimento_compativel(
    comanda_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    require_waiter_permission(db, current_user, "perm_garcom_transferir_mesa")
    rid = require_tenant_id()
    try:
        command = unmerge_by_comanda(
            db,
            rid,
            comanda_id,
            actor_id=current_user.id,
        )
        db.commit()
        db.refresh(command)
    except AtendimentoError as exc:
        db.rollback()
        _raise_domain(exc)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"}, rid)
    return command


@router.post(
    "/comandas/itens/transferir-lote/{nova_mesa_id}",
    response_model=List[ItemResponse],
)
def transferir_itens_em_lote(
    nova_mesa_id: int,
    payload: TransferItemsBatchRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    require_waiter_permission(db, current_user, "perm_garcom_transferir_item")
    rid = require_tenant_id()
    try:
        _materialize_table_accounts(db, rid, nova_mesa_id, actor_id=current_user.id)
        already = [
            _item_already_at_table(db, rid, item_id, nova_mesa_id)
            for item_id in payload.item_ids
        ]
        if all(item is not None for item in already):
            return [item for item in already if item is not None]
        if any(item is not None for item in already):
            raise AtendimentoError(
                "O lote mistura itens já transferidos com itens ainda na origem; atualize a mesa e tente novamente.",
                status_code=409,
            )
        items = transfer_items_batch(
            db,
            rid,
            payload.item_ids,
            nova_mesa_id,
            actor_id=current_user.id,
        )
        db.commit()
        for item in items:
            db.refresh(item)
    except AtendimentoError as exc:
        db.rollback()
        _raise_domain(exc)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"}, rid)
    return items


@router.post(
    "/comandas/itens/{item_id}/transferir/{nova_mesa_id}",
    response_model=ItemResponse,
)
def transferir_item_compativel(
    item_id: str,
    nova_mesa_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    require_waiter_permission(db, current_user, "perm_garcom_transferir_item")
    rid = require_tenant_id()
    existing = _item_already_at_table(db, rid, item_id, nova_mesa_id)
    if existing is not None:
        # Retry idempotente: o batch pode ter sido concluído antes da atualização
        # otimista do frontend legado disparar a requisição individual.
        return existing
    try:
        _materialize_table_accounts(db, rid, nova_mesa_id, actor_id=current_user.id)
        items = transfer_items_batch(
            db,
            rid,
            [item_id],
            nova_mesa_id,
            actor_id=current_user.id,
        )
        db.commit()
        item = items[0]
        db.refresh(item)
    except AtendimentoError as exc:
        db.rollback()
        _raise_domain(exc)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"}, rid)
    return item


@router.put("/comandas/{comanda_id}/reabrir", response_model=ComandaResponse)
def reabrir_comanda_compativel(
    comanda_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("comandas:reabrir")),
):
    rid = require_tenant_id()
    try:
        command = reopen_command_guarded(
            db,
            rid,
            comanda_id,
            actor_id=current_user.id,
        )
        db.commit()
        db.refresh(command)
    except AtendimentoError as exc:
        db.rollback()
        _raise_domain(exc)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"}, rid)
    return command

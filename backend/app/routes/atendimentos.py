from __future__ import annotations

import datetime
import uuid
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from ..database import get_db, require_tenant_id
from ..models import Cliente, Comanda, Item, Usuario
from ..operational_models import AtendimentoComanda
from ..schemas import (
    ComandaDetail,
    ComandaResponse,
    ItemCreate,
    ItemResponse,
    LancamentoCreate,
    LancamentoResponse,
    VendaDiretaCreate,
)
from ..security import get_current_user, require_permission
from ..services.atendimento_projection import build_table_family_view
from ..services.atendimentos import (
    AtendimentoError,
    ensure_atendimento_for_comanda,
    get_table_family_snapshot,
    materialize_table_accounts_for_write,
    merge_tables,
    principal_command_for_comanda,
    principal_command_for_table,
    reopen_command_guarded,
    transfer_group_by_comanda,
    transfer_items_batch,
    unmerge_by_comanda,
)
from ..services.printing import PrintingRequestError, enqueue_table_receipt
from ..waiter_permissions import require_waiter_permission
from ..websocket_manager import manager


router = APIRouter(tags=["Atendimentos de Mesa"])


class TransferItemsBatchRequest(BaseModel):
    item_ids: List[str] = Field(min_length=1, max_length=100)


def _raise_domain(exc: AtendimentoError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


def _item_already_at_table(
    db: Session,
    restaurante_id: int,
    item_id: str,
    mesa_id: int,
) -> Item | None:
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
        data = build_table_family_view(db, rid, mesa_id)
        return {"mesa_id": mesa_id, "familias": data}
    except AtendimentoError as exc:
        db.rollback()
        _raise_domain(exc)


@router.post("/mesas/{mesa_id}/imprimir-recibo", status_code=status.HTTP_200_OK)
def imprimir_recibo_mesa_com_identidade(
    mesa_id: int,
    print_header: Optional[str] = None,
    print_footer: Optional[str] = None,
    apenas_valores: bool = False,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    require_waiter_permission(db, current_user, "perm_garcom_print")
    rid = require_tenant_id()
    try:
        materialize_table_accounts_for_write(db, rid, mesa_id, actor_id=current_user.id)
        job = enqueue_table_receipt(
            db,
            rid,
            mesa_id,
            apenas_valores=apenas_valores,
            source_type="mesa",
            source_id=str(mesa_id),
            print_header=print_header,
            print_footer=print_footer,
            printed_by=current_user.nome,
        )
        db.commit()
    except AtendimentoError as exc:
        db.rollback()
        _raise_domain(exc)
    except PrintingRequestError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Erro ao enfileirar impressão do recibo.",
        ) from exc
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="A impressão física não está disponível no plano atual.",
        )
    return {
        "status": "success",
        "detail": "Impressão do recibo enviada com sucesso para a fila de impressão",
        "job_id": job.id,
    }


@router.post(
    "/comandas/{comanda_id}/lancamentos",
    response_model=LancamentoResponse,
    status_code=status.HTTP_201_CREATED,
)
async def lancar_itens_na_familia_principal(
    comanda_id: str,
    lancamento_in: LancamentoCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Depois de mesclar, novos lançamentos pertencem à família da mesa destino."""
    rid = require_tenant_id()
    supplied = db.query(Comanda).filter(
        Comanda.restaurante_id == rid,
        Comanda.id == comanda_id,
    ).first()
    if supplied is None:
        raise HTTPException(status_code=404, detail="Comanda não encontrada")

    from .orders import lancar_itens

    if supplied.tipo != "Consumo no Local" or supplied.mesa_id is None:
        return await lancar_itens(comanda_id, lancamento_in, background_tasks, db, current_user)

    try:
        materialize_table_accounts_for_write(db, rid, int(supplied.mesa_id), actor_id=current_user.id)
        principal = principal_command_for_comanda(
            db,
            rid,
            comanda_id,
            actor_id=current_user.id,
        )
        if principal is None:
            raise AtendimentoError("Família principal sem comanda aberta", status_code=409)
    except AtendimentoError as exc:
        db.rollback()
        _raise_domain(exc)

    return await lancar_itens(principal.id, lancamento_in, background_tasks, db, current_user)


@router.post(
    "/comandas/venda-direta",
    response_model=ComandaDetail,
    status_code=status.HTTP_201_CREATED,
)
async def venda_direta_respeitando_familia_principal(
    venda_in: VendaDiretaCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """PDV em mesa mesclada também grava na família da mesa destino."""
    from .orders import criar_venda_direta, lancar_itens

    normalized_type = (venda_in.tipo or "").strip().casefold()
    is_local = normalized_type in {"consumo no local", "mesa", "local"}
    if not is_local or venda_in.mesa_id is None:
        return await criar_venda_direta(venda_in, background_tasks, db, current_user)

    rid = require_tenant_id()
    try:
        materialize_table_accounts_for_write(db, rid, venda_in.mesa_id, actor_id=current_user.id)
        families = get_table_family_snapshot(db, rid, venda_in.mesa_id)
        if len(families) <= 1:
            return await criar_venda_direta(venda_in, background_tasks, db, current_user)
        principal = principal_command_for_table(db, rid, venda_in.mesa_id)
        if principal is None:
            raise AtendimentoError("Mesa mesclada sem família principal", status_code=409)
        principal_account = ensure_atendimento_for_comanda(db, principal, actor_id=current_user.id)

        garcom_id = venda_in.garcom_id or current_user.id
        garcom = db.query(Usuario).filter(
            Usuario.restaurante_id == rid,
            Usuario.id == garcom_id,
        ).first()
        if garcom is None:
            garcom_id = current_user.id

        if venda_in.cliente_id:
            exists = db.query(Cliente.id).filter(
                Cliente.restaurante_id == rid,
                Cliente.id == venda_in.cliente_id,
            ).first()
            if exists is None:
                raise AtendimentoError("Cliente não encontrado", status_code=404)

        command = Comanda(
            id=f"c-{uuid.uuid4().hex[:8]}",
            restaurante_id=rid,
            cliente_id=venda_in.cliente_id,
            mesa_id=venda_in.mesa_id,
            garcom_id=garcom_id,
            tipo="Consumo no Local",
            identificador=venda_in.identificador,
            numero_pedido=principal_account.numero_conta,
            fechada=False,
            criado_em=datetime.datetime.now(datetime.timezone.utc),
        )
        db.add(command)
        db.flush()
        db.add(
            AtendimentoComanda(
                restaurante_id=rid,
                atendimento_id=principal_account.id,
                comanda_id=command.id,
            )
        )
        db.flush()

        launch_payload = LancamentoCreate(
            garcom_id=garcom_id,
            itens=[
                ItemCreate(
                    produto_id=item.produto_id,
                    observacao=item.observacao or "",
                    cliente_nome=item.cliente_nome or venda_in.identificador or "Consumo Geral",
                )
                for item in venda_in.itens
            ],
        )
        await lancar_itens(command.id, launch_payload, background_tasks, db, current_user)
        completed = (
            db.query(Comanda)
            .options(
                joinedload(Comanda.itens).joinedload(Item.produto),
                joinedload(Comanda.criada_por),
            )
            .filter(Comanda.restaurante_id == rid, Comanda.id == command.id)
            .first()
        )
        if completed is None:
            raise AtendimentoError("Venda de mesa não pôde ser reconstruída", status_code=500)
        return completed
    except AtendimentoError as exc:
        db.rollback()
        _raise_domain(exc)


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
        materialize_table_accounts_for_write(db, rid, nova_mesa_id, actor_id=current_user.id)
        command = transfer_group_by_comanda(db, rid, comanda_id, nova_mesa_id, actor_id=current_user.id)
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
        materialize_table_accounts_for_write(db, rid, mesa_origem_id, actor_id=current_user.id)
        materialize_table_accounts_for_write(db, rid, mesa_destino_id, actor_id=current_user.id)
        merge_tables(db, rid, mesa_origem_id, mesa_destino_id, actor_id=current_user.id)
        command = principal_command_for_table(db, rid, mesa_destino_id)
        if command is None:
            raise AtendimentoError("Atendimento mesclado sem comanda principal ativa", status_code=409)
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
        command = unmerge_by_comanda(db, rid, comanda_id, actor_id=current_user.id)
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
        materialize_table_accounts_for_write(db, rid, nova_mesa_id, actor_id=current_user.id)
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
        items = transfer_items_batch(db, rid, payload.item_ids, nova_mesa_id, actor_id=current_user.id)
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
        return existing
    try:
        materialize_table_accounts_for_write(db, rid, nova_mesa_id, actor_id=current_user.id)
        items = transfer_items_batch(db, rid, [item_id], nova_mesa_id, actor_id=current_user.id)
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
        command = reopen_command_guarded(db, rid, comanda_id, actor_id=current_user.id)
        db.commit()
        db.refresh(command)
    except AtendimentoError as exc:
        db.rollback()
        _raise_domain(exc)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"}, rid)
    return command

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..application.printing import (
    PrintAction,
    PrintIntent,
    PrintSourceType,
    PrintingApplicationService,
    UniversalPrintingError,
)
from ..database import get_db, require_tenant_id
from ..models import Comanda, Item, Lancamento, Usuario
from ..security import get_current_user
from ..waiter_permissions import require_waiter_permission


router = APIRouter(tags=["Impressão de Atendimentos"])


def _enqueue_reprint(
    *,
    db: Session,
    restaurante_id: int,
    lancamento_id: str,
    current_user: Usuario,
    table_id: Optional[int] = None,
):
    try:
        jobs = PrintingApplicationService.request_print(
            db,
            PrintIntent(
                restaurant_id=restaurante_id,
                source_type=PrintSourceType.ORDER,
                source_id=lancamento_id,
                action=PrintAction.REPRINT,
                table_id=table_id,
                requested_by=current_user.nome,
            ),
        )
        db.commit()
    except UniversalPrintingError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Erro ao enfileirar a reimpressão deste pedido.",
        ) from exc

    if not jobs:
        raise HTTPException(
            status_code=403,
            detail="A impressão física não está disponível no plano atual.",
        )
    return jobs


@router.post(
    "/comandas/lancamentos/{lancamento_id}/reimprimir",
    status_code=status.HTTP_200_OK,
)
def reimprimir_lancamento_na_mesa_atual(
    lancamento_id: str,
    background_tasks: BackgroundTasks,
    mesa_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Alias compatível de reimpressão para o Core Universal de Impressão.

    Para consumo local, preserva a regra de itens transferidos entre mesas.
    Retirada/Delivery deixam de usar o formatter legado e passam pelo mesmo
    domínio que gera a primeira via automática.
    """
    del background_tasks
    require_waiter_permission(db, current_user, "perm_garcom_print")
    rid = require_tenant_id()

    # Compatibilidade de identificadores antigos baseados diretamente na Comanda.
    # O Core resolve a própria origem sem a rota escolher formatter/layout.
    if lancamento_id.startswith("c-"):
        jobs = _enqueue_reprint(
            db=db,
            restaurante_id=rid,
            lancamento_id=lancamento_id,
            current_user=current_user,
        )
        return {
            "status": "success",
            "detail": "Reimpressão do pedido enviada para a fila",
            "job_id": jobs[0].id,
            "job_ids": [job.id for job in jobs],
            "mesa_id": None,
        }

    lancamento = (
        db.query(Lancamento)
        .join(Comanda, Comanda.id == Lancamento.comanda_id)
        .filter(
            Lancamento.restaurante_id == rid,
            Lancamento.id == lancamento_id,
            Comanda.restaurante_id == rid,
        )
        .first()
    )
    if lancamento is None:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado")

    original = db.query(Comanda).filter(
        Comanda.restaurante_id == rid,
        Comanda.id == lancamento.comanda_id,
    ).first()
    if original is None:
        raise HTTPException(status_code=404, detail="Comanda associada não encontrada")

    # Fora do salão não há ambiguidade de mesa: o Core resolve os documentos
    # e destinos com a mesma política da primeira via.
    if original.tipo != "Consumo no Local":
        jobs = _enqueue_reprint(
            db=db,
            restaurante_id=rid,
            lancamento_id=lancamento_id,
            current_user=current_user,
        )
        return {
            "status": "success",
            "detail": "Reimpressão do pedido enviada para a fila",
            "job_id": jobs[0].id,
            "job_ids": [job.id for job in jobs],
            "mesa_id": None,
        }

    current_tables = {
        int(table_id)
        for (table_id,) in (
            db.query(Comanda.mesa_id)
            .join(Item, Item.comanda_id == Comanda.id)
            .filter(
                Comanda.restaurante_id == rid,
                Item.restaurante_id == rid,
                Item.lancamento_id == lancamento_id,
                Item.status != "cancelado",
                Comanda.fechada == False,
                Comanda.mesa_id.isnot(None),
            )
            .distinct()
            .all()
        )
        if table_id is not None
    }
    if not current_tables:
        raise HTTPException(
            status_code=409,
            detail="Este pedido não possui itens ativos em uma mesa aberta.",
        )

    if mesa_id is None:
        if len(current_tables) != 1:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Este pedido foi dividido entre mesas. Informe a mesa do card "
                    "para reimprimir somente a parte correta."
                ),
            )
        target_table = next(iter(current_tables))
    else:
        target_table = int(mesa_id)
        if target_table not in current_tables:
            raise HTTPException(
                status_code=404,
                detail="Este pedido não possui itens ativos na mesa informada.",
            )

    jobs = _enqueue_reprint(
        db=db,
        restaurante_id=rid,
        lancamento_id=lancamento_id,
        current_user=current_user,
        table_id=target_table,
    )
    return {
        "status": "success",
        "detail": "Reimpressão do pedido enviada para a fila",
        "job_id": jobs[0].id,
        "job_ids": [job.id for job in jobs],
        "mesa_id": target_table,
    }

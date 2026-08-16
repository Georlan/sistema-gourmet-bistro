from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db, require_tenant_id
from ..models import Comanda, Item, Lancamento, Usuario
from ..security import get_current_user
from ..services.printing import PrintingRequestError, enqueue_table_receipt
from ..waiter_permissions import require_waiter_permission


router = APIRouter(tags=["Impressão de Atendimentos"])


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
    """Reimprime o fragmento do pedido que pertence à mesa indicada.

    Um lançamento conserva para sempre seu ID humano original (ex. #46-B), mas
    seus itens podem ser transferidos para mesas diferentes. Quando a mesma
    origem passa a aparecer em dois cards, o `mesa_id` remove a ambiguidade e
    garante que o botão da Mesa 8 não reimprima os itens que ficaram na Mesa 3.
    """
    require_waiter_permission(db, current_user, "perm_garcom_print")
    rid = require_tenant_id()

    # Compatibilidade para vias antigas de Delivery/Retirada que usam a própria
    # Comanda (`c-...`) como origem de reimpressão.
    if lancamento_id.startswith("c-"):
        from .orders import reimprimir_lancamento_cozinha

        return reimprimir_lancamento_cozinha(
            lancamento_id,
            background_tasks,
            db,
            current_user,
        )

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

    if original.tipo != "Consumo no Local":
        from .orders import reimprimir_lancamento_cozinha

        return reimprimir_lancamento_cozinha(
            lancamento_id,
            background_tasks,
            db,
            current_user,
        )

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

    try:
        job = enqueue_table_receipt(
            db,
            rid,
            target_table,
            apenas_valores=False,
            source_type="reimpressao",
            source_id=lancamento_id,
        )
        db.commit()
    except PrintingRequestError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Erro ao enfileirar a reimpressão deste pedido.",
        ) from exc

    if job is None:
        raise HTTPException(
            status_code=403,
            detail="A impressão física não está disponível no plano atual.",
        )
    return {
        "status": "success",
        "detail": "Reimpressão do pedido enviada para a fila",
        "job_id": job.id,
        "mesa_id": target_table,
    }

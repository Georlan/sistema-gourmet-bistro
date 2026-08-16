from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db, require_tenant_id
from ..models import Usuario
from ..security import require_permission
from ..services.printing import PrintingRequestError, enqueue_cash_closing_receipt


router = APIRouter(prefix="/impressao", tags=["Impressão"])


@router.post(
    "/caixa/turnos/{turno_id}/comprovante",
    status_code=status.HTTP_200_OK,
)
def imprimir_comprovante_fechamento_caixa(
    turno_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("caixa:operar")),
):
    """Enfileira a via física de um fechamento já concluído.

    O comprovante é reconstruído do banco. O frontend não envia valores nem
    texto livre, evitando divergência entre o que foi fechado e o que foi
    impresso.
    """
    del current_user
    restaurante_id = require_tenant_id()
    try:
        job = enqueue_cash_closing_receipt(db, restaurante_id, turno_id)
        db.commit()
    except PrintingRequestError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Não foi possível enfileirar o comprovante de fechamento.",
        ) from exc

    if job is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="A impressão física não está disponível no plano atual.",
        )

    return {
        "status": "success",
        "detail": "Comprovante de fechamento enviado para a fila de impressão.",
        "job_id": job.id,
    }

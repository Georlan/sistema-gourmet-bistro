import logging
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..adapters.orders.web_adapter import CardapioWebAdapter
from ..database import get_db
from ..models import Comanda, ItemComanda, OnlinePaymentIntent
from ..schemas import CardapioPedidoAgendavelCreate
from ..services.online_payments import OnlinePaymentService
from ..services.public_orders import enforce_public_order_rate_limits
from ..services.scheduled_orders import scheduled_for_order

logger = logging.getLogger("koma.routes.cardapio")

router = APIRouter(prefix="/cardapio", tags=["cardapio"])


@router.get("/health")
def cardapio_health():
    return {"status": "ok"}


def _order_total(comanda: Comanda) -> float:
    itens_total = sum(float(item.preco_unit or 0) for item in comanda.itens if item.status != "cancelado")
    taxa = float(comanda.delivery_taxa or 0)
    desconto_cupom = float(getattr(comanda, "valor_desconto_cupom", 0) or 0)
    desconto_cashback = float(getattr(comanda, "valor_desconto_cashback", 0) or 0)
    return round(max(0.0, itens_total + taxa - desconto_cupom - desconto_cashback), 2)


def _load_existing_idempotent_order(db: Session, rest_id: int, key: str) -> Comanda | None:
    if not key:
        return None
    return (
        db.query(Comanda)
        .filter(
            Comanda.restaurante_id == rest_id,
            Comanda.idempotency_key == key,
        )
        .first()
    )


def _enforce_public_order_rate_limits(
    db: Session,
    *,
    request: Request,
    restaurante_id: int,
    telefone: str,
) -> None:
    """Persiste limites antes da transação do pedido para resistir a payloads inválidos."""
    enforce_public_order_rate_limits(
        db,
        request=request,
        restaurante_id=restaurante_id,
        telefone=telefone,
    )


@router.post("/pedidos", status_code=status.HTTP_201_CREATED)
def criar_pedido_online(
    payload: CardapioPedidoAgendavelCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    customer_token: str | None = Header(
        default=None,
        alias="X-Koma-Customer-Token",
    ),
    request_idempotency_key: str | None = Header(
        default=None,
        alias="X-Idempotency-Key",
    ),
):
    """Cria um pedido público via WebAdapter (Strangler canônico).

    Novos clientes permanecem no próprio Cardápio. O tracking_token segue
    disponível para Chat & Status, mas tracking_url é legado e não é mais
    emitido para iniciar novas navegações em /acompanhar.
    """
    response = CardapioWebAdapter.handle_create_public_order(
        payload=payload,
        request=request,
        background_tasks=background_tasks,
        db=db,
        customer_token=customer_token,
        request_idempotency_key=request_idempotency_key,
    )
    if isinstance(response, dict):
        response = dict(response)
        response.pop("tracking_url", None)
    return response


def _resolve_public_order_tenant(db: Session, comanda_id: str, key: str) -> int | None:
    """Descobre o tenant somente quando ID + chave secreta do pedido conferem."""
    if not comanda_id or not key:
        return None

    if db.get_bind().dialect.name == "postgresql":
        return db.execute(
            text(
                "SELECT koma_internal.resolve_public_order_tenant("
                ":comanda_id, :key)"
            ),
            {"comanda_id": comanda_id, "key": key},
        ).scalar_one_or_none()

    row = (
        db.query(Comanda.restaurante_id)
        .filter(Comanda.id == comanda_id, Comanda.idempotency_key == key)
        .one_or_none()
    )
    return int(row[0]) if row else None


def _resolve_tracking_order_tenant(db: Session, comanda_id: str, token: str) -> int | None:
    """Descobre tenant por token opaco de tracking sem confiar em tenant do cliente."""
    if not comanda_id or not token:
        return None

    if db.get_bind().dialect.name == "postgresql":
        return db.execute(
            text(
                "SELECT koma_internal.resolve_tracking_order_tenant("
                ":comanda_id, :token)"
            ),
            {"comanda_id": comanda_id, "token": token},
        ).scalar_one_or_none()

    row = (
        db.query(Comanda.restaurante_id)
        .filter(Comanda.id == comanda_id, Comanda.tracking_token == token)
        .one_or_none()
    )
    return int(row[0]) if row else None


@router.get("/pedidos/{comanda_id}")
def consultar_status_pedido_publico(
    comanda_id: str,
    key: Annotated[str | None, Query(min_length=16, max_length=512)] = None,
    tracking_token: Annotated[str | None, Query(min_length=16, max_length=512)] = None,
    db: Session = Depends(get_db),
):
    tenant_id = None
    if tracking_token:
        tenant_id = _resolve_tracking_order_tenant(db, comanda_id, tracking_token)
    elif key:
        tenant_id = _resolve_public_order_tenant(db, comanda_id, key)
    if tenant_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pedido não encontrado")

    comanda = (
        db.query(Comanda)
        .filter(Comanda.id == comanda_id, Comanda.restaurante_id == tenant_id)
        .first()
    )
    if not comanda:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pedido não encontrado")

    schedule = scheduled_for_order(
        db,
        restaurante_id=tenant_id,
        comanda_id=comanda.id,
    )
    payment_intent = (
        db.query(OnlinePaymentIntent)
        .filter(
            OnlinePaymentIntent.restaurante_id == tenant_id,
            OnlinePaymentIntent.comanda_id == comanda.id,
        )
        .first()
    )

    return {
        "id": comanda.id,
        "numero_pedido": comanda.numero_pedido,
        "tipo": comanda.tipo,
        "delivery_status": (
            "agendado"
            if schedule is not None and schedule.released_at is None
            else (comanda.delivery_status or "pendente")
        ),
        "scheduled_for": schedule.scheduled_for.isoformat() if schedule is not None else None,
        "cliente_nome": comanda.cliente_nome,
        "cliente_telefone": comanda.cliente_telefone,
        "total": _order_total(comanda),
        "itens": [
            {
                "id": item.id,
                "produto_id": item.produto_id,
                "quantidade": item.quantidade,
                "preco_unit": float(item.preco_unit or 0),
                "status": item.status,
                "observacao": item.observacao,
            }
            for item in comanda.itens
        ],
        "pagamento": (
            OnlinePaymentService.public_payload(payment_intent)
            if payment_intent is not None
            else {"status": "pendente_no_atendimento", "cobranca_online": False}
        ),
    }

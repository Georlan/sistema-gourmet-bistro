import uuid
import datetime
import logging
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request, status
from sqlalchemy import or_, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from ..database import get_db, current_restaurante_id, tenant_session_scope
from ..models import (
    Comanda,
    ConfiguracaoRestaurante,
    Cupom,
    HistoricoFidelidade,
    Item,
    ItemModificador,
    Lancamento,
    OpcaoModificador,
    Produto,
    Restaurante,
    Usuario,
)
from ..schemas import CardapioPedidoCreate
from .cupons import _validar_regras_cupom
from ..websocket_manager import manager
from .cardapio_digital import resolve_restaurant_id
from .orders import gerar_novo_numero_pedido
from ..services.clientes import (
    cadastrar_ou_atualizar_cliente,
    normalizar_telefone_cliente,
)
from ..services.inventory import consumir_estoque_dos_itens
from ..services.online_order_policy import evaluate_online_order_policy
from .cardapio_clientes import authenticated_customer, _client_ip, _consume_rate_limit

logger = logging.getLogger("koma.cardapio")
router = APIRouter(
    prefix="/cardapio",
    tags=["Cardápio Digital Client"]
)

MAX_PUBLIC_ORDER_UNITS = 200
PUBLIC_ORDER_RATE_WINDOW_SECONDS = 15 * 60
MAX_PUBLIC_ORDERS_PER_PHONE = 8
MAX_PUBLIC_ORDERS_PER_IP = 120
ELIGIBLE_ONLINE_ORDER_ROLES = ["admin", "gerente", "caixa", "garcom", "atendente"]


def _order_total(comanda: Comanda) -> float:
    itens_total = sum(float(item.preco_unit or 0) for item in comanda.itens if item.status != "cancelado")
    taxa = float(comanda.delivery_taxa or 0)
    desconto_cupom = float(getattr(comanda, "valor_desconto_cupom", 0) or 0)
    desconto_cashback = float(getattr(comanda, "valor_desconto_cashback", 0) or 0)
    return round(max(0.0, itens_total + taxa - desconto_cupom - desconto_cashback), 2)


def _existing_order_response(comanda: Comanda) -> dict:
    return {
        "status": "success",
        "comanda_id": comanda.id,
        "numero_pedido": comanda.numero_pedido,
        "delivery_status": comanda.delivery_status or "pendente",
        "tipo": comanda.tipo,
        "cliente_id": comanda.cliente_id,
        "total": _order_total(comanda),
        "mensagem": "Pedido já cadastrado com sucesso!",
        "pagamento": {
            "status": "pendente_no_atendimento",
            "cobranca_online": False,
        },
    }


def _load_existing_idempotent_order(db: Session, rest_id: int, key: str) -> Comanda | None:
    if not key:
        return None
    return db.query(Comanda).filter(
        Comanda.restaurante_id == rest_id,
        Comanda.idempotency_key == key,
    ).first()


def _enforce_public_order_rate_limits(
    db: Session,
    *,
    request: Request,
    restaurante_id: int,
    telefone: str,
) -> None:
    """Persiste limites antes da transação do pedido para resistir a payloads inválidos."""
    _consume_rate_limit(
        db,
        restaurante_id=restaurante_id,
        scope="public_order_phone",
        raw_key=telefone,
        max_requests=MAX_PUBLIC_ORDERS_PER_PHONE,
        window_seconds=PUBLIC_ORDER_RATE_WINDOW_SECONDS,
    )
    db.commit()

    _consume_rate_limit(
        db,
        restaurante_id=restaurante_id,
        scope="public_order_ip",
        raw_key=_client_ip(request),
        max_requests=MAX_PUBLIC_ORDERS_PER_IP,
        window_seconds=PUBLIC_ORDER_RATE_WINDOW_SECONDS,
    )
    db.commit()


from ..adapters.orders.web_adapter import CardapioWebAdapter


@router.post("/pedidos", status_code=status.HTTP_201_CREATED)
def criar_pedido_online(
    payload: CardapioPedidoCreate,
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
    """Cria um pedido público via WebAdapter (Strangler canônico)."""
    return CardapioWebAdapter.handle_create_public_order(
        payload=payload,
        request=request,
        background_tasks=background_tasks,
        db=db,
        customer_token=customer_token,
        request_idempotency_key=request_idempotency_key,
    )


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

    return db.execute(
        text(
            """
            SELECT restaurante_id
            FROM comandas
            WHERE id = :comanda_id
              AND idempotency_key = :key
            LIMIT 1
            """
        ),
        {"comanda_id": comanda_id, "key": key},
    ).scalar_one_or_none()


@router.get("/pedidos/{comanda_id}/status")
def consultar_status_pedido_publico(
    comanda_id: str,
    key: str = "",
    db: Session = Depends(get_db),
):
    """
    Retorna o status atual de um pedido público em andamento para o cliente.
    Requer a idempotency_key como query param ?key=... para provar posse.
    Retorna 404 (nunca 403) quando a chave está errada ou ausente, para não
    revelar que o comanda_id existe.
    """
    key = (key or "").strip()
    rest_id = _resolve_public_order_tenant(db, comanda_id.strip(), key)
    if rest_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pedido não encontrado.",
        )

    with tenant_session_scope(db, int(rest_id)):
        comanda = db.query(Comanda).filter(
            Comanda.restaurante_id == int(rest_id),
            Comanda.id == comanda_id,
            Comanda.idempotency_key == key,
        ).first()
        if not comanda:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Pedido não encontrado.",
            )

        itens_payload = [
            {
                "id": item.id,
                "nome": item.produto.nome if item.produto else "Item",
                "quantidade": 1,
            }
            for item in comanda.itens
        ]

        status_retorno = comanda.delivery_status or "pendente"
        if comanda.fechada and status_retorno != "recusado":
            status_retorno = "finalizado"

        return {
            "id": comanda.id,
            "numero_pedido": comanda.numero_pedido,
            "status": status_retorno,
            "tipo": comanda.tipo,
            "total": _order_total(comanda),
            "fechada": comanda.fechada,
            "criado_em": comanda.criado_em.isoformat() if comanda.criado_em else None,
            "itens": itens_payload,
        }

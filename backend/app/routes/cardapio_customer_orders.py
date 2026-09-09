"""Authenticated order history for customers of the public digital menu.

This endpoint is intentionally separate from anonymous tracking. Tracking tokens remain
short-lived browser/session capabilities; account history is resolved exclusively from
the verified customer token and always scoped to the token's restaurant.
"""
from __future__ import annotations

import base64
import datetime
import json
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import Comanda, GrupoModificador, Item, ItemModificador, OpcaoModificador
from ..services.order_chat_service import compute_comanda_total
from ..services.order_state_contract import build_order_state_contract
from .cardapio_clientes import customer_token_scope


router = APIRouter(prefix="/me/pedidos", tags=["Clientes do Cardápio Digital"])


class CustomerOrderHistoryModifier(BaseModel):
    grupo_id: str | None = None
    grupo_nome: str | None = None
    opcao_id: str
    opcao_nome: str
    preco_aplicado: float = 0.0


class CustomerOrderHistoryItem(BaseModel):
    produto_id: str
    nome: str
    quantidade: int = Field(ge=1)
    preco_unitario: float = Field(ge=0)
    observacao: str = ""
    modificadores: list[CustomerOrderHistoryModifier] = Field(default_factory=list)


class CustomerOrderHistoryOrder(BaseModel):
    id: str
    numero_pedido: int | str
    criado_em: str | None = None
    fechado_em: str | None = None
    tipo: str
    status: str
    state: dict[str, Any]
    total: float = Field(ge=0)
    taxa_entrega: float = Field(ge=0)
    desconto_cupom: float = Field(ge=0)
    desconto_cashback: float = Field(ge=0)
    itens: list[CustomerOrderHistoryItem] = Field(default_factory=list)


class CustomerOrderHistoryResponse(BaseModel):
    items: list[CustomerOrderHistoryOrder]
    next_cursor: str | None = None


def _as_utc(value: datetime.datetime) -> datetime.datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=datetime.timezone.utc)
    return value.astimezone(datetime.timezone.utc)


def _encode_cursor(created_at: datetime.datetime, order_id: str) -> str:
    payload = {
        "created_at": _as_utc(created_at).isoformat(),
        "id": str(order_id),
    }
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_cursor(raw_cursor: str) -> tuple[datetime.datetime, str]:
    try:
        padding = "=" * (-len(raw_cursor) % 4)
        decoded = base64.urlsafe_b64decode((raw_cursor + padding).encode("ascii"))
        payload = json.loads(decoded.decode("utf-8"))
        created_at = datetime.datetime.fromisoformat(str(payload["created_at"]))
        order_id = str(payload["id"]).strip()
        if not order_id:
            raise ValueError("missing id")
        return _as_utc(created_at), order_id
    except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Cursor de histórico inválido.",
        ) from exc


def _effective_status(comanda: Comanda) -> str:
    raw_status = (comanda.delivery_status or "pendente").strip().lower()
    if raw_status in {"recusado", "rejected", "cancelado", "cancelled"}:
        return raw_status
    if comanda.fechada:
        return "finalizado"
    return raw_status


def _build_modifier_lookup(
    db: Session,
    restaurante_id: int,
    orders: list[Comanda],
) -> dict[str, list[CustomerOrderHistoryModifier]]:
    item_ids = [
        item.id
        for order in orders
        for item in (order.itens or [])
        if item.status != "cancelado"
    ]
    if not item_ids:
        return {}

    rows = (
        db.query(ItemModificador, OpcaoModificador, GrupoModificador)
        .join(
            OpcaoModificador,
            and_(
                OpcaoModificador.restaurante_id == ItemModificador.restaurante_id,
                OpcaoModificador.id == ItemModificador.opcao_modificador_id,
            ),
        )
        .outerjoin(
            GrupoModificador,
            and_(
                GrupoModificador.restaurante_id == OpcaoModificador.restaurante_id,
                GrupoModificador.id == OpcaoModificador.grupo_id,
            ),
        )
        .filter(
            ItemModificador.restaurante_id == restaurante_id,
            ItemModificador.item_id.in_(item_ids),
        )
        .all()
    )

    by_item: dict[str, list[CustomerOrderHistoryModifier]] = defaultdict(list)
    for item_modifier, option, group in rows:
        by_item[str(item_modifier.item_id)].append(
            CustomerOrderHistoryModifier(
                grupo_id=str(option.grupo_id) if option.grupo_id else None,
                grupo_nome=group.nome if group else None,
                opcao_id=str(option.id),
                opcao_nome=option.nome,
                preco_aplicado=float(item_modifier.preco_aplicado or 0.0),
            )
        )
    return dict(by_item)


def _serialize_items(
    comanda: Comanda,
    modifiers_by_item: dict[str, list[CustomerOrderHistoryModifier]],
) -> list[CustomerOrderHistoryItem]:
    grouped: dict[tuple[Any, ...], CustomerOrderHistoryItem] = {}

    for item in comanda.itens or []:
        if item.status == "cancelado":
            continue
        modifiers = sorted(
            modifiers_by_item.get(str(item.id), []),
            key=lambda modifier: (modifier.grupo_id or "", modifier.opcao_id),
        )
        modifier_signature = tuple(
            (modifier.grupo_id, modifier.opcao_id, round(modifier.preco_aplicado, 2))
            for modifier in modifiers
        )
        key = (
            str(item.produto_id),
            str(item.observacao or ""),
            round(float(item.preco_unit or 0.0), 2),
            modifier_signature,
        )
        existing = grouped.get(key)
        if existing is not None:
            existing.quantidade += 1
            continue

        grouped[key] = CustomerOrderHistoryItem(
            produto_id=str(item.produto_id),
            nome=item.produto.nome if item.produto else "Item indisponível",
            quantidade=1,
            preco_unitario=float(item.preco_unit or 0.0),
            observacao=str(item.observacao or ""),
            modificadores=modifiers,
        )

    return list(grouped.values())


@router.get("", response_model=CustomerOrderHistoryResponse)
def list_customer_orders(
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
    customer_token: str = Header(alias="X-Koma-Customer-Token"),
):
    """Return the verified customer's order history for this restaurant only."""
    with customer_token_scope(db, customer_token) as claims:
        query = (
            db.query(Comanda)
            .options(joinedload(Comanda.itens).joinedload(Item.produto))
            .filter(
                Comanda.restaurante_id == claims.restaurante_id,
                Comanda.cliente_id == claims.cliente_id,
            )
        )

        if cursor:
            cursor_created_at, cursor_id = _decode_cursor(cursor)
            # Comanda.criado_em historically uses both naive and timezone-aware values.
            # SQLAlchemy/DB handles the bound datetime; the id tie-breaker keeps paging stable.
            query = query.filter(
                or_(
                    Comanda.criado_em < cursor_created_at,
                    and_(
                        Comanda.criado_em == cursor_created_at,
                        Comanda.id < cursor_id,
                    ),
                )
            )

        rows = (
            query.order_by(Comanda.criado_em.desc(), Comanda.id.desc())
            .limit(limit + 1)
            .all()
        )
        has_more = len(rows) > limit
        page = rows[:limit]
        modifiers_by_item = _build_modifier_lookup(db, claims.restaurante_id, page)

        items: list[CustomerOrderHistoryOrder] = []
        for comanda in page:
            effective_status = _effective_status(comanda)
            state_contract = build_order_state_contract(effective_status, comanda.tipo)
            items.append(
                CustomerOrderHistoryOrder(
                    id=str(comanda.id),
                    numero_pedido=comanda.numero_pedido,
                    criado_em=comanda.criado_em.isoformat() if comanda.criado_em else None,
                    fechado_em=comanda.fechado_em.isoformat() if comanda.fechado_em else None,
                    tipo=comanda.tipo or "Retirada",
                    status=effective_status,
                    state=state_contract,
                    total=compute_comanda_total(comanda),
                    taxa_entrega=float(comanda.delivery_taxa or 0.0),
                    desconto_cupom=float(comanda.valor_desconto_cupom or 0.0),
                    desconto_cashback=float(comanda.valor_desconto_cashback or 0.0),
                    itens=_serialize_items(comanda, modifiers_by_item),
                )
            )

        next_cursor = None
        if has_more and page and page[-1].criado_em:
            next_cursor = _encode_cursor(page[-1].criado_em, str(page[-1].id))

        return CustomerOrderHistoryResponse(items=items, next_cursor=next_cursor)

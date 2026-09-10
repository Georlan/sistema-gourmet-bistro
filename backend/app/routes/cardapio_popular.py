"""Ranking público enxuto de produtos mais escolhidos no cardápio.

A consulta é tenant-local e considera apenas itens de lançamentos efetivamente
aceitos/produzidos/finalizados. O resultado é cacheado em memória por poucos
minutos e também recebe Cache-Control para evitar agregação em cada visita.
"""

from __future__ import annotations

import datetime
import time
from threading import Lock
from typing import Optional

from fastapi import Depends, Response
from sqlalchemy import and_, desc, func
from sqlalchemy.orm import Session

from ..database import get_db, tenant_session_scope
from ..models import Comanda, Item, Lancamento, Produto
from ..services.public_orders import resolve_restaurant_id

POPULAR_WINDOW_DAYS = 90
POPULAR_LIMIT = 6
POPULAR_CACHE_SECONDS = 300
_POPULAR_CACHE: dict[int, tuple[float, list[dict[str, object]]]] = {}
_CACHE_LOCK = Lock()


def _cached(restaurante_id: int) -> Optional[list[dict[str, object]]]:
    now = time.monotonic()
    with _CACHE_LOCK:
        entry = _POPULAR_CACHE.get(restaurante_id)
        if entry is None:
            return None
        expires_at, payload = entry
        if expires_at <= now:
            _POPULAR_CACHE.pop(restaurante_id, None)
            return None
        return [dict(item) for item in payload]


def _store_cache(restaurante_id: int, payload: list[dict[str, object]]) -> None:
    with _CACHE_LOCK:
        if len(_POPULAR_CACHE) >= 256 and restaurante_id not in _POPULAR_CACHE:
            oldest_key = next(iter(_POPULAR_CACHE))
            _POPULAR_CACHE.pop(oldest_key, None)
        _POPULAR_CACHE[restaurante_id] = (
            time.monotonic() + POPULAR_CACHE_SECONDS,
            [dict(item) for item in payload],
        )


def listar_produtos_populares(
    response: Response,
    restaurante_id: Optional[str] = None,
    slug: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Retorna no máximo seis ids de produtos populares do tenant nos últimos 90 dias."""
    rest_id = resolve_restaurant_id(restaurante_id, slug, db, None, bind_session=False)
    response.headers["Cache-Control"] = "public, max-age=300, stale-while-revalidate=900"

    cached = _cached(rest_id)
    if cached is not None:
        return {"produtos": cached, "janela_dias": POPULAR_WINDOW_DAYS}

    cutoff = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) - datetime.timedelta(
        days=POPULAR_WINDOW_DAYS,
    )
    with tenant_session_scope(db, rest_id):
        rows = (
            db.query(
                Item.produto_id,
                func.count(Item.id).label("escolhas"),
            )
            .join(
                Comanda,
                and_(
                    Comanda.id == Item.comanda_id,
                    Comanda.restaurante_id == Item.restaurante_id,
                ),
            )
            .join(
                Lancamento,
                and_(
                    Lancamento.id == Item.lancamento_id,
                    Lancamento.restaurante_id == Item.restaurante_id,
                ),
            )
            .join(
                Produto,
                and_(
                    Produto.id == Item.produto_id,
                    Produto.restaurante_id == Item.restaurante_id,
                ),
            )
            .filter(
                Item.restaurante_id == rest_id,
                Comanda.restaurante_id == rest_id,
                Lancamento.restaurante_id == rest_id,
                Produto.restaurante_id == rest_id,
                Produto.ativo.is_(True),
                Comanda.criado_em >= cutoff,
                Item.status != "cancelado",
                Lancamento.status.in_(("aceito", "producao", "pronto", "finalizado")),
            )
            .group_by(Item.produto_id)
            .order_by(desc("escolhas"), Item.produto_id.asc())
            .limit(POPULAR_LIMIT)
            .all()
        )

    payload = [
        {"produto_id": str(produto_id), "escolhas": int(escolhas or 0)}
        for produto_id, escolhas in rows
    ]
    _store_cache(rest_id, payload)
    return {"produtos": payload, "janela_dias": POPULAR_WINDOW_DAYS}

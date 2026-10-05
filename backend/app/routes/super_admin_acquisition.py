"""Aquisição de pedidos do Cardápio visível somente ao SuperAdmin da plataforma."""

from __future__ import annotations

import datetime
from collections import Counter
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import SessionLocal, tenant_session_scope
from ..models import Comanda, Restaurante
from .super_admin import _discover_restaurant_ids, get_current_admin


router = APIRouter(prefix="/acquisition", tags=["SuperAdminAcquisition"])


def _attr_value(data: object, key: str) -> str | None:
    if not isinstance(data, dict):
        return None
    value = data.get(key)
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


@router.get("")
def acquisition_overview(
    days: int = Query(30, ge=1, le=90),
    tenant_id: Optional[int] = Query(None, gt=0),
    limit: int = Query(100, ge=1, le=500),
    admin: dict = Depends(get_current_admin),
):
    """Lista conversões rastreadas sem expor PII do consumidor ao control plane."""
    since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)
    discovery_db = SessionLocal()
    try:
        tenant_ids = _discover_restaurant_ids(discovery_db)
    finally:
        discovery_db.close()

    if tenant_id is not None:
        tenant_ids = [value for value in tenant_ids if value == tenant_id]

    rows: list[dict] = []
    by_source: Counter[str] = Counter()
    by_campaign: Counter[str] = Counter()

    for current_tenant_id in tenant_ids:
        db: Session = SessionLocal()
        try:
            with tenant_session_scope(db, current_tenant_id):
                restaurant = db.query(Restaurante).filter(Restaurante.id == current_tenant_id).first()
                restaurant_name = restaurant.nome if restaurant else f"Restaurante #{current_tenant_id}"
                orders = (
                    db.query(Comanda)
                    .filter(
                        Comanda.restaurante_id == current_tenant_id,
                        Comanda.criado_em >= since,
                        Comanda.acquisition_attribution.isnot(None),
                        Comanda.onboarding_test.is_(False),
                    )
                    .order_by(Comanda.criado_em.desc())
                    .limit(limit)
                    .all()
                )
                for order in orders:
                    attribution = order.acquisition_attribution or {}
                    source = _attr_value(attribution, "source") or "desconhecido"
                    campaign = _attr_value(attribution, "utm_campaign")
                    by_source[source] += 1
                    if campaign:
                        by_campaign[campaign] += 1
                    rows.append({
                        "tenant_id": current_tenant_id,
                        "restaurant_name": restaurant_name,
                        "order_id": order.id,
                        "numero_pedido": order.numero_pedido,
                        "created_at": order.criado_em.isoformat() if order.criado_em else None,
                        "source": source,
                        "platform": _attr_value(attribution, "platform"),
                        "utm_source": _attr_value(attribution, "utm_source"),
                        "utm_medium": _attr_value(attribution, "utm_medium"),
                        "utm_campaign": campaign,
                        "utm_content": _attr_value(attribution, "utm_content"),
                        "utm_term": _attr_value(attribution, "utm_term"),
                        "referrer_host": _attr_value(attribution, "referrer_host"),
                        "entry_path": _attr_value(attribution, "entry_path"),
                        "first_seen_at": _attr_value(attribution, "first_seen_at"),
                    })
        finally:
            db.close()

    rows.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    rows = rows[:limit]
    return {
        "checked_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "window_days": days,
        "tracked_orders": sum(by_source.values()),
        "by_source": dict(by_source.most_common()),
        "by_campaign": dict(by_campaign.most_common()),
        "items": rows,
    }

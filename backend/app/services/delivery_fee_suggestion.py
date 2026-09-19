"""Sugestão simples de taxa de entrega baseada no histórico real do tenant."""

from __future__ import annotations

import datetime
import math
import statistics
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from sqlalchemy.orm import Session

from ..delivery_address_snapshot import ComandaDeliveryAddressSnapshot
from ..models import Comanda, Restaurante
from .delivery_fee_policy import haversine_distance_km


DEFAULT_MINIMUM_FEE = Decimal("5.00")
DEFAULT_PER_KM_FEE = Decimal("1.00")
MIN_HISTORY_SAMPLES = 6
HISTORY_DAYS = 120
MAX_HISTORY_ORDERS = 120
_HALF_REAL = Decimal("0.50")


def _round_half_real(value: float | Decimal) -> Decimal:
    parsed = Decimal(str(value))
    if parsed <= 0:
        return Decimal("0.00")
    units = (parsed / _HALF_REAL).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return (units * _HALF_REAL).quantize(Decimal("0.01"))


def _default_suggestion(*, sample_size: int, reason: str) -> dict[str, Any]:
    return {
        "taxa_minima": float(DEFAULT_MINIMUM_FEE),
        "valor_por_km": float(DEFAULT_PER_KM_FEE),
        "source": "default",
        "sample_size": sample_size,
        "message": reason,
    }


def suggest_delivery_fee(db: Session, restaurante_id: int) -> dict[str, Any]:
    restaurant = (
        db.query(Restaurante)
        .filter(Restaurante.id == restaurante_id)
        .first()
    )
    if (
        restaurant is None
        or restaurant.latitude is None
        or restaurant.longitude is None
    ):
        return _default_suggestion(
            sample_size=0,
            reason=(
                "Sugestão inicial. Defina o ponto de partida para que o KÔMA "
                "aprenda com as entregas concluídas."
            ),
        )

    since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=HISTORY_DAYS)
    orders = (
        db.query(Comanda)
        .filter(
            Comanda.restaurante_id == restaurante_id,
            Comanda.tipo.in_(("Entrega", "Delivery")),
            Comanda.delivery_status == "finalizado",
            Comanda.delivery_taxa > 0,
            Comanda.criado_em >= since,
        )
        .order_by(Comanda.criado_em.desc())
        .limit(MAX_HISTORY_ORDERS)
        .all()
    )
    if not orders:
        return _default_suggestion(
            sample_size=0,
            reason="Sugestão inicial enquanto ainda não há entregas concluídas suficientes.",
        )

    order_ids = [order.id for order in orders]
    snapshots = (
        db.query(ComandaDeliveryAddressSnapshot)
        .filter(
            ComandaDeliveryAddressSnapshot.restaurante_id == restaurante_id,
            ComandaDeliveryAddressSnapshot.comanda_id.in_(order_ids),
        )
        .all()
    )
    snapshot_by_order = {snapshot.comanda_id: snapshot for snapshot in snapshots}

    samples: list[tuple[float, float]] = []
    for order in orders:
        snapshot = snapshot_by_order.get(order.id)
        if snapshot is None:
            continue
        try:
            payload = snapshot.payload
            latitude = payload.get("latitude")
            longitude = payload.get("longitude")
            if latitude is None or longitude is None:
                continue
            distance = haversine_distance_km(
                float(restaurant.latitude),
                float(restaurant.longitude),
                float(latitude),
                float(longitude),
            )
            fee = float(order.delivery_taxa or 0)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(distance) or not math.isfinite(fee) or distance <= 0 or fee <= 0:
            continue
        samples.append((distance, fee))

    if len(samples) < MIN_HISTORY_SAMPLES:
        return _default_suggestion(
            sample_size=len(samples),
            reason=(
                f"Sugestão inicial: ainda há apenas {len(samples)} entrega(s) "
                "com distância aproveitável."
            ),
        )

    samples.sort(key=lambda pair: pair[0])
    near_count = max(2, math.ceil(len(samples) / 3))
    near_fees = [fee for _distance, fee in samples[:near_count]]
    suggested_minimum = _round_half_real(statistics.median(near_fees))

    farther_samples = samples[len(samples) // 2 :]
    per_km_candidates = [
        fee / max(1.0, distance)
        for distance, fee in farther_samples
    ]
    suggested_per_km = _round_half_real(statistics.median(per_km_candidates))

    minimum = min(max(suggested_minimum, Decimal("1.00")), Decimal("100.00"))
    per_km = min(max(suggested_per_km, Decimal("0.50")), Decimal("20.00"))
    return {
        "taxa_minima": float(minimum),
        "valor_por_km": float(per_km),
        "source": "history",
        "sample_size": len(samples),
        "message": (
            f"Sugestão calculada com {len(samples)} entregas concluídas "
            f"dos últimos {HISTORY_DAYS} dias."
        ),
    }

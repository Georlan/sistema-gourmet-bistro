"""Política server-side para disponibilidade e taxa do cardápio online."""

from __future__ import annotations

from dataclasses import dataclass
import datetime
import json
import re
import unicodedata
from typing import Any

from sqlalchemy.orm import object_session
from sqlalchemy.orm.exc import UnmappedInstanceError

from ..models import CaixaTurno
from ..timezone_utils import get_operational_now


_DAY_INDEX = {
    "segunda": 0,
    "terca": 1,
    "quarta": 2,
    "quinta": 3,
    "sexta": 4,
    "sabado": 5,
    "domingo": 6,
}
_DAY_PATTERN = re.compile(
    r"\b(segunda|terca|quarta|quinta|sexta|sabado|domingo)\b"
)
_TIME_PATTERN = re.compile(r"\b([01]?\d|2[0-3])(?::([0-5]\d))?h?\b")


@dataclass(frozen=True)
class OnlineOrderPolicy:
    accepting_orders: bool
    delivery_enabled: bool
    pickup_enabled: bool
    delivery_fee: float
    reason: str | None = None
    source: str = "automatic"


def _normalize_text(value: Any) -> str:
    raw = unicodedata.normalize("NFD", str(value or ""))
    ascii_text = "".join(char for char in raw if unicodedata.category(char) != "Mn")
    return " ".join(
        ascii_text.casefold().replace("_", " ").replace("-feira", "").split()
    )


def _configured_delivery_fee(configuracao: Any) -> float:
    if configuracao is None:
        return 0.0
    try:
        return max(0.0, float(getattr(configuracao, "taxa_entrega_padrao", 0.0) or 0.0))
    except (TypeError, ValueError):
        return 0.0


def _parse_days(value: Any) -> set[int]:
    normalized = _normalize_text(value)
    if not normalized:
        return set()
    if "todos os dias" in normalized or "todos dias" in normalized:
        return set(range(7))

    names = _DAY_PATTERN.findall(normalized)
    if not names:
        return set()

    indexes = [_DAY_INDEX[name] for name in names]
    if len(indexes) == 2 and re.search(r"\b(?:a|ate)\b", normalized):
        start, end = indexes
        days: set[int] = set()
        current = start
        for _ in range(7):
            days.add(current)
            if current == end:
                break
            current = (current + 1) % 7
        return days

    return set(indexes)


def _parse_hours(value: Any) -> list[tuple[datetime.time, datetime.time]] | None:
    normalized = _normalize_text(value)
    if not normalized:
        return None
    if any(word in normalized for word in ("fechado", "nao abre", "indisponivel")):
        return []
    if normalized in {"24h", "24 horas", "24hrs", "24 hrs"}:
        return [(datetime.time.min, datetime.time.max)]

    matches = _TIME_PATTERN.findall(normalized)
    if len(matches) < 2:
        return None

    times = [
        datetime.time(hour=int(hour), minute=int(minute or 0))
        for hour, minute in matches
    ]
    intervals: list[tuple[datetime.time, datetime.time]] = []
    for index in range(0, len(times) - 1, 2):
        intervals.append((times[index], times[index + 1]))
    return intervals or None


def _decode_structured_schedule(schedule: Any) -> Any:
    if not isinstance(schedule, str):
        return schedule
    try:
        return json.loads(schedule)
    except (TypeError, ValueError, json.JSONDecodeError):
        return schedule


def _schedule_entries(schedule: Any) -> list[tuple[Any, Any]]:
    schedule = _decode_structured_schedule(schedule)
    if isinstance(schedule, dict):
        return list(schedule.items())
    if not isinstance(schedule, list):
        return []

    entries: list[tuple[Any, Any]] = []
    for item in schedule:
        if not isinstance(item, dict):
            continue
        days = item.get("days", item.get("dias"))
        hours = item.get("hours", item.get("horas", item.get("horario")))
        entries.append((days, hours))
    return entries


def schedule_is_open(
    schedule: Any,
    *,
    now: datetime.datetime | None = None,
) -> bool | None:
    """Retorna True/False para agenda válida e None quando não há agenda interpretável.

    Intervalos que atravessam a meia-noite são avaliados também pelo dia anterior,
    por exemplo segunda 18:00-02:00 continua aberto terça às 01:00.
    """

    local_now = now or get_operational_now()
    weekday = local_now.weekday()
    previous_weekday = (weekday - 1) % 7
    current_time = local_now.timetz().replace(tzinfo=None)
    parsed_any = False

    for days_raw, hours_raw in _schedule_entries(schedule):
        days = _parse_days(days_raw)
        intervals = _parse_hours(hours_raw)
        if not days or intervals is None:
            continue
        parsed_any = True

        for start, end in intervals:
            if start <= end:
                if weekday in days and start <= current_time <= end:
                    return True
                continue

            if weekday in days and current_time >= start:
                return True
            if previous_weekday in days and current_time <= end:
                return True

    return False if parsed_any else None


def _infer_open_cash_shift(restaurante: Any) -> bool:
    """Detecta turno aberto quando o restaurante veio anexado a uma sessão ORM.

    A rota pública já carrega o Restaurante pela sessão tenant-aware. Manter a
    detecção aqui deixa a precedência da política centralizada e preserva
    chamadas unitárias com objetos simples, que continuam assumindo caixa
    fechado quando não há sessão disponível.
    """

    restaurante_id = getattr(restaurante, "id", None)
    if not restaurante_id:
        return False

    try:
        db = object_session(restaurante)
    except UnmappedInstanceError:
        return False
    if db is None:
        return False

    return db.query(CaixaTurno.id).filter(
        CaixaTurno.restaurante_id == restaurante_id,
        CaixaTurno.status == "aberto",
    ).first() is not None


def evaluate_online_order_policy(
    restaurante: Any,
    configuracao: Any = None,
    *,
    modalidade: str | None = None,
    now: datetime.datetime | None = None,
    cash_open: bool | None = None,
) -> OnlineOrderPolicy:
    """Calcula se o servidor aceita um novo pedido e qual taxa deve aplicar.

    Precedência operacional:
    1. Forçado Fechado bloqueia sempre;
    2. Forçado Aberto ignora apenas a agenda;
    3. Caixa aberto ignora apenas a agenda;
    4. sem override operacional, vale o horário cadastrado.

    Restrições específicas, como delivery desativado, continuam valendo mesmo
    com caixa aberto.
    """

    override = _normalize_text(getattr(restaurante, "status_override", "automatico"))
    configured_delivery = (
        getattr(configuracao, "delivery_ativo", True)
        if configuracao is not None
        else True
    )
    delivery_fee = _configured_delivery_fee(configuracao)
    # Bancos legados podem conter NULL antes do default atual. Somente False
    # explícito representa uma decisão do restaurante de desligar o delivery.
    delivery_enabled = configured_delivery is not False
    pickup_enabled = True

    if "forcado fechado" in override or override == "fechado":
        return OnlineOrderPolicy(
            accepting_orders=False,
            delivery_enabled=delivery_enabled,
            pickup_enabled=pickup_enabled,
            delivery_fee=delivery_fee,
            reason="O restaurante está fechado para novos pedidos online no momento.",
            source="forced_closed",
        )

    forced_open = "forcado aberto" in override or override == "aberto"
    cash_shift_open = _infer_open_cash_shift(restaurante) if cash_open is None else cash_open
    operational_open = forced_open or cash_shift_open

    if not operational_open:
        schedule_state = schedule_is_open(
            getattr(restaurante, "horarios_funcionamento", None),
            now=now,
        )
        if schedule_state is False:
            return OnlineOrderPolicy(
                accepting_orders=False,
                delivery_enabled=delivery_enabled,
                pickup_enabled=pickup_enabled,
                delivery_fee=delivery_fee,
                reason="O restaurante está fora do horário de pedidos online.",
                source="schedule",
            )

    normalized_mode = _normalize_text(modalidade)
    if normalized_mode == "delivery" and not delivery_enabled:
        return OnlineOrderPolicy(
            accepting_orders=False,
            delivery_enabled=False,
            pickup_enabled=pickup_enabled,
            delivery_fee=delivery_fee,
            reason="O delivery está desativado para este restaurante.",
            source="delivery_disabled",
        )

    source = "automatic"
    if forced_open:
        source = "forced_open"
    elif cash_shift_open:
        source = "cash_open"

    return OnlineOrderPolicy(
        accepting_orders=True,
        delivery_enabled=delivery_enabled,
        pickup_enabled=pickup_enabled,
        delivery_fee=delivery_fee,
        source=source,
    )
"""Persistência mínima de registros de acesso à aplicação.

Guarda somente IP cifrado e data/hora. A limpeza mantém seis meses-calendário,
sem usar o log como analytics, CRM ou auditoria de comportamento.
"""

from __future__ import annotations

import calendar
import datetime
import logging
import threading
import time

from sqlalchemy import delete

from ..database import SessionLocal
from ..models import ApplicationAccessLog

logger = logging.getLogger("koma.access_logs")

_CLEANUP_INTERVAL_SECONDS = 24 * 60 * 60
_cleanup_lock = threading.Lock()
_last_cleanup_monotonic = 0.0


def six_calendar_months_before(
    value: datetime.datetime,
) -> datetime.datetime:
    """Subtrai seis meses-calendário preservando timezone e horário."""
    month_index = value.year * 12 + (value.month - 1) - 6
    year, month_zero = divmod(month_index, 12)
    month = month_zero + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return value.replace(year=year, month=month, day=day)


def _cleanup_due(now_monotonic: float) -> bool:
    global _last_cleanup_monotonic
    with _cleanup_lock:
        if (
            _last_cleanup_monotonic > 0
            and now_monotonic - _last_cleanup_monotonic
            < _CLEANUP_INTERVAL_SECONDS
        ):
            return False
        # Reserva a janela para evitar várias limpezas concorrentes no processo.
        _last_cleanup_monotonic = now_monotonic
        return True


def record_application_access(
    ip_address: str,
    *,
    accessed_at: datetime.datetime | None = None,
) -> None:
    """Persiste um acesso e aplica retenção de seis meses quando necessário."""
    now = accessed_at or datetime.datetime.now(datetime.timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=datetime.timezone.utc)

    db = SessionLocal()
    cleanup_reserved = False
    try:
        db.add(
            ApplicationAccessLog(
                ip_address=(ip_address or "unknown")[:128],
                accessed_at=now,
            )
        )

        cleanup_reserved = _cleanup_due(time.monotonic())
        if cleanup_reserved:
            cutoff = six_calendar_months_before(now)
            db.execute(
                delete(ApplicationAccessLog).where(
                    ApplicationAccessLog.accessed_at < cutoff
                )
            )

        db.commit()
    except Exception:
        db.rollback()
        if cleanup_reserved:
            global _last_cleanup_monotonic
            with _cleanup_lock:
                _last_cleanup_monotonic = 0.0
        logger.exception("Falha ao persistir registro mínimo de acesso")
        raise
    finally:
        db.close()

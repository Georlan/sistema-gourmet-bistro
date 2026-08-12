import datetime
import os
from typing import Optional
from zoneinfo import ZoneInfo

# Fuso horário operacional do restaurante (Padrão: America/Fortaleza ou America/Sao_Paulo)
DEFAULT_TIMEZONE_NAME = os.getenv("KOMA_PRINT_TIMEZONE", os.getenv("KOMA_TIMEZONE", "America/Fortaleza"))

try:
    OPERATIONAL_TIMEZONE = ZoneInfo(DEFAULT_TIMEZONE_NAME)
except Exception:
    OPERATIONAL_TIMEZONE = ZoneInfo("America/Fortaleza")


def get_operational_now() -> datetime.datetime:
    """Retorna o datetime atual no fuso horário operacional do restaurante."""
    return datetime.datetime.now(OPERATIONAL_TIMEZONE)


def to_operational_local_time(dt: Optional[datetime.datetime]) -> Optional[datetime.datetime]:
    """
    Converte qualquer datetime (naive em UTC ou timezone-aware) para o fuso horário operacional local.
    """
    if dt is None:
        return None
    if not isinstance(dt, datetime.datetime):
        return dt
    if dt.tzinfo is None:
        # Se for naive (sem fuso), assume UTC conforme padrão do DB do Kôma
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.astimezone(OPERATIONAL_TIMEZONE)


def format_operational_time(dt: Optional[datetime.datetime], fmt: str = "%H:%M") -> str:
    """Formata um datetime no fuso horário operacional local."""
    if dt is None:
        return ""
    local_dt = to_operational_local_time(dt)
    return local_dt.strftime(fmt) if local_dt else ""

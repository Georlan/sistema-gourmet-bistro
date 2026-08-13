import datetime
import os
from typing import Optional
from zoneinfo import ZoneInfo

# KOMA_TIMEZONE é a fonte única para tela, relatórios e impressão. A variável
# legada de impressão permanece apenas como fallback para instalações antigas.
DEFAULT_TIMEZONE_NAME = os.getenv(
    "KOMA_TIMEZONE",
    os.getenv("KOMA_PRINT_TIMEZONE", "America/Fortaleza"),
)

try:
    OPERATIONAL_TIMEZONE = ZoneInfo(DEFAULT_TIMEZONE_NAME)
except Exception:
    OPERATIONAL_TIMEZONE = ZoneInfo("America/Fortaleza")


def get_operational_now() -> datetime.datetime:
    """Retorna o datetime atual no fuso horário operacional do restaurante."""
    return datetime.datetime.now(OPERATIONAL_TIMEZONE)


def get_utc_now() -> datetime.datetime:
    """Retorna o instante atual em UTC, sempre timezone-aware."""
    return datetime.datetime.now(datetime.timezone.utc)


def to_utc(dt: Optional[datetime.datetime]) -> Optional[datetime.datetime]:
    """Normaliza timestamps persistidos para UTC.

    Colunas legadas ``DateTime`` podem voltar sem tzinfo no SQLite e no
    PostgreSQL. O Kôma persiste esses valores em UTC, portanto um valor naive
    vindo do banco nunca deve ser interpretado no fuso do servidor.
    """
    if dt is None:
        return None
    if not isinstance(dt, datetime.datetime):
        return dt
    if dt.tzinfo is None:
        return dt.replace(tzinfo=datetime.timezone.utc)
    return dt.astimezone(datetime.timezone.utc)


def to_database_utc(dt: Optional[datetime.datetime]) -> Optional[datetime.datetime]:
    """Adapta um instante às colunas legadas ``timestamp without time zone``."""
    utc_dt = to_utc(dt)
    return utc_dt.replace(tzinfo=None) if utc_dt is not None else None


def to_operational_local_time(dt: Optional[datetime.datetime]) -> Optional[datetime.datetime]:
    """
    Converte qualquer datetime (naive em UTC ou timezone-aware) para o fuso horário operacional local.
    """
    if dt is None:
        return None
    if not isinstance(dt, datetime.datetime):
        return dt
    utc_dt = to_utc(dt)
    return utc_dt.astimezone(OPERATIONAL_TIMEZONE)


def elapsed_minutes_since(
    dt: Optional[datetime.datetime],
    *,
    now: Optional[datetime.datetime] = None,
) -> int:
    """Calcula duração por instante UTC, independente do fuso do servidor."""
    utc_dt = to_utc(dt)
    if utc_dt is None:
        return 0
    utc_now = to_utc(now) if now is not None else get_utc_now()
    return max(0, int((utc_now - utc_dt).total_seconds() // 60))


def operational_day_bounds_utc(
    day: Optional[datetime.date] = None,
) -> tuple[datetime.datetime, datetime.datetime]:
    """Retorna [início, próximo início) do dia operacional convertido para UTC."""
    target_day = day or get_operational_now().date()
    local_start = datetime.datetime.combine(
        target_day,
        datetime.time.min,
        tzinfo=OPERATIONAL_TIMEZONE,
    )
    local_end = local_start + datetime.timedelta(days=1)
    return (
        local_start.astimezone(datetime.timezone.utc),
        local_end.astimezone(datetime.timezone.utc),
    )


def parse_operational_filter_datetime(
    value: Optional[str],
    *,
    end_of_day: bool = False,
) -> Optional[datetime.datetime]:
    """Converte filtros enviados pela interface em um instante UTC.

    Datas sem horário representam um dia do restaurante, não um dia UTC.
    ISO com offset mantém o instante informado. ISO naive é tratado como hora
    operacional, pois é uma entrada de interface e não um valor lido do banco.
    """
    if not value:
        return None
    raw = value.strip()
    if not raw:
        return None
    try:
        if len(raw) == 10:
            day = datetime.date.fromisoformat(raw)
            start, next_start = operational_day_bounds_utc(day)
            return next_start if end_of_day else start

        parsed = datetime.datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=OPERATIONAL_TIMEZONE)
        return parsed.astimezone(datetime.timezone.utc)
    except (TypeError, ValueError):
        return None


def format_operational_time(dt: Optional[datetime.datetime], fmt: str = "%H:%M") -> str:
    """Formata um datetime no fuso horário operacional local."""
    if dt is None:
        return ""
    local_dt = to_operational_local_time(dt)
    return local_dt.strftime(fmt) if local_dt else ""

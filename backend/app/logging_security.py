import logging
import re
from collections.abc import Mapping
from typing import Any


_SENSITIVE_QUERY_VALUE = re.compile(
    r"([?&](?:token|access_token|authorization)=)[^&\s\"']+",
    flags=re.IGNORECASE,
)


def redact_sensitive_query_values(value: str) -> str:
    return _SENSITIVE_QUERY_VALUE.sub(r"\1[REDACTED]", value)


def _redact_log_argument(value: Any) -> Any:
    if isinstance(value, str):
        return redact_sensitive_query_values(value)
    return value


class SensitiveQueryFilter(logging.Filter):
    """Remove credenciais de URLs antes que handlers as gravem ou exportem."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = redact_sensitive_query_values(record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(_redact_log_argument(value) for value in record.args)
        elif isinstance(record.args, Mapping):
            record.args = {
                key: _redact_log_argument(value)
                for key, value in record.args.items()
            }
        return True


def install_sensitive_query_log_filter() -> None:
    """Protege logs HTTP/WebSocket, inclusive clientes antigos com token na URL."""

    for logger_name in ("uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(logger_name)
        if not any(isinstance(item, SensitiveQueryFilter) for item in logger.filters):
            logger.addFilter(SensitiveQueryFilter())

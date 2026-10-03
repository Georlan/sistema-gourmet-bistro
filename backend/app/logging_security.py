import logging
import re
import sys
from collections.abc import Mapping
from typing import Any


_SENSITIVE_QUERY_VALUE = re.compile(
    r"([?&](?:token|access_token|authorization)=)[^&\s\"']+",
    flags=re.IGNORECASE,
)


_TRACKING_PATH_TOKEN = re.compile(r"(/(?:api/cardapio/pedidos/)?acompanhar/)[^/\s?\"']+", flags=re.IGNORECASE)


def redact_sensitive_query_values(value: str) -> str:
    value = _TRACKING_PATH_TOKEN.sub(r"\1[REDACTED]", value)
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


class _TransportInformation(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return record.levelno < logging.WARNING


class _TransportWarnings(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return record.levelno >= logging.WARNING


def _route_transport_information_to_stdout() -> None:
    # Uvicorn's error logger inherits its stderr handler from `uvicorn`.
    # Railway labels that stream as error even for normal WebSocket INFO.
    logger = logging.getLogger("uvicorn")
    if any(getattr(handler, "_koma_transport_stdout", False) for handler in logger.handlers):
        return
    for handler in tuple(logger.handlers):
        if isinstance(handler, logging.StreamHandler) and handler.stream is sys.stderr:
            stdout = logging.StreamHandler(sys.stdout)
            stdout.setLevel(handler.level)
            stdout.setFormatter(handler.formatter)
            stdout.addFilter(_TransportInformation())
            stdout._koma_transport_stdout = True
            handler.addFilter(_TransportWarnings())
            logger.addHandler(stdout)
            return


def install_sensitive_query_log_filter() -> None:
    """Protege logs HTTP/WebSocket, inclusive clientes antigos com token na URL."""

    for logger_name in ("uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(logger_name)
        if not any(isinstance(item, SensitiveQueryFilter) for item in logger.filters):
            logger.addFilter(SensitiveQueryFilter())
    _route_transport_information_to_stdout()

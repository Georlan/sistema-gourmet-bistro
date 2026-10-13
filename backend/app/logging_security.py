import logging
import re
import sys


# Compare decoded parameter names; never decode the whole URL into log text.
_SENSITIVE_QUERY_KEYS = frozenset({
    "token", "access_token", "refresh_token", "client_secret", "authorization",
    "code", "state", "api_key", "apikey", "password", "senha",
    "telefone", "phone", "phone_number", "celular", "whatsapp",
    "email", "e_mail", "cpf", "cnpj", "documento", "document", "document_number",
    "nome", "name", "endereco", "address", "cliente_id", "customer_id",
    "usuario_id", "user_id", "cliente_telefone", "cliente_nome", "cliente_email",
    "cpf_cliente", "nome_cliente", "customer_phone", "customer_email", "customer_name",
})
_QUERY_VALUE = re.compile(r"([?&])([^=?&\s\"']+)=([^&\s\"']*)")


def _redact_query_match(match: re.Match) -> str:
    from urllib.parse import unquote_plus

    key = unquote_plus(match[2]).lower().replace("-", "_")
    if key in _SENSITIVE_QUERY_KEYS:
        return f"{match[1]}{match[2]}=[REDACTED]"
    return match[0]


_TRACKING_PATH_TOKEN = re.compile(r"(/(?:api/cardapio/pedidos/)?acompanhar/)[^/\s?\"']+", flags=re.IGNORECASE)


def redact_sensitive_query_values(value: str) -> str:
    value = _TRACKING_PATH_TOKEN.sub(r"\1[REDACTED]", value)
    return _QUERY_VALUE.sub(_redact_query_match, value)


class SensitiveQueryFilter(logging.Filter):
    """Remove credenciais e identificadores pessoais das URLs de log."""

    def filter(self, record: logging.LogRecord) -> bool:
        # Uvicorn's AccessFormatter consumes the five original arguments.
        if record.name == "uvicorn.access" and isinstance(record.args, tuple) and len(record.args) == 5:
            record.args = tuple(
                redact_sensitive_query_values(value) if isinstance(value, str) else value
                for value in record.args
            )
            return True
        # Render first: URL values can themselves be formatting placeholders.
        record.msg = redact_sensitive_query_values(record.getMessage())
        record.args = ()
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
    # Handler filters also cover application/HTTP-client records propagated here.
    for logger_name in ("", "uvicorn", "uvicorn.error", "uvicorn.access"):
        for handler in logging.getLogger(logger_name).handlers:
            if not any(isinstance(item, SensitiveQueryFilter) for item in handler.filters):
                handler.addFilter(SensitiveQueryFilter())

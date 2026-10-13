import io
import logging

import pytest

from app.logging_security import (
    SensitiveQueryFilter,
    install_sensitive_query_log_filter,
    redact_sensitive_query_values,
)


@pytest.mark.parametrize('key', [
    'telefone', 'PHONE', 'phone_number', 'email', 'cpf', 'cnpj', 'documento',
    'nome', 'endereco', 'cliente_id', 'customer_id', 'cliente_telefone',
    'cpf_cliente', 'password', 'senha', 'api_key', 'access_token', 'token',
    'code', 'state', '%74elefone', 'customer%5Femail',
])
def test_sensitive_url_values_are_removed_without_losing_operational_fields(key):
    result = redact_sensitive_query_values(
        f'/lookup?{key}=synthetic-private-value&restaurante_id=42&page=2&{key}=second-value'
    )
    assert 'synthetic-private-value' not in result
    assert 'second-value' not in result
    assert 'restaurante_id=42&page=2' in result
    assert result.count('[REDACTED]') == 2
    assert redact_sensitive_query_values(result) == result


def test_rendered_url_and_mapping_arguments_are_sanitized():
    for msg, args in [
        ('GET /lookup?telefone=%s&token=%s', ('fixture-phone', 'fixture-token')),
        ('GET /lookup?email=%(email)s', ({'email': 'fixture@example.test'},)),
    ]:
        record = logging.LogRecord('uvicorn.access', 20, __file__, 1, msg, args, None)
        SensitiveQueryFilter().filter(record)
        assert 'fixture' not in record.getMessage()
        assert '[REDACTED]' in record.getMessage()


def test_application_child_records_are_filtered_by_existing_root_handler():
    output = io.StringIO()
    handler = logging.StreamHandler(output)
    root = logging.getLogger()
    root.addHandler(handler)
    try:
        install_sensitive_query_log_filter()
        install_sensitive_query_log_filter()
        assert sum(isinstance(f, SensitiveQueryFilter) for f in handler.filters) == 1
        logging.getLogger('koma.privacy-test').warning('/lookup?telefone=fixture-phone')
        assert 'fixture-phone' not in output.getvalue()
        assert '[REDACTED]' in output.getvalue()
    finally:
        root.removeHandler(handler)


def test_uvicorn_access_formatter_preserves_status_and_sanitizes_target():
    from uvicorn.logging import AccessFormatter

    record = logging.LogRecord('uvicorn.access', 20, __file__, 1,
                               '%s - "%s %s HTTP/%s" %d',
                               ('127.0.0.1:1234', 'GET', '/lookup?telefone=fixture-phone&token=fixture-token', '1.1', 200), None)
    SensitiveQueryFilter().filter(record)
    formatter = AccessFormatter('%(client_addr)s - "%(request_line)s" %(status_code)s', use_colors=False)
    output = formatter.format(record)
    assert 'fixture-' not in output
    assert '200' in output and 'GET /lookup?' in output

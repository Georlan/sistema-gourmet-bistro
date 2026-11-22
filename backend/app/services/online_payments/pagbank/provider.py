from __future__ import annotations

import datetime
import logging
import re
from decimal import Decimal

import httpx

from ....config import settings
from ....tax_ids import is_valid_cpf, is_valid_cnpj
from ..base import ProviderPayment, ProviderRefund
from ..mercado_pago import MercadoPagoError
from .oauth import api_url

logger = logging.getLogger(__name__)


def _failure_metadata(response: httpx.Response) -> tuple[str, dict[str, str | None]]:
    """Keep only provider identifiers, never arbitrary response text or PII."""
    request_id = next((response.headers.get(key) for key in
                       ('x-request-id', 'x-amzn-requestid', 'x-amz-apigw-id')
                       if response.headers.get(key)), '')
    if not re.fullmatch(r'[A-Za-z0-9._:-]{1,80}', request_id):
        request_id = ''
    code = ''
    parameter = ''
    try:
        data = response.json()
        errors = data.get('error_messages', []) if isinstance(data, dict) else []
        first_error = errors[0] if isinstance(errors, list) and errors and isinstance(errors[0], dict) else {}
        candidate = first_error.get('code', '')
        if isinstance(candidate, str) and re.fullmatch(r'[A-Z0-9_-]{1,64}', candidate):
            code = candidate
        # Never log arbitrary PagBank messages or input values: those may contain buyer PII.
        # Only capture a syntactically valid field path rooted in the documented Order schema.
        candidate = first_error.get('parameter_name', '')
        if isinstance(candidate, str) and re.fullmatch(
            r'(?:reference_id|customer|items|charges|notification_urls)'
            r'(?:\[\d{1,2}\]|\.(?:reference_id|name|email|tax_id|quantity|unit_amount|'
            r'description|amount|value|currency|payment_method|type|pix|expiration_date)){0,12}',
            candidate
        ):
            parameter = candidate
    except (ValueError, TypeError):
        pass
    logger.warning('PagBank API failure status=%s provider_code=%s provider_parameter=%s provider_request_id=%s',
                   response.status_code, code or 'unavailable', parameter or 'unavailable',
                   request_id or 'unavailable')
    reference = ''.join((f' Código: {code}.' if code else '', f' Referência PagBank: {request_id}.' if request_id else ''))
    metadata = {
        'provider_code': code or None,
        'provider_parameter': parameter or None,
        'provider_request_id': request_id or None,
    }
    return reference, metadata


def _failure_reference(response: httpx.Response) -> str:
    return _failure_metadata(response)[0]


class PagBankError(MercadoPagoError):
    """Compatible with existing payment-boundary error handling."""

    def __init__(
        self,
        message: str,
        *,
        reason: str | None = None,
        status_code: int | None = None,
        retryable: bool = False,
        error_stage: str | None = None,
        provider_code: str | None = None,
        provider_parameter: str | None = None,
        provider_request_id: str | None = None,
    ):
        super().__init__(
            message,
            status_code=status_code,
            retryable=retryable,
            error_stage=error_stage,
            provider_code=provider_code,
            provider_parameter=provider_parameter,
            provider_request_id=provider_request_id,
        )
        self.reason = reason


def _customer_email_rejected(response: httpx.Response) -> bool:
    """Classify only the bank's allowlisted 40001/40002 customer.email error.

    Never consume or expose its free-form descriptions, buyer address or payload.
    The provider might reject a merchant's own email even when syntactically valid.
    """
    if response.status_code != 400:
        return False
    try:
        data = response.json()
    except (ValueError, TypeError):
        return False
    if not isinstance(data, dict):
        return False
    errors = data.get('error_messages')
    if not isinstance(errors, list):
        return False
    return any(
        isinstance(item, dict)
        and str(item.get('code') or '') in {'40001', '40002'}
        and item.get('parameter_name') == 'customer.email'
        for item in errors[:5]
    )


def cents(amount: Decimal) -> int:
    value = Decimal(str(amount))
    if not value.is_finite() or value <= 0 or value * 100 != (value * 100).to_integral_value():
        raise PagBankError('Valor Pix inválido.', error_stage='create_preflight')
    return int(value * 100)


def identifier(value: str, prefix='ORDE') -> str:
    if not re.fullmatch(prefix + r'_[A-Za-z0-9-]{1,64}', value or ''):
        raise PagBankError('Identificador PagBank inválido.')
    return value


_EMAIL_LOCAL_PATTERN = re.compile(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+")
_EMAIL_DOMAIN_LABEL_PATTERN = re.compile(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?')
_EMAIL_TLD_PATTERN = re.compile(r'[A-Za-z]{2,24}')


def valid_order_payer_email(value: str | None) -> bool:
    """Validate the documented PagBank Order customer.email contract without logging PII."""
    if not isinstance(value, str):
        return False
    email = value.strip()
    if not (6 <= len(email) <= 255) or not email.isascii():
        return False
    if any(ch.isspace() or ord(ch) < 32 for ch in email) or email.count('@') != 1:
        return False
    local, domain = email.split('@', 1)
    if (
        not local
        or len(local) > 64
        or local.startswith('.')
        or local.endswith('.')
        or '..' in local
        or _EMAIL_LOCAL_PATTERN.fullmatch(local) is None
    ):
        return False
    if not domain or len(domain) > 253 or '..' in domain or '.' not in domain:
        return False
    labels = domain.split('.')
    if any(_EMAIL_DOMAIN_LABEL_PATTERN.fullmatch(label) is None for label in labels):
        return False
    return _EMAIL_TLD_PATTERN.fullmatch(labels[-1]) is not None


class PagBankProvider:
    def __init__(self, access_token: str, *, environment: str | None = None):
        if not access_token:
            raise PagBankError('Reconecte a conta PagBank.')
        self._client = httpx.Client(base_url=api_url(environment), headers={'Authorization': f'Bearer {access_token}'},
                                   timeout=settings.ONLINE_PAYMENT_REQUEST_TIMEOUT_SECONDS)

    def _request(self, method, path, **kwargs):
        is_order_create = method == 'POST' and path == '/orders'
        try:
            response = self._client.request(method, path, **kwargs)
            reference, meta = (
                _failure_metadata(response)
                if response.is_error
                else ('', {'provider_code': None, 'provider_parameter': None, 'provider_request_id': None})
            )
            if is_order_create and _customer_email_rejected(response):
                raise PagBankError(
                    'E-mail do comprador rejeitado pelo PagBank.' + reference,
                    reason='customer_email_rejected',
                    status_code=400,
                    error_stage='create_refused',
                    provider_code=meta['provider_code'] or '40002',
                    provider_parameter='customer.email',
                    provider_request_id=meta['provider_request_id'],
                )
            if response.status_code == 403:
                raise PagBankError(
                    'PagBank recusou a criação/consulta da cobrança (HTTP 403). Verifique a liberação da API Order/Pix e as permissões da aplicação e da conta conectada.' + reference,
                    status_code=403,
                    error_stage='create_refused' if is_order_create else 'reconcile_failed',
                    **meta,
                )
            if response.is_error:
                retryable = response.status_code >= 500 or response.status_code in {408, 429}
                stage = (
                    ('create_uncertain' if retryable else 'create_refused')
                    if is_order_create
                    else 'reconcile_failed'
                )
                raise PagBankError(
                    f'PagBank recusou a operação (HTTP {response.status_code}).' + reference,
                    status_code=response.status_code,
                    retryable=retryable,
                    error_stage=stage,
                    **meta,
                )
            data = response.json()
            if not isinstance(data, dict):
                raise ValueError()
            return data
        except (httpx.HTTPError, ValueError) as exc:
            raise PagBankError(
                'Resposta PagBank indisponível ou inválida.',
                retryable=True,
                error_stage='create_uncertain' if is_order_create else 'reconcile_failed',
            ) from exc

    @staticmethod
    def _map(data):
        charges = data.get('charges') or []
        if len(charges) != 1 or charges[0].get('payment_method', {}).get('type') != 'PIX':
            raise PagBankError('Cobrança PagBank não corresponde a um Pix único.')
        charge = charges[0]
        amount = charge.get('amount') or {}
        if amount.get('currency') != 'BRL' or not isinstance(amount.get('value'), int):
            raise PagBankError('Moeda ou valor PagBank inválido.')
        status = {'PAID': 'approved', 'WAITING': 'pending', 'IN_ANALYSIS': 'pending',
                  'DECLINED': 'rejected', 'CANCELED': 'cancelled'}.get(charge.get('status'), 'pending')
        summary = amount.get('summary') or {}
        if status == 'approved' and 'paid' in summary and summary['paid'] != amount['value']:
            raise PagBankError('PagBank não confirmou o valor integral do Pix.')
        if summary.get('refunded', 0) >= amount['value']:
            status = 'refunded'
        expiry = charge.get('payment_method', {}).get('pix', {}).get('expiration_date')
        qr = charge.get('qr_code') or {}
        return ProviderPayment(external_id=identifier(data.get('id')), status=status,
                               amount=Decimal(amount['value']) / 100, external_reference=str(data.get('reference_id') or ''),
                               qr_code=qr.get('text'), expires_at=datetime.datetime.fromisoformat(expiry.replace('Z', '+00:00')) if expiry else None)

    def create_pix(self, *, amount, marketplace_fee, payer_email, external_reference, idempotency_key,
                   notification_url, expires_at, payer_name=None, payer_tax_id=None):
        if marketplace_fee != 0:
            raise PagBankError('PagBank no KÔMA não cobra taxa de plataforma.', error_stage='create_preflight')
        if not payer_name or not (is_valid_cpf(payer_tax_id) or is_valid_cnpj(payer_tax_id)):
            raise PagBankError('Informe nome e CPF/CNPJ do comprador para gerar o Pix PagBank.', error_stage='create_preflight')
        # Defense in depth: do not send malformed email to the provider or log buyer PII.
        if not valid_order_payer_email(payer_email):
            raise PagBankError('Informe um e-mail válido para gerar o Pix PagBank.', error_stage='create_preflight')
        # Validation trims surrounding whitespace; send the same canonical value.
        payer_email = payer_email.strip()
        expiration_date = expires_at.astimezone(datetime.timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
        data = self._request('POST', '/orders', headers={'x-idempotency-key': idempotency_key}, json={
            'reference_id': external_reference,
            'customer': {'name': payer_name, 'email': payer_email, 'tax_id': payer_tax_id},
            'items': [{'name': 'Pedido KOMA', 'quantity': 1, 'unit_amount': cents(amount)}],
            'charges': [{'reference_id': external_reference, 'amount': {'value': cents(amount), 'currency': 'BRL'},
                         'payment_method': {'type': 'PIX', 'pix': {'expiration_date': expiration_date}}}],
            'notification_urls': [notification_url],
        })
        payment = self._map(data)
        if payment.status == 'pending' and not payment.qr_code:
            raise PagBankError('PagBank não retornou o código Pix.', retryable=True, error_stage='create_uncertain')
        return payment

    def get_payment(self, external_payment_id):
        return self._map(self._request('GET', f'/orders/{identifier(external_payment_id)}'))

    def cancel_payment(self, external_payment_id):
        # Order API has no safe pending-Pix cancellation. Never invent a cancellation.
        return self.get_payment(external_payment_id)

    def refund_payment(self, external_payment_id, *, amount, idempotency_key) -> ProviderRefund:
        raise PagBankError('Devoluções PagBank pelo KÔMA ainda não estão habilitadas. Use a conta PagBank e concilie o recebimento.')

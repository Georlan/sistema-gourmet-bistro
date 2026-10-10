from __future__ import annotations

import datetime
import re
from decimal import Decimal

import httpx

from ....config import settings
from ....tax_ids import is_valid_cpf, is_valid_cnpj
from ..base import ProviderPayment, ProviderRefund
from ..mercado_pago import MercadoPagoError
from .oauth import api_url


class PagBankError(MercadoPagoError):
    """Compatible with existing payment-boundary error handling."""


def cents(amount: Decimal) -> int:
    value = Decimal(str(amount))
    if not value.is_finite() or value <= 0 or value * 100 != (value * 100).to_integral_value():
        raise PagBankError('Valor Pix inválido.')
    return int(value * 100)


def identifier(value: str, prefix='ORDE') -> str:
    if not re.fullmatch(prefix + r'_[A-Za-z0-9-]{1,64}', value or ''):
        raise PagBankError('Identificador PagBank inválido.')
    return value


class PagBankProvider:
    def __init__(self, access_token: str):
        if not access_token:
            raise PagBankError('Reconecte a conta PagBank.')
        self._client = httpx.Client(base_url=api_url(), headers={'Authorization': f'Bearer {access_token}'},
                                   timeout=settings.ONLINE_PAYMENT_REQUEST_TIMEOUT_SECONDS)

    def _request(self, method, path, **kwargs):
        try:
            response = self._client.request(method, path, **kwargs)
            if response.is_error:
                raise PagBankError(f'PagBank recusou a operação (HTTP {response.status_code}).',
                                   status_code=response.status_code, retryable=response.status_code >= 500 or response.status_code in {408, 429})
            data = response.json()
            if not isinstance(data, dict):
                raise ValueError()
            return data
        except (httpx.HTTPError, ValueError) as exc:
            raise PagBankError('Resposta PagBank indisponível ou inválida.', retryable=True) from exc

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
            raise PagBankError('PagBank no KÔMA não cobra taxa de plataforma.')
        if not payer_name or not (is_valid_cpf(payer_tax_id) or is_valid_cnpj(payer_tax_id)):
            raise PagBankError('Informe nome e CPF/CNPJ do comprador para gerar o Pix PagBank.')
        data = self._request('POST', '/orders', headers={'x-idempotency-key': idempotency_key}, json={
            'reference_id': external_reference,
            'customer': {'name': payer_name, 'email': payer_email, 'tax_id': payer_tax_id},
            'items': [{'name': 'Pedido KOMA', 'quantity': 1, 'unit_amount': cents(amount)}],
            'charges': [{'reference_id': external_reference, 'amount': {'value': cents(amount), 'currency': 'BRL'},
                         'payment_method': {'type': 'PIX', 'pix': {'expiration_date': expires_at.isoformat()}}}],
            'notification_urls': [notification_url],
        })
        payment = self._map(data)
        if payment.status == 'pending' and not payment.qr_code:
            raise PagBankError('PagBank não retornou o código Pix.', retryable=True)
        return payment

    def get_payment(self, external_payment_id):
        return self._map(self._request('GET', f'/orders/{identifier(external_payment_id)}'))

    def cancel_payment(self, external_payment_id):
        # Order API has no safe pending-Pix cancellation. Never invent a cancellation.
        return self.get_payment(external_payment_id)

    def refund_payment(self, external_payment_id, *, amount, idempotency_key) -> ProviderRefund:
        raise PagBankError('Devoluções PagBank pelo KÔMA ainda não estão habilitadas. Use a conta PagBank e concilie o recebimento.')

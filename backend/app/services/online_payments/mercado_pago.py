from __future__ import annotations

import datetime
import re
from decimal import Decimal

import httpx

from ...config import settings
from .base import ProviderPayment, ProviderRefund


class MercadoPagoError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        retryable: bool = False,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.retryable = retryable


_PAYMENT_ID_PATTERN = re.compile(r"[0-9]{1,30}\Z")
_REFUND_ID_PATTERN = re.compile(r"[0-9]{1,30}\Z")


def _parse_datetime(value: object) -> datetime.datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _validated_payment_id(external_payment_id: str) -> int:
    if not _PAYMENT_ID_PATTERN.fullmatch(external_payment_id):
        raise MercadoPagoError("Identificador de pagamento inválido.")
    payment_id = int(external_payment_id, 10)
    if payment_id <= 0:
        raise MercadoPagoError("Identificador de pagamento inválido.")
    return payment_id


def _provider_error_message(response: httpx.Response, action: str) -> str:
    code = None
    try:
        payload = response.json()
    except Exception:
        payload = None
    if isinstance(payload, dict):
        raw_code = payload.get("error") or payload.get("code") or payload.get("message")
        if raw_code:
            code = str(raw_code).strip()
    suffix = f" ({response.status_code})"
    if code:
        suffix += f": {code[:120]}"
    return f"Mercado Pago recusou {action}{suffix}."


class MercadoPagoProvider:
    API_URL = "https://api.mercadopago.com"

    def __init__(self, access_token: str):
        if not access_token:
            raise MercadoPagoError("Conta Mercado Pago sem token de acesso.")
        self._client = httpx.Client(
            base_url=self.API_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=settings.ONLINE_PAYMENT_REQUEST_TIMEOUT_SECONDS,
        )

    @staticmethod
    def _map(payload: dict) -> ProviderPayment:
        transaction = payload.get("point_of_interaction") or {}
        transaction_data = transaction.get("transaction_data") or {}
        return ProviderPayment(
            external_id=str(payload.get("id") or ""),
            status=str(payload.get("status") or "pending"),
            amount=Decimal(str(payload.get("transaction_amount") or "0")),
            external_reference=str(payload.get("external_reference") or ""),
            qr_code=transaction_data.get("qr_code"),
            qr_code_base64=transaction_data.get("qr_code_base64"),
            ticket_url=transaction_data.get("ticket_url"),
            expires_at=_parse_datetime(payload.get("date_of_expiration")),
        )

    @staticmethod
    def _map_refund(payload: dict) -> ProviderRefund:
        return ProviderRefund(
            external_id=str(payload.get("id") or ""),
            payment_id=str(payload.get("payment_id") or ""),
            status=str(payload.get("status") or "pending"),
            amount=Decimal(str(payload.get("amount") or "0")),
        )

    def create_pix(
        self,
        *,
        amount: Decimal,
        marketplace_fee: Decimal,
        payer_email: str,
        external_reference: str,
        idempotency_key: str,
        notification_url: str,
        expires_at: datetime.datetime,
    ) -> ProviderPayment:
        if expires_at.tzinfo is None:
            formatted_expiration = expires_at.replace(
                tzinfo=datetime.timezone.utc
            ).isoformat(timespec="milliseconds")
        else:
            formatted_expiration = expires_at.isoformat(timespec="milliseconds")

        body = {
            "transaction_amount": float(amount),
            "description": "Pedido KOMA",
            "payment_method_id": "pix",
            "payer": {"email": payer_email},
            "external_reference": external_reference,
            "notification_url": notification_url,
            "date_of_expiration": formatted_expiration,
        }
        if marketplace_fee > 0:
            body["application_fee"] = float(marketplace_fee)
        response = self._client.post(
            "/v1/payments",
            headers={"X-Idempotency-Key": idempotency_key},
            json=body,
        )
        if response.status_code >= 400:
            raise MercadoPagoError(
                f"Mercado Pago recusou a criação ({response.status_code}).",
                status_code=response.status_code,
                retryable=response.status_code >= 500 or response.status_code in {408, 409, 429},
            )
        return self._map(response.json())

    def get_payment(self, external_payment_id: str) -> ProviderPayment:
        payment_id = _validated_payment_id(external_payment_id)
        response = self._client.get(f"/v1/payments/{payment_id:d}")
        if response.status_code >= 400:
            raise MercadoPagoError(
                f"Mercado Pago não confirmou o pagamento ({response.status_code}).",
                status_code=response.status_code,
                retryable=response.status_code >= 500 or response.status_code in {408, 409, 429},
            )
        return self._map(response.json())

    def refund_payment(
        self,
        external_payment_id: str,
        *,
        amount: Decimal | None,
        idempotency_key: str,
    ) -> ProviderRefund:
        payment_id = _validated_payment_id(external_payment_id)
        key = (idempotency_key or "").strip()
        if not key or len(key) > 64:
            raise MercadoPagoError("Chave de idempotência do reembolso inválida.")
        if amount is not None and Decimal(str(amount)) <= 0:
            raise MercadoPagoError("Valor de reembolso inválido.")

        body = {} if amount is None else {"amount": float(Decimal(str(amount)))}
        response = self._client.post(
            f"/v1/payments/{payment_id:d}/refunds",
            headers={"X-Idempotency-Key": key},
            json=body,
        )
        if response.status_code >= 400:
            raise MercadoPagoError(
                _provider_error_message(response, "o reembolso"),
                status_code=response.status_code,
                retryable=response.status_code >= 500 or response.status_code in {408, 409, 429},
            )

        refund = self._map_refund(response.json())
        if not _REFUND_ID_PATTERN.fullmatch(refund.external_id):
            raise MercadoPagoError("Mercado Pago retornou um identificador de reembolso inválido.")
        if refund.payment_id and refund.payment_id != str(payment_id):
            raise MercadoPagoError("Mercado Pago retornou um reembolso de outro pagamento.")
        return refund

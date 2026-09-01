from __future__ import annotations

import datetime
import re
from decimal import Decimal

import httpx

from ...config import settings
from .base import ProviderPayment


class MercadoPagoError(RuntimeError):
    pass


_PAYMENT_ID_PATTERN = re.compile(r"[0-9]{1,30}\Z")


def _parse_datetime(value: object) -> datetime.datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


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
        body = {
            "transaction_amount": float(amount),
            "description": "Pedido KOMA",
            "payment_method_id": "pix",
            "payer": {"email": payer_email},
            "external_reference": external_reference,
            "notification_url": notification_url,
            "date_of_expiration": expires_at.isoformat(),
        }
        if marketplace_fee > 0:
            body["application_fee"] = float(marketplace_fee)
        response = self._client.post(
            "/v1/payments",
            headers={"X-Idempotency-Key": idempotency_key},
            json=body,
        )
        if response.status_code >= 400:
            raise MercadoPagoError(f"Mercado Pago recusou a criação ({response.status_code}).")
        return self._map(response.json())

    def get_payment(self, external_payment_id: str) -> ProviderPayment:
        if not _PAYMENT_ID_PATTERN.fullmatch(external_payment_id):
            raise MercadoPagoError("Identificador de pagamento inválido.")
        payment_id = int(external_payment_id, 10)
        if payment_id <= 0:
            raise MercadoPagoError("Identificador de pagamento inválido.")
        response = self._client.get(f"/v1/payments/{payment_id:d}")
        if response.status_code >= 400:
            raise MercadoPagoError(f"Mercado Pago não confirmou o pagamento ({response.status_code}).")
        return self._map(response.json())

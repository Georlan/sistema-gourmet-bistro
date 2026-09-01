from __future__ import annotations

import datetime
from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol


@dataclass(frozen=True)
class ProviderPayment:
    external_id: str
    status: str
    amount: Decimal
    external_reference: str
    qr_code: str | None = None
    qr_code_base64: str | None = None
    ticket_url: str | None = None
    expires_at: datetime.datetime | None = None


class OnlinePaymentProvider(Protocol):
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
    ) -> ProviderPayment: ...

    def get_payment(self, external_payment_id: str) -> ProviderPayment: ...

from __future__ import annotations

import datetime
import os
import uuid

from sqlalchemy.orm import Session

from ...models import RestaurantPaymentAccount
from .oauth import MercadoPagoOAuthTokens


class MercadoPagoAccountConnectionError(RuntimeError):
    """Raised when a connected seller account cannot be persisted safely."""


def configured_webhook_secret() -> str:
    value = os.getenv("MERCADO_PAGO_WEBHOOK_SECRET", "").strip()
    if not value:
        raise MercadoPagoAccountConnectionError(
            "MERCADO_PAGO_WEBHOOK_SECRET não configurado."
        )
    return value


def _expires_at(expires_in: int | None) -> datetime.datetime | None:
    if expires_in is None or expires_in <= 0:
        return None
    return datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(
        seconds=expires_in
    )


def upsert_mercado_pago_account(
    db: Session,
    *,
    restaurant_id: int,
    tokens: MercadoPagoOAuthTokens,
    webhook_secret: str | None = None,
) -> RestaurantPaymentAccount:
    """
    Materializa a conta OAuth do vendedor no tenant atual.

    O chamador controla transação e contexto RLS. O helper deliberadamente usa
    `flush()` em vez de `commit()` para que troca de tokens e demais efeitos do
    callback sejam atômicos.
    """
    if int(restaurant_id) <= 0:
        raise MercadoPagoAccountConnectionError("restaurant_id inválido.")

    secret = (webhook_secret or configured_webhook_secret()).strip()
    if not secret:
        raise MercadoPagoAccountConnectionError("Webhook secret inválido.")

    account = (
        db.query(RestaurantPaymentAccount)
        .filter(
            RestaurantPaymentAccount.restaurante_id == int(restaurant_id),
            RestaurantPaymentAccount.provider == "mercado_pago",
        )
        .first()
    )

    if account is None:
        account = RestaurantPaymentAccount(
            id=str(uuid.uuid4()),
            restaurante_id=int(restaurant_id),
            provider="mercado_pago",
        )
        db.add(account)

    account.provider_user_id = tokens.provider_user_id
    account.status = "active"
    account.access_token = tokens.access_token
    if tokens.refresh_token:
        account.refresh_token = tokens.refresh_token
    account.webhook_secret = secret
    if tokens.public_key:
        account.public_key = tokens.public_key
    account.token_expires_at = _expires_at(tokens.expires_in)
    account.updated_at = datetime.datetime.now(datetime.timezone.utc)

    db.flush()
    return account


def payment_account_status(account: RestaurantPaymentAccount | None) -> dict[str, object]:
    if account is None:
        return {
            "provider": "mercado_pago",
            "connected": False,
            "status": "disconnected",
            "provider_user_id": None,
            "token_expires_at": None,
        }

    return {
        "provider": "mercado_pago",
        "connected": account.status == "active",
        "status": account.status,
        "provider_user_id": account.provider_user_id,
        "token_expires_at": (
            account.token_expires_at.isoformat()
            if account.token_expires_at is not None
            else None
        ),
    }

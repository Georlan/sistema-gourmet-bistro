from __future__ import annotations

import datetime
import json
import os
import uuid

from sqlalchemy.orm import Session

from ...config import settings
from ...models import RestaurantPaymentAccount, OnlinePaymentIntent, Restaurante, RestaurantDirectPixConfig
from .oauth import MercadoPagoOAuthTokens


class MercadoPagoAccountConnectionError(RuntimeError):
    """Raised when a connected seller account cannot be persisted safely."""


def receiver_connection_status(db: Session, *, restaurant_id: int, provider: str) -> dict[str, object]:
    providers = [row[0] for row in db.query(RestaurantPaymentAccount.provider).filter(
        RestaurantPaymentAccount.restaurante_id == restaurant_id,
        RestaurantPaymentAccount.status == 'active').all()]
    if db.query(RestaurantDirectPixConfig.restaurante_id).filter(
        RestaurantDirectPixConfig.restaurante_id == restaurant_id,
        RestaurantDirectPixConfig.enabled.is_(True)).first():
        providers.append('direct_pix')
    return {
        'receiver_provider': providers[0] if len(providers) == 1 else 'multiple' if providers else None,
        'connection_blocked': len(providers) > 1 or any(value != provider for value in providers),
    }


def ensure_receiver_available(db: Session, *, restaurant_id: int, provider: str) -> None:
    # All receiver writers and order creation lock this same tenant row. Recheck
    # at completion, even if the OAuth link was issued before another connection.
    db.query(Restaurante).filter(Restaurante.id == restaurant_id).with_for_update().one()
    if receiver_connection_status(db, restaurant_id=restaurant_id, provider=provider)['connection_blocked']:
        raise MercadoPagoAccountConnectionError(
            'Desconecte o recebedor atual antes de conectar outro banco. Só é permitido um recebedor por restaurante.'
        )


def enable_menu_pix(db: Session, *, restaurant_id: int) -> None:
    """Publish Pix in the same transaction as a successful receiver connection."""
    restaurant = db.query(Restaurante).filter(Restaurante.id == restaurant_id).with_for_update().one()
    methods = restaurant.formas_pagamento_aceitas
    if isinstance(methods, str):
        try:
            methods = json.loads(methods)
        except (ValueError, TypeError) as exc:
            raise MercadoPagoAccountConnectionError('Revise as formas de pagamento do cardápio antes de conectar o banco.') from exc
    if methods is None:
        # Preserve the legacy cash method when materializing its first list.
        methods = ['Dinheiro']
    if not isinstance(methods, list):
        raise MercadoPagoAccountConnectionError('Revise as formas de pagamento do cardápio antes de conectar o banco.')
    if not any(isinstance(value, str) and value.strip().lower() == 'pix' for value in methods):
        restaurant.formas_pagamento_aceitas = [*methods, 'Pix']


def guard_receiver_change(db: Session, *, restaurant_id: int, provider: str,
                          provider_user_id: str | None = None, environment: str | None = None,
                          force_change: bool = False) -> None:
    """Serialize every receiver writer with order creation, before any mutation."""
    ensure_receiver_available(db, restaurant_id=restaurant_id, provider=provider)
    accounts = db.query(RestaurantPaymentAccount).filter(
        RestaurantPaymentAccount.restaurante_id == restaurant_id).all()
    target = next((a for a in accounts if a.provider == provider), None)
    direct = db.query(RestaurantDirectPixConfig).filter(
        RestaurantDirectPixConfig.restaurante_id == restaurant_id).first()
    identity_changed = bool(target and (target.provider_user_id != provider_user_id or
        provider == 'pagbank' and target.provider_environment != environment))
    if identity_changed and db.query(OnlinePaymentIntent.id).filter(
        OnlinePaymentIntent.restaurante_id == restaurant_id,
        OnlinePaymentIntent.provider == provider).first():
        # Intents currently point to tenant/provider, not a versioned account.
        # Never overwrite the credentials needed by historical charges.
        raise MercadoPagoAccountConnectionError('A conta original possui histórico de pagamentos. Não é possível substituir seu vendedor ou ambiente com segurança.')
    changing = (force_change or identity_changed or
        any(a.status == 'active' and a.provider != provider for a in accounts) or
        bool(direct and direct.enabled and provider != 'direct_pix') or
        provider != 'direct_pix' and (not target or target.status != 'active'))
    if changing and db.query(OnlinePaymentIntent.id).filter(
        OnlinePaymentIntent.restaurante_id == restaurant_id,
        OnlinePaymentIntent.status.in_(('created', 'pending', 'error'))).first():
        raise MercadoPagoAccountConnectionError('Resolva os Pix pendentes ou incertos antes de trocar a conta de recebimento.')


def is_marketplace_owner_account(provider_user_id: str | None) -> bool:
    marketplace_user_id = settings.MERCADO_PAGO_MARKETPLACE_USER_ID.strip()
    return bool(
        marketplace_user_id
        and str(provider_user_id or "").strip() == marketplace_user_id
    )


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
    if is_marketplace_owner_account(tokens.provider_user_id):
        raise MercadoPagoAccountConnectionError(
            "A conta proprietária da aplicação KÔMA não pode ser conectada como restaurante. "
            "Conecte a conta Mercado Pago que pertence ao estabelecimento para receber os pagamentos dos clientes."
        )

    guard_receiver_change(db, restaurant_id=int(restaurant_id), provider='mercado_pago',
                          provider_user_id=tokens.provider_user_id)

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

    identity_changed = account.provider_user_id != tokens.provider_user_id
    account.provider_user_id = tokens.provider_user_id
    account.status = "active"
    account.access_token = tokens.access_token
    if tokens.refresh_token or identity_changed:
        account.refresh_token = tokens.refresh_token
    account.webhook_secret = secret
    if tokens.public_key or identity_changed:
        account.public_key = tokens.public_key
    account.token_expires_at = _expires_at(tokens.expires_in)
    account.updated_at = datetime.datetime.now(datetime.timezone.utc)
    enable_menu_pix(db, restaurant_id=int(restaurant_id))
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

    self_connected = is_marketplace_owner_account(account.provider_user_id)
    credentials_present = bool(account.access_token and account.webhook_secret)
    return {
        "provider": "mercado_pago",
        "connected": account.status == "active" and not self_connected and credentials_present,
        "status": "error" if self_connected or account.status == 'active' and not credentials_present else account.status,
        "provider_user_id": account.provider_user_id,
        "token_expires_at": (
            account.token_expires_at.isoformat()
            if account.token_expires_at is not None
            else None
        ),
    }

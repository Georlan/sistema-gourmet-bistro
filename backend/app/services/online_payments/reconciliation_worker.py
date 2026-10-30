from __future__ import annotations

import asyncio
import datetime
import logging
import os
from sqlalchemy import or_, text
from sqlalchemy.orm import Session

from ...database import SessionLocal, tenant_session_scope
from ...models import OnlinePaymentIntent, RestaurantPaymentAccount
from ...websocket_manager import manager
from .service import OnlinePaymentService

logger = logging.getLogger("koma.online_payment_reconciliation")


def discover_active_tenant_ids(db: Session) -> list[int]:
    """Retorna IDs de restaurantes ativos com isolamento seguro."""
    bind = db.get_bind()
    if bind and bind.dialect.name == "postgresql":
        result = db.execute(
            text("SELECT id FROM koma_internal.list_public_restaurants()")
        ).scalars().all()
    else:
        result = db.execute(
            text("SELECT id FROM restaurantes")
        ).scalars().all()
    return [int(rid) for rid in result if rid is not None and int(rid) > 0]


# Process-local pagination cursor. Cross-instance financial deduplication remains
# authoritative in claim_poll_reconciliation's atomic database update.
_last_scanned_tenant_id = 0


def _allowed_reconciliation_tenants() -> set[int]:
    """Fail closed: new autonomous reconciliation needs explicit tenant opt-in."""
    raw = os.getenv("ONLINE_PAYMENT_RECONCILIATION_TENANT_IDS", "")
    values = [part.strip() for part in raw.split(",") if part.strip()]
    if any(not value.isdecimal() or int(value) < 1 for value in values):
        logger.error("Invalid ONLINE_PAYMENT_RECONCILIATION_TENANT_IDS; sweep disabled")
        return set()
    return {int(value) for value in values}


def reconcile_pending_intents(
    *, max_per_tenant: int = 3, max_tenants_per_sweep: int = 8
) -> int:
    """Bounded, fair, tenant-scoped payment recovery independent of the browser.

    A tenant must opt in explicitly. Repeatedly selecting the oldest 10 intents
    starves newer orders, so prioritize those not yet queried and rotate both
    tenants and pending intents on each pass.
    """
    global _last_scanned_tenant_id
    if max_per_tenant < 1 or max_tenants_per_sweep < 1:
        raise ValueError("Reconciliation sweep limits must be positive")

    allowed_tenants = _allowed_reconciliation_tenants()
    connected_onboarding = os.getenv('ONLINE_PAYMENT_RECONCILIATION_CONNECTED_TENANTS_ENABLED', '') == 'true'
    if not allowed_tenants and not connected_onboarding:
        return 0

    now = datetime.datetime.now(datetime.timezone.utc)
    cutoff_created = now - datetime.timedelta(hours=72)
    total_reconciled = 0

    with SessionLocal() as scan_db:
        available_ids = discover_active_tenant_ids(scan_db)
    tenant_ids = sorted({rid for rid in available_ids if connected_onboarding or rid in allowed_tenants})
    if not tenant_ids:
        return 0

    # Round-robin avoids starving later restaurants when the number of
    # connected stores exceeds the per-cycle budget.
    ordered_ids = (
        [rid for rid in tenant_ids if rid > _last_scanned_tenant_id]
        + [rid for rid in tenant_ids if rid <= _last_scanned_tenant_id]
    )
    selected_ids = ordered_ids[:max_tenants_per_sweep]
    _last_scanned_tenant_id = selected_ids[-1]

    for rid in selected_ids:
        try:
            with SessionLocal() as db:
                with tenant_session_scope(db, rid):
                    has_active_account = db.query(RestaurantPaymentAccount.id).filter(
                        RestaurantPaymentAccount.restaurante_id == rid,
                        RestaurantPaymentAccount.status == "active",
                    ).first()
                    if not has_active_account:
                        continue
                    if rid not in allowed_tenants:
                        # General enrollment is only for one usable automatic
                        # receiver. Never query money for Sandbox or ambiguous
                        # connections through this production release switch.
                        accounts = db.query(RestaurantPaymentAccount).filter(
                            RestaurantPaymentAccount.restaurante_id == rid,
                            RestaurantPaymentAccount.status == 'active').all()
                        if (len(accounts) != 1
                            or accounts[0].provider == 'pagbank' and accounts[0].provider_environment != 'production'
                            or not OnlinePaymentService.has_active_account(db, rid)):
                            continue

                    intents = (
                        db.query(OnlinePaymentIntent)
                        .filter(
                            OnlinePaymentIntent.restaurante_id == rid,
                            OnlinePaymentIntent.status.in_(("created", "pending", "error")),
                            OnlinePaymentIntent.provider.in_(("pagbank", "mercado_pago")),
                            OnlinePaymentIntent.external_payment_id.isnot(None),
                            OnlinePaymentIntent.created_at >= cutoff_created,
                        )
                        .order_by(
                            OnlinePaymentIntent.reconciliation_attempted_at.asc().nullsfirst(),
                            OnlinePaymentIntent.created_at.asc(),
                            OnlinePaymentIntent.id.asc(),
                        )
                        .limit(max_per_tenant)
                        .all()
                    )

                    for intent in intents:
                        try:
                            if not OnlinePaymentService.claim_poll_reconciliation(db, intent):
                                continue
                            account = OnlinePaymentService.account_for_intent(db, intent)
                            if account is None or account.status != "active":
                                continue

                            result, approved = OnlinePaymentService.reconcile_provider_payment(
                                db,
                                account=account,
                                external_payment_id=intent.external_payment_id,
                            )
                            if approved:
                                total_reconciled += 1
                                manager.queue_committed_broadcast(
                                    db, {"event": "tables_updated"}, int(rid)
                                )
                                manager.queue_committed_broadcast(
                                    db,
                                    {
                                        "event": "new_delivery_order",
                                        "message": "Novo pedido online pago recebido!",
                                    },
                                    int(rid),
                                )
                                db.commit()
                                logger.info(
                                    "Autonomous reconciliation approved intent=%s tenant=%s",
                                    intent.id,
                                    rid,
                                )
                        except Exception as exc:
                            db.rollback()
                            logger.warning(
                                "Autonomous reconciliation failed intent=%s tenant=%s type=%s",
                                intent.id, rid, type(exc).__name__,
                            )
        except Exception as exc:
            logger.warning(
                "Autonomous reconciliation tenant scan failed tenant=%s type=%s",
                rid, type(exc).__name__,
            )

    return total_reconciled

async def run_worker(poll_interval_seconds: float = 20.0) -> None:
    """Loop assíncrono em background para conciliação automática."""
    logger.info(
        "Autonomous reconciliation worker started; enabled_tenants=%d",
        len(_allowed_reconciliation_tenants()),
    )
    while True:
        try:
            await asyncio.to_thread(reconcile_pending_intents)
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Error in online payment reconciliation worker loop")
        await asyncio.sleep(poll_interval_seconds)

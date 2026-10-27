from __future__ import annotations

import asyncio
import datetime
import logging
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


def reconcile_pending_intents(*, max_per_tenant: int = 10) -> int:
    """Realiza a varredura e conciliação de intenções online pendentes sob escopo RLS de cada tenant."""
    now = datetime.datetime.now(datetime.timezone.utc)
    cutoff_created = now - datetime.timedelta(hours=24)
    total_reconciled = 0

    with SessionLocal() as scan_db:
        tenant_ids = discover_active_tenant_ids(scan_db)

    for rid in tenant_ids:
        try:
            with SessionLocal() as db:
                with tenant_session_scope(db, rid):
                    has_active_account = db.query(RestaurantPaymentAccount.id).filter(
                        RestaurantPaymentAccount.restaurante_id == rid,
                        RestaurantPaymentAccount.status == "active",
                    ).first()
                    if not has_active_account:
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
                        .order_by(OnlinePaymentIntent.created_at.asc())
                        .limit(max_per_tenant)
                        .all()
                    )

                    for intent in intents:
                        if not OnlinePaymentService.claim_poll_reconciliation(db, intent):
                            continue

                        account = OnlinePaymentService.account_for_intent(db, intent)
                        if not account or account.status != "active":
                            continue

                        try:
                            result, approved = OnlinePaymentService.reconcile_provider_payment(
                                db,
                                account=account,
                                external_payment_id=intent.external_payment_id,
                            )
                            if approved:
                                total_reconciled += 1
                                manager.queue_committed_broadcast(db, {"event": "tables_updated"}, int(rid))
                                manager.queue_committed_broadcast(
                                    db,
                                    {"event": "new_delivery_order", "message": "Novo pedido online pago recebido!"},
                                    int(rid),
                                )
                                db.commit()
                                logger.info(
                                    "Autonomous reconciliation approved intent=%s tenant=%s",
                                    intent.id,
                                    rid,
                                )
                        except Exception:
                            logger.warning(
                                "Autonomous reconciliation query failed for intent=%s tenant=%s",
                                intent.id,
                                rid,
                                exc_info=True,
                            )
        except Exception:
            logger.exception("Error during online payment reconciliation for tenant=%s", rid)

    return total_reconciled


async def run_worker(poll_interval_seconds: float = 20.0) -> None:
    """Loop assíncrono em background para conciliação automática."""
    while True:
        try:
            await asyncio.to_thread(reconcile_pending_intents)
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Error in online payment reconciliation worker loop")
        await asyncio.sleep(poll_interval_seconds)

import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..database import SessionLocal, tenant_session_scope
from ..models import Restaurante, SuperAdminAuditLog
from ..subscription import (
    VALID_BILLING_CYCLES,
    VALID_SUBSCRIPTION_PLANS,
    normalize_subscription_plan,
    subscription_mrr_cents,
    subscription_period_amount_cents,
)
from ..subscription_models import RestaurantSubscription
from .super_admin import _discover_restaurant_ids, get_current_admin


router = APIRouter(
    prefix="/billing",
    tags=["SuperAdmin Billing"],
)

VALID_SUBSCRIPTION_STATUSES = {
    "not_configured",
    "active",
    "past_due",
    "canceled",
}


class SubscriptionUpdateRequest(BaseModel):
    plan: str
    billing_cycle: Optional[str] = None
    status: str
    reason: str = Field(min_length=3, max_length=1000)
    current_period_end: Optional[datetime.datetime] = None


def _iso(value: Optional[datetime.datetime]) -> Optional[str]:
    return value.isoformat() if value is not None else None


def _monthlyized_from_snapshot(subscription: RestaurantSubscription) -> int:
    if subscription.period_amount_cents is None or subscription.billing_cycle is None:
        return 0
    if subscription.billing_cycle == "monthly":
        return int(subscription.period_amount_cents)
    return int(round(subscription.period_amount_cents / 12))


def _subscription_projection(
    restaurante: Restaurante,
    subscription: Optional[RestaurantSubscription],
) -> dict[str, Any]:
    current_plan = normalize_subscription_plan(restaurante.plano)
    if subscription is None:
        return {
            "restaurantId": str(restaurante.id),
            "restaurantName": restaurante.nome,
            "saasStatus": str(getattr(restaurante, "saas_status", "active") or "active").upper(),
            "plan": current_plan,
            "billingCycle": None,
            "subscriptionStatus": "not_configured",
            "storedStatus": "not_configured",
            "periodAmountCents": None,
            "monthlyEquivalentCents": 0,
            "currentPeriodEnd": None,
            "source": None,
            "catalogMismatch": False,
            "updatedAt": None,
        }

    configured = subscription.status != "not_configured"
    catalog_mismatch = bool(
        configured
        and subscription.plan_code
        and normalize_subscription_plan(subscription.plan_code) != current_plan
    )
    effective_status = "needs_review" if catalog_mismatch else subscription.status

    return {
        "restaurantId": str(restaurante.id),
        "restaurantName": restaurante.nome,
        "saasStatus": str(getattr(restaurante, "saas_status", "active") or "active").upper(),
        "plan": current_plan,
        "billingCycle": subscription.billing_cycle,
        "subscriptionStatus": effective_status,
        "storedStatus": subscription.status,
        "periodAmountCents": subscription.period_amount_cents,
        "monthlyEquivalentCents": (
            0 if catalog_mismatch else _monthlyized_from_snapshot(subscription)
        ),
        "currentPeriodEnd": _iso(subscription.current_period_end),
        "source": subscription.source,
        "catalogMismatch": catalog_mismatch,
        "updatedAt": _iso(subscription.updated_at),
    }


def _history_projection(log: SuperAdminAuditLog, restaurant_name: str) -> dict[str, Any]:
    return {
        "id": str(log.id),
        "restaurantId": str(log.restaurante_id),
        "restaurantName": restaurant_name,
        "actor": log.actor,
        "action": log.action,
        "reason": log.reason,
        "before": log.before_data,
        "after": log.after_data,
        "createdAt": _iso(log.created_at),
    }


@router.get("")
def billing_overview(admin: dict = Depends(get_current_admin)):
    """Consolida contratos persistidos sem transformar plano em receita recebida."""
    db = SessionLocal()
    subscriptions: list[dict[str, Any]] = []
    history: list[dict[str, Any]] = []

    try:
        for restaurant_id in _discover_restaurant_ids(db):
            with tenant_session_scope(db, restaurant_id):
                restaurante = (
                    db.query(Restaurante)
                    .filter(Restaurante.id == restaurant_id)
                    .one_or_none()
                )
                if restaurante is None:
                    continue

                subscription = (
                    db.query(RestaurantSubscription)
                    .filter(RestaurantSubscription.restaurante_id == restaurant_id)
                    .one_or_none()
                )
                projection = _subscription_projection(restaurante, subscription)
                subscriptions.append(projection)

                logs = (
                    db.query(SuperAdminAuditLog)
                    .filter(
                        SuperAdminAuditLog.restaurante_id == restaurant_id,
                        SuperAdminAuditLog.action == "SUPERADMIN_SUBSCRIPTION_UPDATE",
                    )
                    .order_by(SuperAdminAuditLog.created_at.desc())
                    .limit(10)
                    .all()
                )
                history.extend(_history_projection(log, restaurante.nome) for log in logs)

        history.sort(key=lambda item: item.get("createdAt") or "", reverse=True)
        history = history[:50]

        contracted_mrr = 0
        current_mrr = 0
        active_count = 0
        past_due_count = 0
        canceled_count = 0
        not_configured_count = 0
        needs_review_count = 0

        for item in subscriptions:
            item_status = item["subscriptionStatus"]
            monthly_equivalent = int(item["monthlyEquivalentCents"] or 0)
            if item_status == "active":
                active_count += 1
                contracted_mrr += monthly_equivalent
                current_mrr += monthly_equivalent
            elif item_status == "past_due":
                past_due_count += 1
                contracted_mrr += monthly_equivalent
            elif item_status == "canceled":
                canceled_count += 1
            elif item_status == "needs_review":
                needs_review_count += 1
            else:
                not_configured_count += 1

        return {
            "summary": {
                "contractedMrrCents": contracted_mrr,
                "currentMrrCents": current_mrr,
                "activeSubscriptions": active_count,
                "pastDueSubscriptions": past_due_count,
                "canceledSubscriptions": canceled_count,
                "notConfiguredSubscriptions": not_configured_count,
                "needsReviewSubscriptions": needs_review_count,
                "recurringRevenueReceivedAvailable": False,
            },
            "subscriptions": subscriptions,
            "history": history,
            "rules": {
                "annualDiscountRate": 0.10,
                "annualDiscountScope": "fixed_subscription_only",
                "pastDueAutoSuspendsTenant": False,
                "mrrSource": "persisted_subscription_contracts",
                "receivedRevenueSource": None,
            },
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Não foi possível consolidar contratos de assinatura com isolamento por tenant.",
        ) from exc
    finally:
        db.close()


@router.put("/restaurantes/{tenant_id}")
def update_subscription(
    tenant_id: str,
    payload: SubscriptionUpdateRequest,
    admin: dict = Depends(get_current_admin),
):
    try:
        restaurant_id = int(tenant_id)
        if restaurant_id <= 0:
            raise ValueError()
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="ID do restaurante inválido.",
        )

    plan = (payload.plan or "").strip().lower()
    if plan not in VALID_SUBSCRIPTION_PLANS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Plano inválido. Use: {', '.join(sorted(VALID_SUBSCRIPTION_PLANS))}.",
        )

    subscription_status = (payload.status or "").strip().lower()
    if subscription_status not in VALID_SUBSCRIPTION_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Status de assinatura inválido.",
        )

    clean_reason = (payload.reason or "").strip()
    if len(clean_reason) < 3:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="O motivo da alteração é obrigatório (mínimo de 3 caracteres).",
        )

    billing_cycle: Optional[str] = None
    if subscription_status != "not_configured":
        billing_cycle = (payload.billing_cycle or "").strip().lower()
        if billing_cycle not in VALID_BILLING_CYCLES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Ciclo inválido. Use monthly ou annual.",
            )

    db = SessionLocal()
    try:
        with tenant_session_scope(db, restaurant_id):
            restaurante = (
                db.query(Restaurante)
                .filter(Restaurante.id == restaurant_id)
                .one_or_none()
            )
            if restaurante is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Restaurante não encontrado.",
                )

            subscription = (
                db.query(RestaurantSubscription)
                .filter(RestaurantSubscription.restaurante_id == restaurant_id)
                .one_or_none()
            )
            if subscription is None:
                subscription = RestaurantSubscription(restaurante_id=restaurant_id)
                db.add(subscription)
                db.flush()

            before = {
                "plan": normalize_subscription_plan(restaurante.plano),
                "billing_cycle": subscription.billing_cycle,
                "subscription_status": subscription.status,
                "period_amount_cents": subscription.period_amount_cents,
                "current_period_end": _iso(subscription.current_period_end),
                "source": subscription.source,
            }

            restaurante.plano = plan
            if subscription_status == "not_configured":
                subscription.plan_code = None
                subscription.billing_cycle = None
                subscription.status = "not_configured"
                subscription.period_amount_cents = None
                subscription.current_period_end = None
            else:
                assert billing_cycle is not None
                subscription.plan_code = plan
                subscription.billing_cycle = billing_cycle
                subscription.status = subscription_status
                subscription.period_amount_cents = subscription_period_amount_cents(
                    plan,
                    billing_cycle,
                )
                subscription.current_period_end = payload.current_period_end
            subscription.source = "admin"
            subscription.updated_at = datetime.datetime.now(datetime.timezone.utc)

            after = {
                "plan": plan,
                "billing_cycle": subscription.billing_cycle,
                "subscription_status": subscription.status,
                "period_amount_cents": subscription.period_amount_cents,
                "mrr_cents": (
                    subscription_mrr_cents(plan, billing_cycle)
                    if billing_cycle and subscription.status != "not_configured"
                    else 0
                ),
                "current_period_end": _iso(subscription.current_period_end),
                "source": subscription.source,
            }
            db.add(
                SuperAdminAuditLog(
                    restaurante_id=restaurant_id,
                    actor=str(admin.get("user") or "admin"),
                    action="SUPERADMIN_SUBSCRIPTION_UPDATE",
                    reason=clean_reason,
                    before_data=before,
                    after_data=after,
                )
            )
            db.commit()
            db.refresh(subscription)

            return _subscription_projection(restaurante, subscription)
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Falha ao atualizar contrato de assinatura.",
        ) from exc
    finally:
        db.close()

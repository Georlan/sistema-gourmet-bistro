from __future__ import annotations

import datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import SuperAdminAuditLog
from ..routes.super_admin_onboarding import DEFAULT_TRIAL_DAYS, restaurant_trials
from ..saas_billing_models import SaaSSubscription
from .saas_billing_policy import (
    is_recurring_trial_payment_method,
    is_trial_eligible_payment_method,
)
from .saas_mercadopago import SaasMercadoPagoError, default_saas_mp_service


ONBOARDING_SUBSCRIPTION_STATUS = "onboarding"
_ONBOARDING_PROVIDER_PAUSED_STATUSES = {"onboarding", "suspended"}


def _as_utc(value: datetime.datetime) -> datetime.datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=datetime.timezone.utc)
    return value.astimezone(datetime.timezone.utc)


def _update_provider_status(preapproval_id: str, provider_status: str) -> dict[str, Any]:
    """Atualiza somente o estado do preapproval preservando a mesma autorização do cliente."""
    service = default_saas_mp_service
    service._ensure_provider_ready()
    clean_id = (preapproval_id or "").strip()
    if not clean_id:
        raise SaasMercadoPagoError("ID de preapproval inválido.", status_code=400)

    if service.is_mock:
        return {"id": clean_id, "status": provider_status}

    try:
        with service._client() as client:
            response = client.put(f"/preapproval/{clean_id}", json={"status": provider_status})
            if response.status_code >= 400:
                data = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
                detail = data.get("message") or data.get("error") or response.text
                raise SaasMercadoPagoError(
                    f"Falha ao atualizar estado da assinatura no gateway: {detail}",
                    status_code=response.status_code,
                )
            result = response.json()
            service._validate_merchant_identity(result)
            return result
    except SaasMercadoPagoError:
        raise
    except Exception as exc:
        raise SaasMercadoPagoError("Erro de comunicação ao atualizar estado da assinatura.") from exc


def pause_provider_during_onboarding(preapproval_id: str) -> dict[str, Any]:
    """
    Pausa a recorrência enquanto o restaurante conclui a implantação inicial.

    A autorização do cartão/Saldo continua vinculada ao contrato, mas nenhuma
    cobrança deve consumir os sete dias grátis enquanto perfil, horários e
    cardápio ainda estão sendo preparados.
    """
    return _update_provider_status(preapproval_id, "paused")


def _resume_provider_for_trial(preapproval_id: str, trial_ends_at: datetime.datetime) -> dict[str, Any]:
    """Define D+7 como próxima cobrança antes de reativar a recorrência."""
    default_saas_mp_service.update_preapproval_next_payment_date(preapproval_id, trial_ends_at)
    return _update_provider_status(preapproval_id, "authorized")


def ensure_trial_started_after_onboarding(
    db: Session,
    *,
    restaurante_id: int,
    actor: str,
) -> dict[str, Any] | None:
    """Inicia o trial após a implantação essencial sem antecipar Pix."""
    subscription = (
        db.query(SaaSSubscription)
        .filter(SaaSSubscription.restaurante_id == restaurante_id)
        .with_for_update()
        .one_or_none()
    )
    if subscription is None:
        return None

    local_status = str(subscription.status or "").strip().lower()
    if subscription.trial_started_at is not None or local_status in {"trialing", "active", "past_due", "canceled"}:
        return {
            "status": local_status,
            "trial_started_at": subscription.trial_started_at,
            "trial_ends_at": subscription.trial_ends_at,
        }

    if local_status not in _ONBOARDING_PROVIDER_PAUSED_STATUSES:
        return None

    if not is_trial_eligible_payment_method(subscription.payment_method_type):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A assinatura não possui um meio de pagamento elegível ao período grátis.",
        )

    now = datetime.datetime.now(datetime.timezone.utc)
    trial_ends_at = now + datetime.timedelta(days=DEFAULT_TRIAL_DAYS)

    if is_recurring_trial_payment_method(subscription.payment_method_type):
        if not subscription.provider_subscription_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A autorização recorrente ainda não está vinculada ao provedor.",
            )
        try:
            provider_result = _resume_provider_for_trial(subscription.provider_subscription_id, trial_ends_at)
        except SaasMercadoPagoError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    "Sua configuração foi salva, mas ainda não foi possível iniciar os 7 dias grátis no gateway. "
                    "Tente novamente; nenhuma cobrança foi antecipada."
                ),
            ) from exc

        provider_status = str(provider_result.get("status") or "authorized").strip().lower()
        if provider_status not in {"authorized", "active"}:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="O gateway ainda não confirmou o início do período grátis.",
            )

    existing_trial = db.execute(
        select(restaurant_trials).where(restaurant_trials.c.restaurante_id == restaurante_id)
    ).mappings().one_or_none()
    if existing_trial is None:
        db.execute(
            restaurant_trials.insert().values(
                restaurante_id=restaurante_id,
                trial_started_at=now,
                trial_ends_at=trial_ends_at,
                trial_status="active",
                created_at=now,
                updated_at=now,
            )
        )

    previous_status = local_status
    subscription.status = "trialing"
    subscription.trial_started_at = now
    subscription.trial_ends_at = trial_ends_at
    subscription.current_period_start = now
    subscription.current_period_end = trial_ends_at
    subscription.updated_at = now

    db.add(
        SuperAdminAuditLog(
            restaurante_id=restaurante_id,
            actor=actor,
            action="SAAS_TRIAL_START_AFTER_ONBOARDING",
            reason="Cliente concluiu a configuração mínima e iniciou explicitamente os 7 dias grátis",
            before_data={
                "status": previous_status,
                "trial_started_at": None,
                "trial_ends_at": None,
            },
            after_data={
                "status": "trialing",
                "trial_started_at": _as_utc(now).isoformat(),
                "trial_ends_at": _as_utc(trial_ends_at).isoformat(),
                "trial_days": DEFAULT_TRIAL_DAYS,
                "payment_method_type": subscription.payment_method_type,
                "provider_recurring": is_recurring_trial_payment_method(subscription.payment_method_type),
            },
        )
    )
    db.commit()

    return {
        "status": "trialing",
        "trial_started_at": now,
        "trial_ends_at": trial_ends_at,
    }

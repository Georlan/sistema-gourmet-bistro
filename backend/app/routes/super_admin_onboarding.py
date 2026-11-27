import datetime
import hashlib
import logging
import math
import re
import secrets
from types import SimpleNamespace
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Table,
    select,
    text,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import Base, SessionLocal, tenant_session_scope
from ..models import ConfiguracaoRestaurante, Restaurante, SuperAdminAuditLog, Usuario
from ..saas_billing_models import SaaSSubscription
from ..security import get_password_hash
from ..subscription import VALID_SUBSCRIPTION_PLANS
from ..services.operational_modes import explicit_order_types
from ..services.table_bootstrap import bootstrap_standard_tables
from ..services.tenant_id_reuse import (
    MAX_TENANT_ID,
    assert_tenant_id_eligible_in_locked_tx,
    provisioning_concurrency_guard,
    reserve_sequential_tenant_id,
    reserve_superadmin_tenant_id,
    suggest_reusable_tenant_ids,
)
from ..services.universal_presets import (
    DEFAULT_TRIAL_DAYS,
    EMAIL_RE as _EMAIL_RE,
    RESERVED_SLUGS,
    SLUG_RE as _SLUG_RE,
)
from ..services.universal_provisioning import (
    UniversalProvisioningInput,
    create_default_trial as _create_default_trial,
    lock_onboarding_transaction as _lock_onboarding_transaction,
    provision_restaurant,
    reserve_restaurant_id as _reserve_restaurant_id,
    restaurant_trials,
    slug_owner_id as _slug_owner_id,
)
from .super_admin import _discover_restaurant_ids, get_current_admin

logger = logging.getLogger("koma.super_admin.onboarding")
router = APIRouter(prefix="/super-admin", tags=["SuperAdmin"])

MAX_TRIAL_ACTION_DAYS = 90


class TenantOnboardingRequest(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    subdomain: str = Field(min_length=2, max_length=100)
    plan: str = Field(min_length=2, max_length=32)
    admin_name: str = Field(min_length=2, max_length=100)
    admin_email: str = Field(min_length=3, max_length=100)
    temporary_password: str = Field(min_length=8, max_length=72)
    restaurant_id: int | None = Field(default=None, ge=1, le=MAX_TENANT_ID)

    model_config = ConfigDict(extra="forbid")

    @field_validator("temporary_password")
    @classmethod
    def validate_bcrypt_password_size(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 72:
            raise ValueError("A senha temporária deve possuir no máximo 72 bytes.")
        return value


class TrialActionRequest(BaseModel):
    action: str = Field(min_length=3, max_length=16)
    days: int | None = Field(default=None, ge=1, le=MAX_TRIAL_ACTION_DAYS)
    reason: str = Field(min_length=3, max_length=1000)

    model_config = ConfigDict(extra="forbid")

    @field_validator("action")
    @classmethod
    def validate_action(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"start", "extend", "end", "renew"}:
            raise ValueError("Ação inválida. Use start, extend, end ou renew.")
        return normalized


class SuperAdminTableBootstrapRequest(BaseModel):
    count: int = Field(ge=1, le=300)
    default_capacity: int = Field(default=4, ge=1, le=50)
    reason: str = Field(min_length=3, max_length=1000)

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class SuperAdminOperationsUpdateRequest(BaseModel):
    order_types: list[Literal["consumo_local", "retirada", "delivery"]] = Field(min_length=1)
    reason: str = Field(min_length=3, max_length=1000)

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class SuperAdminReleaseRequest(BaseModel):
    payment_method_type: Literal["pix"] | None = None

    model_config = ConfigDict(extra="forbid")


class SuperAdminOperationalQaRequest(BaseModel):
    action: Literal["start", "end"]
    hours: int = Field(default=24, ge=1, le=72)
    reason: str = Field(min_length=10, max_length=1000)

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def _normalize_payload(payload: TenantOnboardingRequest) -> dict[str, str]:
    name = payload.name.strip()
    slug = payload.subdomain.strip().lower()
    plan = payload.plan.strip().lower()
    admin_name = payload.admin_name.strip()
    admin_email = payload.admin_email.strip().lower()

    if len(name) < 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="O nome do restaurante deve ter ao menos 2 caracteres.",
        )
    if not _SLUG_RE.fullmatch(slug):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                "Slug inválido. Use apenas letras minúsculas, números e hífens, "
                "sem espaços ou hífen no início/fim."
            ),
        )
    if slug in RESERVED_SLUGS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"O slug '{slug}' é reservado pela plataforma e não pode ser utilizado.",
        )
    if plan not in VALID_SUBSCRIPTION_PLANS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"Plano inválido '{payload.plan}'. Escolha entre: "
                f"{', '.join(sorted(VALID_SUBSCRIPTION_PLANS))}."
            ),
        )
    if len(admin_name) < 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="O nome do administrador deve ter ao menos 2 caracteres.",
        )
    if not _EMAIL_RE.fullmatch(admin_email):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Informe um e-mail válido para o administrador inicial.",
        )

    return {
        "name": name,
        "slug": slug,
        "plan": plan,
        "admin_name": admin_name,
        "admin_email": admin_email,
    }


def _serialize_conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _utc_now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _as_utc(value: datetime.datetime | None) -> datetime.datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=datetime.timezone.utc)
    return value.astimezone(datetime.timezone.utc)


def _trial_effective_status(row: Any, now: datetime.datetime | None = None) -> str:
    if row is None:
        return "not_started"
    stored_status = str(row["trial_status"] or "ended").lower()
    if stored_status != "active":
        return stored_status
    now = now or _utc_now()
    trial_ends_at = _as_utc(row["trial_ends_at"])
    if trial_ends_at is None or trial_ends_at <= now:
        return "expired"
    return "active"


def _trial_days_remaining(row: Any, now: datetime.datetime | None = None) -> int:
    if _trial_effective_status(row, now) != "active":
        return 0
    now = now or _utc_now()
    trial_ends_at = _as_utc(row["trial_ends_at"])
    if trial_ends_at is None:
        return 0
    seconds = max(0.0, (trial_ends_at - now).total_seconds())
    return int(math.ceil(seconds / 86400.0))


def _trial_snapshot(row: Any, now: datetime.datetime | None = None) -> dict[str, Any] | None:
    if row is None:
        return None
    now = now or _utc_now()
    started_at = _as_utc(row["trial_started_at"])
    ends_at = _as_utc(row["trial_ends_at"])
    return {
        "stored_status": str(row["trial_status"] or "ended").lower(),
        "effective_status": _trial_effective_status(row, now),
        "trial_started_at": started_at.isoformat() if started_at else None,
        "trial_ends_at": ends_at.isoformat() if ends_at else None,
        "days_remaining": _trial_days_remaining(row, now),
    }


def _read_trial(db, tenant_id: int):
    return db.execute(
        select(restaurant_trials).where(
            restaurant_trials.c.restaurante_id == tenant_id
        )
    ).mappings().one_or_none()


def _parse_tenant_id(tenant_id: str) -> int:
    try:
        parsed = int(tenant_id)
        if parsed <= 0:
            raise ValueError()
        return parsed
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="ID do restaurante inválido.",
        )


def _commercial_release_preview(
    db, tenant_id: int, *, require_subscription: bool = True
) -> dict[str, Any]:
    # Import here to keep the existing route composition free of circular imports.
    from ..services.restaurant_provisioning import get_active_operational_qa_record
    from .onboarding import _build_onboarding_status

    snapshot = _build_onboarding_status(
        db, current_user=SimpleNamespace(is_support_mode=False)
    )
    subscription = (
        db.query(SaaSSubscription)
        .filter(SaaSSubscription.restaurante_id == tenant_id)
        .one_or_none()
    )
    if subscription is None and require_subscription:
        raise HTTPException(status_code=409, detail="Restaurante sem assinatura comercial vinculada.")
    qa_record = (
        get_active_operational_qa_record(db, tenant_id)
        if subscription is None and isinstance(db, Session)
        else None
    )
    return {
        "restaurant": snapshot["restaurant"],
        "subscription": {
            "status": subscription.status,
            "billingCycle": subscription.billing_cycle,
            "paymentMethod": subscription.payment_method_type,
            "trialStartedAt": _as_utc(subscription.trial_started_at).isoformat() if subscription.trial_started_at else None,
            "trialEndsAt": _as_utc(subscription.trial_ends_at).isoformat() if subscription.trial_ends_at else None,
        } if subscription else None,
        "steps": {key: snapshot["steps"][key] for key in ("profile", "hours", "catalog", "operations")},
        "operations": snapshot["operations"],
        "counts": snapshot["counts"],
        "catalogAssistance": snapshot["catalogAssistance"],
        "progress": snapshot["progress"],
        "payments": snapshot["payments"],
        "onboarding": snapshot["onboarding"],
        "operationalQa": {
            "active": qa_record is not None,
            "startedAt": qa_record.get("started_at") if qa_record else None,
            "expiresAt": qa_record.get("expires_at") if qa_record else None,
            "hours": qa_record.get("hours") if qa_record else None,
            "hasToken": bool(qa_record and qa_record.get("qa_token_hash")),
        },
        "trial": snapshot["trial"],
        "readiness": snapshot["readiness"],
        "readyForRelease": snapshot["readyForRelease"],
        "trialStarted": snapshot["readiness"]["trialStarted"],
    }


@router.get("/onboarding/restaurantes/{tenant_id}/release")
def preview_commercial_release(
    tenant_id: str,
    admin: dict[str, Any] = Depends(get_current_admin),
):
    tenant_id_int = _parse_tenant_id(tenant_id)
    db = SessionLocal()
    try:
        with tenant_session_scope(db, tenant_id_int):
            return _commercial_release_preview(db, tenant_id_int, require_subscription=False)
    finally:
        db.close()


@router.put("/onboarding/restaurantes/{tenant_id}/operations")
def update_super_admin_operations(
    tenant_id: str,
    payload: SuperAdminOperationsUpdateRequest,
    admin: dict[str, Any] = Depends(get_current_admin),
):
    """Corrige a política canônica de modalidades sem configurar domínios especializados."""
    tenant_id_int = _parse_tenant_id(tenant_id)
    clean_reason = payload.reason.strip()
    actor = str(admin.get("user") or "superadmin")
    db = SessionLocal()
    try:
        with tenant_session_scope(db, tenant_id_int):
            restaurante = (
                db.query(Restaurante)
                .filter(Restaurante.id == tenant_id_int)
                .one_or_none()
            )
            if restaurante is None:
                raise HTTPException(status_code=404, detail="Restaurante não encontrado.")

            config = (
                db.query(ConfiguracaoRestaurante)
                .filter(ConfiguracaoRestaurante.restaurante_id == tenant_id_int)
                .with_for_update()
                .one_or_none()
            )
            if config is None:
                raise HTTPException(
                    status_code=409,
                    detail="Configurações do restaurante não encontradas.",
                )

            before = list(explicit_order_types(config) or [])
            after = list(dict.fromkeys(payload.order_types))
            if before == after:
                return _commercial_release_preview(db, tenant_id_int, require_subscription=False)

            config.tipos_pedido_ativos = after
            db.add(
                SuperAdminAuditLog(
                    restaurante_id=tenant_id_int,
                    actor=f"superadmin:{actor}",
                    action="SUPERADMIN_ONBOARDING_OPERATION_MODES_UPDATE",
                    reason=clean_reason,
                    before_data={"order_types": before},
                    after_data={
                        "order_types": after,
                        "specialized_settings_changed": False,
                    },
                )
            )
            db.commit()

            logger.info(
                "SUPERADMIN ONBOARDING OPERATIONS UPDATED tenant=%s actor=%s before=%s after=%s",
                tenant_id_int,
                actor,
                before,
                after,
            )
            return _commercial_release_preview(db, tenant_id_int, require_subscription=False)
    except HTTPException:
        if db.in_transaction():
            db.rollback()
        raise
    except Exception:
        if db.in_transaction():
            db.rollback()
        logger.exception(
            "SUPERADMIN ONBOARDING OPERATIONS UPDATE FAILED tenant=%s actor=%s",
            tenant_id_int,
            actor,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Falha ao atualizar as modalidades do restaurante.",
        )
    finally:
        db.close()


@router.post("/onboarding/restaurantes/{tenant_id}/tables/bootstrap")
def super_admin_bootstrap_tables(
    tenant_id: str,
    payload: SuperAdminTableBootstrapRequest,
    admin: dict[str, Any] = Depends(get_current_admin),
):
    """Atalho auditável de implantação para criar/completar mesas do salão."""
    tenant_id_int = _parse_tenant_id(tenant_id)
    actor = str(admin.get("user") or "superadmin")
    db = SessionLocal()
    try:
        with tenant_session_scope(db, tenant_id_int):
            try:
                result = bootstrap_standard_tables(
                    db,
                    tenant_id=tenant_id_int,
                    count=payload.count,
                    default_capacity=payload.default_capacity,
                )
            except LookupError as exc:
                raise HTTPException(status_code=404, detail=str(exc)) from exc
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc

            db.add(
                SuperAdminAuditLog(
                    restaurante_id=tenant_id_int,
                    actor=f"superadmin:{actor}",
                    action="SUPERADMIN_ONBOARDING_TABLES_BOOTSTRAP",
                    reason=payload.reason,
                    before_data={
                        "tables": result.existing_before,
                    },
                    after_data={
                        "requested_count": result.requested_count,
                        "default_capacity": result.default_capacity,
                        "created_ids": list(result.created_ids),
                        "tables": result.total_after,
                        "table_map_enabled": result.table_map_enabled,
                        "destructive": False,
                    },
                )
            )
            db.commit()
            return _commercial_release_preview(db, tenant_id_int, require_subscription=False)
    finally:
        db.close()


@router.post("/onboarding/restaurantes/{tenant_id}/operational-qa")
def update_operational_qa(
    tenant_id: str,
    payload: SuperAdminOperationalQaRequest,
    admin: dict[str, Any] = Depends(get_current_admin),
):
    """Liberação temporária para homologação sem fingir contrato ou faturamento.

    Não abre caixa, não recebe pagamento e não ativa a loja automaticamente.
    Pedidos permanecem sujeitos a turno aberto, pausa e modalidades do restaurante.
    """
    from ..contract_models import RestaurantContractAcceptance
    from ..services.restaurant_provisioning import (
        QA_OPERATION_END,
        QA_OPERATION_START,
        clear_operational_qa_cache,
        is_provisional_preparation,
        is_superadmin_operational_qa_active,
    )

    tenant_id_int = _parse_tenant_id(tenant_id)
    db = SessionLocal()
    try:
        with tenant_session_scope(db, tenant_id_int):
            restaurante = (
                db.query(Restaurante)
                .filter(Restaurante.id == tenant_id_int)
                .with_for_update()
                .one_or_none()
            )
            if restaurante is None:
                raise HTTPException(status_code=404, detail="Restaurante não encontrado.")
            if str(restaurante.saas_status or "").strip().lower() != "active":
                raise HTTPException(status_code=409, detail="Restaurante suspenso não pode entrar em QA operacional.")

            # Nunca converter um tenant comercial (ou em onboarding comercial)
            # em uma liberação administrativa que contorne o contrato.
            if (
                db.query(SaaSSubscription.id).filter(
                    SaaSSubscription.restaurante_id == tenant_id_int
                ).first() is not None
                or db.query(RestaurantContractAcceptance.id).filter(
                    RestaurantContractAcceptance.restaurante_id == tenant_id_int
                ).first() is not None
            ):
                raise HTTPException(
                    status_code=409,
                    detail="QA administrativo disponível somente antes da contratação comercial.",
                )

            active = is_superadmin_operational_qa_active(db, tenant_id_int)
            now = datetime.datetime.now(datetime.timezone.utc)
            raw_qa_token: str | None = None
            qa_menu_path: str | None = None
            if payload.action == "start":
                if active:
                    raise HTTPException(status_code=409, detail="Janela de QA já ativa. Encerre antes de reiniciar.")
                if not is_provisional_preparation(db, tenant_id_int, allow_qa=False):
                    raise HTTPException(status_code=409, detail="Restaurante não está em implantação provisória.")
                expires_at = now + datetime.timedelta(hours=payload.hours)
                action = QA_OPERATION_START
                raw_qa_token = f"{tenant_id_int}.{secrets.token_urlsafe(24)}"
                qa_token_hash = hashlib.sha256(raw_qa_token.encode("utf-8")).hexdigest()
                qa_menu_path = f"/c/{restaurante.slug}?qa_token={raw_qa_token}"
                after = {
                    "mode": "operational_qa",
                    "started_at": now.isoformat(),
                    "expires_at": expires_at.isoformat(),
                    "hours": payload.hours,
                    "qa_token_hash": qa_token_hash,
                    "commercial_contract_created": False,
                    "subscription_created": False,
                }
            else:
                if not active:
                    raise HTTPException(status_code=409, detail="Nenhuma janela de QA ativa para encerrar.")
                expires_at = now
                action = QA_OPERATION_END
                after = {"mode": "operational_qa", "ended_at": now.isoformat()}

            db.add(SuperAdminAuditLog(
                restaurante_id=tenant_id_int,
                actor=f"superadmin:{admin.get('user') or 'unknown'}",
                action=action,
                reason=payload.reason,
                before_data={"qa_active": active},
                after_data=after,
            ))
            db.commit()
            clear_operational_qa_cache(db, tenant_id_int)

            response_payload = {
                "restaurantId": str(tenant_id_int),
                "qaActive": payload.action == "start",
                "expiresAt": expires_at.isoformat(),
                "commercialContractCreated": False,
                "saasTrialStarted": False,
                "message": "Homologação operacional temporária liberada." if payload.action == "start"
                    else "Homologação operacional encerrada.",
            }
            if raw_qa_token is not None:
                response_payload["qaAccessToken"] = raw_qa_token
                response_payload["qaMenuPath"] = qa_menu_path
            return response_payload
    except HTTPException:
        if db.in_transaction():
            db.rollback()
        raise
    finally:
        db.close()


@router.post("/onboarding/restaurantes/{tenant_id}/release")
def release_commercial_operation(
    tenant_id: str,
    payload: SuperAdminReleaseRequest | None = None,
    admin: dict[str, Any] = Depends(get_current_admin),
):
    """Starts the commercial trial only after an explicit SuperAdmin release."""
    from ..services.onboarding_trial import ensure_trial_started_after_onboarding

    tenant_id_int = _parse_tenant_id(tenant_id)
    db = SessionLocal()
    try:
        with tenant_session_scope(db, tenant_id_int):
            if payload and payload.payment_method_type == "pix":
                sub = (
                    db.query(SaaSSubscription)
                    .filter(SaaSSubscription.restaurante_id == tenant_id_int)
                    .one_or_none()
                )
                if sub is not None and not sub.payment_method_type:
                    sub.payment_method_type = "pix"
                    db.flush()
            preview = _commercial_release_preview(db, tenant_id_int)
            trial_ends_at = preview["subscription"]["trialEndsAt"]
            if isinstance(trial_ends_at, str):
                trial_ends_at = datetime.datetime.fromisoformat(trial_ends_at)
            if not preview["trialStarted"]:
                if not preview["readyForRelease"]:
                    raise HTTPException(
                        status_code=409,
                        detail="Perfil, horários, produto ativo e modalidades precisam estar prontos antes da liberação.",
                    )
                result = ensure_trial_started_after_onboarding(
                    db,
                    restaurante_id=tenant_id_int,
                    actor=f"superadmin:{admin.get('user') or 'unknown'}",
                )
                if result is None:
                    raise HTTPException(status_code=409, detail="Assinatura indisponível para iniciar o trial.")
                trial_ends_at = result["trial_ends_at"]
            try:
                from ..services.signup_notifications import enqueue_trial_started

                customer = (
                    db.query(Usuario)
                    .filter(Usuario.restaurante_id == tenant_id_int, Usuario.cargo == "admin")
                    .order_by(Usuario.id)
                    .first()
                )
                if customer is not None:
                    enqueue_trial_started(
                        db,
                        tenant_id=tenant_id_int,
                        restaurant_name=preview["restaurant"]["name"],
                        plan=preview["restaurant"]["plan"],
                        billing_cycle=preview["subscription"]["billingCycle"],
                        customer_name=customer.nome,
                        customer_email=customer.email,
                        customer_phone=customer.telefone,
                        trial_ends_at=trial_ends_at,
                    )
                    db.commit()
            except Exception:
                db.rollback()
                logger.exception("SUPERADMIN TRIAL NOTICE QUEUE FAILED tenant=%s", tenant_id_int)
            return _commercial_release_preview(db, tenant_id_int)
    finally:
        db.close()


@router.get("/trials")
def list_trials(admin: dict[str, Any] = Depends(get_current_admin)):
    """Lista o entitlement de teste grátis sem inferir cobrança ou MRR."""
    from ..services.restaurant_provisioning import is_provisional_preparation

    db = SessionLocal()
    now = _utc_now()
    result: list[dict[str, Any]] = []

    try:
        for tenant_id in _discover_restaurant_ids(db):
            with tenant_session_scope(db, tenant_id):
                restaurante = (
                    db.query(Restaurante)
                    .filter(Restaurante.id == tenant_id)
                    .one_or_none()
                )
                if restaurante is None:
                    continue
                row = _read_trial(db, tenant_id)
                snapshot = _trial_snapshot(row, now)
                commercial_subscription = (
                    db.query(SaaSSubscription)
                    .filter(SaaSSubscription.restaurante_id == tenant_id)
                    .one_or_none()
                )
                provisional_prep = is_provisional_preparation(db, tenant_id)
                result.append(
                    {
                        "restaurantId": str(tenant_id),
                        "restaurantName": restaurante.nome,
                        "plan": restaurante.plano,
                        "saasStatus": str(restaurante.saas_status or "active").upper(),
                        "trialStatus": (
                            snapshot["effective_status"] if snapshot else "not_started"
                        ),
                        "trialStartedAt": (
                            snapshot["trial_started_at"] if snapshot else None
                        ),
                        "trialEndsAt": snapshot["trial_ends_at"] if snapshot else None,
                        "daysRemaining": snapshot["days_remaining"] if snapshot else 0,
                        "provisionalPreparation": provisional_prep,
                        "commercialOnboarding": bool(
                            provisional_prep
                            or (
                                commercial_subscription
                                and commercial_subscription.status in {"onboarding", "suspended"}
                                and commercial_subscription.trial_started_at is None
                            )
                        ),
                    }
                )

        logger.info(
            "SUPERADMIN TRIAL LIST actor=%s tenant_count=%s",
            admin.get("user"),
            len(result),
        )
        return result
    except HTTPException:
        raise
    except Exception:
        logger.exception("SUPERADMIN TRIAL LIST FAILED actor=%s", admin.get("user"))
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Falha ao consolidar os períodos grátis dos restaurantes.",
        )
    finally:
        db.close()


@router.put("/trials/restaurantes/{tenant_id}")
def update_trial(
    tenant_id: str,
    payload: TrialActionRequest,
    admin: dict[str, Any] = Depends(get_current_admin),
):
    """Concede, estende, encerra ou renova trial com motivo e auditoria append-only.

    O fim do trial não altera `saas_status` e não suspende o tenant automaticamente.
    Cobrança SaaS, MRR e Mercado Pago do Cardápio Online permanecem domínios separados.
    """
    tenant_id_int = _parse_tenant_id(tenant_id)
    clean_reason = payload.reason.strip()
    if len(clean_reason) < 3:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="O motivo da ação de trial é obrigatório.",
        )

    db = SessionLocal()
    try:
        with tenant_session_scope(db, tenant_id_int):
            restaurante = (
                db.query(Restaurante)
                .filter(Restaurante.id == tenant_id_int)
                .one_or_none()
            )
            if restaurante is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Restaurante não encontrado.",
                )

            now = _utc_now()
            row = _read_trial(db, tenant_id_int)
            before = _trial_snapshot(row, now)
            effective_status = _trial_effective_status(row, now)
            days = payload.days or DEFAULT_TRIAL_DAYS
            action = payload.action

            if action == "start":
                if row is not None:
                    raise _serialize_conflict(
                        "Este restaurante já possui histórico de trial. Use estender ou renovar."
                    )
                started_at = now
                ends_at = now + datetime.timedelta(days=days)
                db.execute(
                    restaurant_trials.insert().values(
                        restaurante_id=tenant_id_int,
                        trial_started_at=started_at,
                        trial_ends_at=ends_at,
                        trial_status="active",
                        created_at=now,
                        updated_at=now,
                    )
                )
                audit_action = "SUPERADMIN_TRIAL_START"
            elif action == "extend":
                if row is None:
                    raise _serialize_conflict(
                        "Este restaurante ainda não possui trial. Use iniciar."
                    )
                current_end = _as_utc(row["trial_ends_at"]) or now
                base_end = current_end if current_end > now else now
                ends_at = base_end + datetime.timedelta(days=days)
                db.execute(
                    restaurant_trials.update()
                    .where(restaurant_trials.c.restaurante_id == tenant_id_int)
                    .values(
                        trial_ends_at=ends_at,
                        trial_status="active",
                        updated_at=now,
                    )
                )
                audit_action = "SUPERADMIN_TRIAL_EXTEND"
            elif action == "renew":
                if row is None:
                    raise _serialize_conflict(
                        "Este restaurante ainda não possui trial. Use iniciar."
                    )
                if effective_status == "active":
                    raise _serialize_conflict(
                        "O trial ainda está ativo. Use estender para adicionar dias."
                    )
                started_at = now
                ends_at = now + datetime.timedelta(days=days)
                db.execute(
                    restaurant_trials.update()
                    .where(restaurant_trials.c.restaurante_id == tenant_id_int)
                    .values(
                        trial_started_at=started_at,
                        trial_ends_at=ends_at,
                        trial_status="active",
                        updated_at=now,
                    )
                )
                audit_action = "SUPERADMIN_TRIAL_RENEW"
            else:
                if row is None:
                    raise _serialize_conflict(
                        "Este restaurante ainda não possui trial para encerrar."
                    )
                if effective_status == "ended":
                    raise _serialize_conflict("O trial já foi encerrado.")
                db.execute(
                    restaurant_trials.update()
                    .where(restaurant_trials.c.restaurante_id == tenant_id_int)
                    .values(
                        trial_ends_at=now,
                        trial_status="ended",
                        updated_at=now,
                    )
                )
                audit_action = "SUPERADMIN_TRIAL_END"

            after_row = _read_trial(db, tenant_id_int)
            after = _trial_snapshot(after_row, now)
            db.add(
                SuperAdminAuditLog(
                    restaurante_id=tenant_id_int,
                    actor=str(admin.get("user") or "superadmin"),
                    action=audit_action,
                    reason=clean_reason,
                    before_data=before,
                    after_data=after,
                )
            )
            db.commit()

            logger.info(
                "SUPERADMIN TRIAL UPDATED tenant=%s actor=%s action=%s days=%s",
                tenant_id_int,
                admin.get("user"),
                action,
                days if action != "end" else 0,
            )

            return {
                "restaurantId": str(tenant_id_int),
                "restaurantName": restaurante.nome,
                "plan": restaurante.plano,
                "saasStatus": str(restaurante.saas_status or "active").upper(),
                "trialStatus": after["effective_status"] if after else "not_started",
                "trialStartedAt": after["trial_started_at"] if after else None,
                "trialEndsAt": after["trial_ends_at"] if after else None,
                "daysRemaining": after["days_remaining"] if after else 0,
                "message": "Período grátis atualizado com sucesso.",
            }
    except HTTPException:
        if db.in_transaction():
            db.rollback()
        raise
    except Exception:
        if db.in_transaction():
            db.rollback()
        logger.exception("SUPERADMIN TRIAL UPDATE FAILED tenant=%s", tenant_id_int)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Falha ao atualizar o período grátis do restaurante.",
        )
    finally:
        db.close()


@router.get("/restaurantes/id-eligibility")
def get_tenant_id_eligibility(
    candidate_id: int | None = None,
    limit: int = 10,
    admin: dict[str, Any] = Depends(get_current_admin),
):
    """Retorna o menor ID elegível sugerido e o diagnóstico de elegibilidade para o Super Admin."""
    _ = admin
    db = SessionLocal()
    try:
        summary = suggest_reusable_tenant_ids(
            db,
            limit=limit,
            preferred_id=1,
            candidate_id=candidate_id,
        )
        return {
            "suggestedId": summary["suggested_id"],
            "suggested_id": summary["suggested_id"],
            "eligibleIds": summary["eligible_ids"],
            "eligible_ids": summary["eligible_ids"],
            "priorityId": summary["priority_id"],
            "priority_id": summary["priority_id"],
            "priorityReport": summary["priority_report"],
            "priority_report": summary["priority_report"],
            "candidateReport": summary["candidate_report"],
            "candidate_report": summary["candidate_report"],
            "candidates": summary["candidates"],
        }
    finally:
        db.close()


@router.post("/restaurantes", status_code=status.HTTP_201_CREATED)
def create_tenant(
    payload: TenantOnboardingRequest,
    admin: dict[str, Any] = Depends(get_current_admin),
):
    """Cria restaurante, administrador inicial, defaults e auditoria via motor central."""
    normalized = _normalize_payload(payload)
    db = SessionLocal()
    try:
        result = provision_restaurant(
            db,
            UniversalProvisioningInput(
                name=normalized["name"],
                subdomain=normalized["slug"],
                explicit_subdomain=True,
                plan=normalized["plan"],
                operation_profile="generic",
                admin_name=normalized["admin_name"],
                admin_email=normalized["admin_email"],
                admin_password=payload.temporary_password,
                requested_restaurant_id=payload.restaurant_id,
                defer_trial=False,
                audit_action="SUPERADMIN_TENANT_ONBOARD",
                audit_reason="Provisionamento inicial de restaurante pelo Super Admin",
                commercial_terms_status="not_contracted",
            ),
            origin="super_admin",
            actor=str(admin.get("user") or "superadmin"),
            allow_id_reuse=True,
            dry_run=False,
            password_hasher=get_password_hash,
        )
        return {
            "id": result["id"],
            "idSelectionMode": result["idSelectionMode"],
            "name": result["name"],
            "subdomain": result["subdomain"],
            "plan": result["plan"],
            "status": result["status"],
            "onlinePaymentStatus": result["onlinePaymentStatus"],
            "trial": result["trial"],
            "admin": {
                "id": result["admin"]["id"],
                "name": result["admin"]["name"],
                "email": result["admin"]["email"],
                "status": result["admin"]["status"],
            },
            "paths": result["paths"],
            "message": "Restaurante provisionado com 7 dias grátis.",
        }
    except HTTPException:
        if db.in_transaction():
            db.rollback()
        raise
    except Exception:
        if db.in_transaction():
            db.rollback()
        logger.exception(
            "SUPERADMIN TENANT ONBOARD FAILED actor=%s",
            admin.get("user"),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Falha ao provisionar o restaurante. Nenhuma criação parcial foi mantida.",
        )
    finally:
        db.close()

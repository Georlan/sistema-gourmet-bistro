from __future__ import annotations

import datetime
import hashlib
import hmac
import json
import os
import logging
import re
import secrets
import unicodedata
import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..contract_models import ContractAcceptance, RestaurantContractAcceptance
from ..crypt import decrypt_field
from ..database import tenant_session_scope
from ..models import ConfiguracaoRestaurante, Restaurante, SuperAdminAuditLog, Usuario
from ..restaurant_profile_models import RestauranteOperationProfile
from ..signup_models import RestaurantSignup
from .universal_presets import DEFAULT_TRIAL_DAYS, INVITATION_TTL_HOURS
from .universal_provisioning import (
    lock_onboarding_transaction as _lock_onboarding_transaction,
    reserve_restaurant_id as _reserve_restaurant_id,
    slug_owner_id as _slug_owner_id,
)
from ..saas_billing_models import SaaSSubscription
from ..services.billing_service import (
    BillingSetupData,
    contract_fixed_billing_required,
    link_billing_setup_to_tenant,
)
from ..services.tenant_id_reuse import (
    assert_tenant_id_eligible_in_locked_tx,
    provisioning_concurrency_guard,
    reserve_sequential_tenant_id,
    reserve_superadmin_tenant_id,
)
from ..subscription import VALID_SUBSCRIPTION_PLANS
from .onboarding_trial import ONBOARDING_SUBSCRIPTION_STATUS, pause_provider_during_onboarding
from .saas_billing_policy import (
    is_recurring_trial_payment_method,
    is_trial_eligible_payment_method,
)
from .saas_mercadopago import SaasMercadoPagoError

logger = logging.getLogger("koma.services.restaurant_provisioning")

INVITATION_TTL_HOURS = 72
_SUPPORTED_OPERATION_PROFILES = {"generic", "pizzaria", "acai", "churrasco", "marmitaria"}


def _operation_profile_for_contract(db: Session, protocol: str) -> str:
    encrypted_payload = None
    normalized = protocol.strip().upper()
    if db.get_bind().dialect.name == "postgresql":
        encrypted_payload = db.execute(
            text("SELECT koma_internal.signup_payload_for_contract(:protocol)"),
            {"protocol": normalized},
        ).scalar_one_or_none()
    else:
        acceptance = (
            db.query(ContractAcceptance)
            .filter(ContractAcceptance.protocol == normalized)
            .one_or_none()
        )
        if acceptance is not None:
            signup = (
                db.query(RestaurantSignup)
                .filter(RestaurantSignup.id == acceptance.request_id)
                .one_or_none()
            )
            encrypted_payload = signup.payload_encrypted if signup is not None else None

    if not encrypted_payload:
        return "generic"

    try:
        payload = json.loads(decrypt_field(encrypted_payload))
    except Exception:
        logger.warning("Signup profile payload could not be decoded for %s", normalized)
        return "generic"

    profile = str(payload.get("operation_profile") or "generic").strip().lower()
    return profile if profile in _SUPPORTED_OPERATION_PROFILES else "generic"


def resolve_activation_acceptance(db: Session, protocol: str) -> dict[str, Any] | None:
    """Busca os dados do aceite contratual para ativação ou setup de billing."""
    from sqlalchemy import select, text
    from ..contract_models import ContractAcceptance
    from ..saas_billing_models import SaaSBillingSetup, SaaSPlanChange
    from .billing_service import get_billing_setup

    normalized = protocol.strip().upper()
    if db.get_bind().dialect.name == "postgresql":
        row = db.execute(
            text("SELECT * FROM koma_internal.resolve_contract_acceptance_for_activation(:protocol)"),
            {"protocol": normalized},
        ).mappings().one_or_none()
        if not row:
            return None
        res = dict(row)
        if "billing_status" not in res or not res["billing_status"]:
            billing = get_billing_setup(db, normalized)
            if billing:
                res["billing_status"] = billing.status
                res["billing_provider"] = billing.provider
                res["payment_method_type"] = billing.payment_method_type
            else:
                res["billing_status"] = "pending"
                res["billing_provider"] = None
                res["payment_method_type"] = None
        owner = db.execute(
            text(
                "SELECT koma_internal.plan_change_owner_for_acceptance(:acceptance_id)"
            ),
            {"acceptance_id": str(res.get("acceptance_id") or "")},
        ).scalar_one_or_none()
        res["plan_change_restaurante_id"] = int(owner) if owner is not None else None
        return res

    SaaSBillingSetup.__table__.create(db.get_bind(), checkfirst=True)
    SaaSSubscription.__table__.create(db.get_bind(), checkfirst=True)
    SaaSPlanChange.__table__.create(db.get_bind(), checkfirst=True)
    row = (
        db.query(ContractAcceptance, RestaurantContractAcceptance, SaaSBillingSetup)
        .outerjoin(
            RestaurantContractAcceptance,
            RestaurantContractAcceptance.acceptance_id == ContractAcceptance.id,
        )
        .outerjoin(
            SaaSBillingSetup,
            SaaSBillingSetup.protocol == ContractAcceptance.protocol,
        )
        .filter(ContractAcceptance.protocol == normalized)
        .one_or_none()
    )
    if row is None:
        return None
    acceptance, link, billing = row
    plan_change_owner_row = (
        db.query(SaaSPlanChange.restaurante_id)
        .filter(SaaSPlanChange.acceptance_id == str(acceptance.id))
        .one_or_none()
    )
    plan_change_owner = (
        int(plan_change_owner_row[0])
        if plan_change_owner_row is not None
        else None
    )
    return {
        "acceptance_id": acceptance.id,
        "protocol": acceptance.protocol,
        "plan": acceptance.plan,
        "billing_cycle": acceptance.billing_cycle,
        "restaurant_name": acceptance.restaurant_name,
        "contracting_party_name": acceptance.contracting_party_name,
        "representative_name": acceptance.representative_name,
        "email": acceptance.email,
        "phone": acceptance.phone,
        "linked_restaurante_id": link.restaurante_id if link else None,
        "linked_at": link.linked_at if link else None,
        "billing_status": billing.status if billing else "pending",
        "billing_provider": billing.provider if billing else None,
        "payment_method_type": billing.payment_method_type if billing else None,
        "plan_change_restaurante_id": plan_change_owner,
    }


def activation_slug(restaurant_name: str, protocol: str) -> str:
    """Gera um slug determinístico para o restaurante baseado no nome e protocolo."""
    ascii_name = unicodedata.normalize("NFKD", restaurant_name).encode("ascii", "ignore").decode("ascii")
    base = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-") or "restaurante"
    suffix = protocol.rsplit("-", 1)[-1].lower()
    max_base_length = max(1, 100 - len(suffix) - 1)
    trimmed = base[:max_base_length].rstrip("-") or "restaurante"
    return f"{trimmed}-{suffix}"


def provision_restaurant_for_contract(
    db: Session,
    *,
    acceptance: dict[str, Any],
    billing_setup: BillingSetupData | None = None,
    actor: str = "saas_checkout",
    reason: str = "Ativação da conta com trial preservado até a conclusão da implantação essencial",
    requested_restaurant_id: int | None = None,
    allow_id_reuse: bool = False,
) -> dict[str, Any]:
    """
    Provisiona atomicamente o restaurante, configurações, admin inicial e assinatura SaaS.

    O tenant nasce em modo de implantação. Meios recorrentes ficam pausados no
    gateway; no Pix universal nenhuma cobrança é criada antes do vencimento. Os
    sete dias grátis só começam quando perfil, horários e cardápio estiverem
    prontos, sem consumir trial durante a implantação.
    """
    protocol = str(acceptance["protocol"]).strip().upper()
    if acceptance.get("plan_change_restaurante_id") is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Aceite de mudança de plano não pode ser usado para provisionamento inicial."
            ),
        )
    plan = str(acceptance.get("plan") or "").strip().lower()
    operation_profile = _operation_profile_for_contract(db, protocol)
    fixed_billing_required = contract_fixed_billing_required(db, protocol)
    if plan not in VALID_SUBSCRIPTION_PLANS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="O plano congelado no aceite não é provisionável.",
        )

    restaurant_name = str(acceptance.get("restaurant_name") or "").strip()
    admin_name = str(
        acceptance.get("representative_name") or acceptance.get("contracting_party_name") or ""
    ).strip()
    admin_email = str(acceptance.get("email") or "").strip().lower()
    admin_phone = str(acceptance.get("phone") or "").strip() or None

    if len(restaurant_name) < 2 or len(admin_name) < 2:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="O aceite não contém dados suficientes para provisionamento automático.",
        )
    if not admin_email or "@" not in admin_email or len(admin_email) > 100:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="O e-mail do representante não é compatível com o cadastro de administrador.",
        )

    if (
        not fixed_billing_required
        and billing_setup is not None
        and billing_setup.provider_subscription_id
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Contrato sem componente fixo não pode ser provisionado com "
                "assinatura recorrente do provedor."
            ),
        )

    if (
        fixed_billing_required
        and billing_setup is not None
        and billing_setup.status == "ready"
        and not is_trial_eligible_payment_method(billing_setup.payment_method_type)
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "A contratação não possui um meio de pagamento elegível ao trial. "
                "Escolha cartão, Pix ou Saldo Mercado Pago."
            ),
        )

    if requested_restaurant_id is not None and not allow_id_reuse:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="A seleção manual de ID é exclusiva do provisionamento autorizado pelo Super Admin.",
        )

    slug = activation_slug(restaurant_name, protocol)

    with provisioning_concurrency_guard():
        latest_pre = resolve_activation_acceptance(db, protocol)
        if db.in_transaction():
            db.rollback()
        if latest_pre and latest_pre.get("linked_restaurante_id"):
            existing_id = int(latest_pre["linked_restaurante_id"])
            if requested_restaurant_id is not None and int(requested_restaurant_id) != existing_id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Este contrato já foi provisionado no restaurante #{existing_id}.",
                )
            with tenant_session_scope(db, existing_id):
                restaurant = db.query(Restaurante).filter(Restaurante.id == existing_id).one()
                subscription = (
                    db.query(SaaSSubscription)
                    .filter(SaaSSubscription.restaurante_id == existing_id)
                    .one_or_none()
                )
                return {
                    "restaurant_id": existing_id,
                    "slug": restaurant.slug,
                    "invitation_token": None,
                    "trial_ends_at": subscription.trial_ends_at if subscription else None,
                    "trial_status": subscription.status if subscription else None,
                }

        excluded_ids: set[int] = set()
        max_attempts = 1 if requested_restaurant_id is not None else 5

        for attempt in range(max_attempts):
            if allow_id_reuse:
                tenant_id, id_selection_mode = reserve_superadmin_tenant_id(
                    db,
                    requested_id=requested_restaurant_id,
                    excluded_ids=excluded_ids,
                )
            else:
                tenant_id = reserve_sequential_tenant_id(
                    db,
                    excluded_ids=excluded_ids,
                )
                id_selection_mode = "sequence"

            try:
                with tenant_session_scope(db, tenant_id):
                    _lock_onboarding_transaction(db)

                    latest = resolve_activation_acceptance(db, protocol)
                    if latest and latest.get("linked_restaurante_id"):
                        existing_id = int(latest["linked_restaurante_id"])
                        if (
                            requested_restaurant_id is not None
                            and int(requested_restaurant_id) != existing_id
                        ):
                            raise HTTPException(
                                status_code=status.HTTP_409_CONFLICT,
                                detail=f"Este contrato já foi provisionado no restaurante #{existing_id}.",
                            )
                        db.rollback()
                        with tenant_session_scope(db, existing_id):
                            restaurant = (
                                db.query(Restaurante)
                                .filter(Restaurante.id == existing_id)
                                .one()
                            )
                            subscription = (
                                db.query(SaaSSubscription)
                                .filter(SaaSSubscription.restaurante_id == existing_id)
                                .one_or_none()
                            )
                            return {
                                "restaurant_id": existing_id,
                                "slug": restaurant.slug,
                                "invitation_token": None,
                                "trial_ends_at": (
                                    subscription.trial_ends_at if subscription else None
                                ),
                                "trial_status": (
                                    subscription.status if subscription else None
                                ),
                            }

                    assert_tenant_id_eligible_in_locked_tx(
                        db,
                        tenant_id,
                        requested_id=requested_restaurant_id,
                    )

                    if _slug_owner_id(db, slug) is not None:
                        raise HTTPException(
                            status_code=status.HTTP_409_CONFLICT,
                            detail="O subdomínio determinístico desta contratação já está em uso.",
                        )

                    now = datetime.datetime.now(datetime.timezone.utc)
                    invitation_token = str(uuid.uuid4())

                    # Meios recorrentes são autorizados na inscrição e pausados durante o
                    # onboarding. Pix universal não possui mandato: nenhum pagamento é criado
                    # aqui; o QR só nasce depois do trial, quando existir valor devido.
                    if (
                        fixed_billing_required
                        and billing_setup is not None
                        and billing_setup.status == "ready"
                        and is_recurring_trial_payment_method(
                            billing_setup.payment_method_type
                        )
                        and billing_setup.provider_subscription_id
                    ):
                        try:
                            provider_result = pause_provider_during_onboarding(
                                billing_setup.provider_subscription_id
                            )
                        except SaasMercadoPagoError as exc:
                            raise HTTPException(
                                status_code=status.HTTP_502_BAD_GATEWAY,
                                detail=(
                                    "Não foi possível proteger o período grátis durante a implantação. "
                                    "O restaurante não foi liberado e nenhuma cobrança foi antecipada; tente novamente."
                                ),
                            ) from exc
                        if (
                            str(provider_result.get("status") or "").strip().lower()
                            != "paused"
                        ):
                            raise HTTPException(
                                status_code=status.HTTP_502_BAD_GATEWAY,
                                detail="O gateway ainda não confirmou a pausa da recorrência durante a implantação.",
                            )

                    restaurant = Restaurante(
                        id=tenant_id,
                        nome=restaurant_name,
                        slug=slug,
                        plano=plan,
                        saas_status="active",
                        billing_mode="subscription",
                    )
                    db.add(restaurant)
                    db.flush()

                    db.add(
                        RestauranteOperationProfile(
                            restaurante_id=tenant_id,
                            profile_key=operation_profile,
                        )
                    )

                    db.add(
                        ConfiguracaoRestaurante(
                            restaurante_id=tenant_id,
                            impressao_nome_restaurante=restaurant_name,
                        )
                    )

                    initial_admin = Usuario(
                        restaurante_id=tenant_id,
                        nome=admin_name,
                        telefone=admin_phone,
                        email=admin_email,
                        cargo="admin",
                        status="pendente_ativacao",
                        senha_hash=None,
                        token_convite=invitation_token,
                        token_expira_em=now
                        + datetime.timedelta(hours=INVITATION_TTL_HOURS),
                    )
                    db.add(initial_admin)
                    db.flush()

                    link = RestaurantContractAcceptance(
                        id=str(uuid.uuid4()),
                        restaurante_id=tenant_id,
                        acceptance_id=str(acceptance["acceptance_id"]),
                        linked_at=now,
                    )
                    db.add(link)

                    if billing_setup is not None:
                        link_billing_setup_to_tenant(db, protocol, tenant_id)

                    if (not fixed_billing_required) or (
                        billing_setup is not None and billing_setup.status == "ready"
                    ):
                        canonical_sub = SaaSSubscription(
                            restaurante_id=tenant_id,
                            provider=(
                                billing_setup.provider
                                if billing_setup is not None
                                else "mercado_pago"
                            ),
                            provider_customer_id=(
                                billing_setup.provider_customer_id
                                if billing_setup is not None
                                else None
                            ),
                            provider_subscription_id=(
                                billing_setup.provider_subscription_id
                                if billing_setup is not None
                                else None
                            ),
                            payment_method_type=(
                                billing_setup.payment_method_type
                                if billing_setup is not None
                                else None
                            ),
                            status=(
                                ONBOARDING_SUBSCRIPTION_STATUS
                                if fixed_billing_required
                                else "active"
                            ),
                            billing_cycle=acceptance.get("billing_cycle") or "monthly",
                            trial_started_at=None,
                            trial_ends_at=None,
                            current_period_start=None,
                            current_period_end=None,
                            created_at=now,
                            updated_at=now,
                        )
                        db.add(canonical_sub)

                    db.add(
                        SuperAdminAuditLog(
                            restaurante_id=tenant_id,
                            actor=actor,
                            action=(
                                "SUPERADMIN_CONTRACT_ACTIVATE"
                                if actor != "saas_checkout"
                                else "ATOMIC_CONTRACT_ACTIVATE"
                            ),
                            reason=reason,
                            before_data=None,
                            after_data={
                                "protocol": protocol,
                                "acceptance_id": str(acceptance["acceptance_id"]),
                                "restaurante_id": tenant_id,
                                "id_selection_mode": id_selection_mode,
                                "requested_restaurant_id": requested_restaurant_id,
                                "slug": slug,
                                "plan": plan,
                                "operation_profile": operation_profile,
                                "billing_cycle": acceptance.get("billing_cycle")
                                or "monthly",
                                "billing_status": (
                                    billing_setup.status
                                    if billing_setup is not None
                                    else (
                                        "not_required"
                                        if not fixed_billing_required
                                        else "pending"
                                    )
                                ),
                                "billing_provider": (
                                    billing_setup.provider if billing_setup else None
                                ),
                                "payment_method_type": (
                                    billing_setup.payment_method_type
                                    if billing_setup
                                    else None
                                ),
                                "trial_status": (
                                    "pending_onboarding"
                                    if fixed_billing_required
                                    else "not_applicable"
                                ),
                                "trial_days": (
                                    DEFAULT_TRIAL_DAYS if fixed_billing_required else 0
                                ),
                                "trial_ends_at": None,
                                "admin_user_id": initial_admin.id,
                                "admin_email": admin_email,
                                "admin_status": "pendente_ativacao",
                                "credential_delivery": "outbox_scheduled",
                                "mercado_pago": "disconnected",
                            },
                        )
                    )
                    from .signup_notifications import enqueue_activation

                    enqueue_activation(
                        db,
                        protocol=protocol,
                        restaurant_name=restaurant_name,
                        representative_name=admin_name,
                        email=admin_email,
                        phone=admin_phone,
                        token=invitation_token,
                    )
                    db.commit()

                    return {
                        "restaurant_id": tenant_id,
                        "id_selection_mode": id_selection_mode,
                        "slug": slug,
                        "invitation_token": invitation_token,
                        "admin_user_id": initial_admin.id,
                        "admin_email": admin_email,
                        "trial_ends_at": None,
                        "trial_status": (
                            ONBOARDING_SUBSCRIPTION_STATUS
                            if fixed_billing_required
                            else "active"
                        ),
                    }
            except HTTPException as exc:
                if (
                    requested_restaurant_id is None
                    and exc.status_code == status.HTTP_409_CONFLICT
                    and "subdomínio determinístico" not in str(exc.detail)
                    and "já foi provisionado" not in str(exc.detail)
                    and attempt + 1 < max_attempts
                ):
                    excluded_ids.add(tenant_id)
                    continue
                raise
            except IntegrityError:
                if db.in_transaction():
                    db.rollback()
                if requested_restaurant_id is None and attempt + 1 < max_attempts:
                    excluded_ids.add(tenant_id)
                    continue
                raise
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Não foi possível alocar um ID elegível livre para o restaurante.",
        )


QA_OPERATION_START = "SUPERADMIN_QA_OPERATION_START"
QA_OPERATION_END = "SUPERADMIN_QA_OPERATION_END"


def clear_operational_qa_cache(db: Session, restaurante_id: int) -> None:
    """Invalida caches de QA e prontidão provisória vinculados à sessão ORM atual."""
    db_info = getattr(db, "info", None)
    if not isinstance(db_info, dict):
        return
    rid = int(restaurante_id)
    for key in (
        "_koma_qa_record_by_rid",
        "_koma_qa_active_by_rid",
        "_koma_base_provisional_by_rid",
        "_koma_provisional_by_rid",
    ):
        bucket = db_info.get(key)
        if isinstance(bucket, dict):
            bucket.pop(rid, None)


def start_operational_qa_session(
    db: Session,
    *,
    restaurante_id: int,
    actor: str,
    reason: str,
    hours: int = 24,
) -> dict[str, Any]:
    """Abre uma janela temporária de homologação operacional QA em tenant provisório."""
    tid = int(restaurante_id)
    restaurante = db.query(Restaurante).filter(Restaurante.id == tid).one_or_none()
    if restaurante is None:
        raise HTTPException(status_code=404, detail="Restaurante não encontrado.")
    clear_operational_qa_cache(db, tid)
    if get_active_operational_qa_record(db, tid) is not None:
        raise HTTPException(status_code=409, detail="Janela de QA já ativa. Encerre antes de reiniciar.")
    if not is_provisional_preparation(db, tid, allow_qa=False):
        raise HTTPException(status_code=409, detail="Restaurante não está em implantação provisória.")

    bounded_hours = max(1, min(int(hours), 72))
    now = datetime.datetime.now(datetime.timezone.utc)
    expires_at = now + datetime.timedelta(hours=bounded_hours)
    raw_qa_token = f"{tid}.{secrets.token_urlsafe(24)}"
    qa_token_hash = hashlib.sha256(raw_qa_token.encode("utf-8")).hexdigest()
    qa_menu_path = f"/c/{restaurante.slug}?qa_token={raw_qa_token}"
    after = {
        "mode": "operational_qa",
        "started_at": now.isoformat(),
        "expires_at": expires_at.isoformat(),
        "hours": bounded_hours,
        "qa_token_hash": qa_token_hash,
        "commercial_contract_created": False,
        "subscription_created": False,
    }
    db.add(
        SuperAdminAuditLog(
            restaurante_id=tid,
            actor=str(actor),
            action=QA_OPERATION_START,
            reason=reason,
            before_data={"qa_active": False},
            after_data=after,
        )
    )
    db.commit()
    clear_operational_qa_cache(db, tid)
    return {
        "restaurantId": str(tid),
        "qaActive": True,
        "expiresAt": expires_at.isoformat(),
        "commercialContractCreated": False,
        "saasTrialStarted": False,
        "qaAccessToken": raw_qa_token,
        "qaMenuPath": qa_menu_path,
    }


def _load_provisioning_audit_snapshot(
    db: Session,
    rid: int,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Carrega em uma única consulta os marcos de onboarding e QA ativo do tenant."""
    db_info = getattr(db, "info", None)
    qa_cache = db_info.get("_koma_qa_record_by_rid") if isinstance(db_info, dict) else None
    onboard_cache = db_info.get("_koma_onboard_after_data_by_rid") if isinstance(db_info, dict) else None
    if (
        isinstance(qa_cache, dict)
        and rid in qa_cache
        and isinstance(onboard_cache, dict)
        and rid in onboard_cache
    ):
        return qa_cache[rid], onboard_cache[rid]

    rows = (
        db.query(
            SuperAdminAuditLog.action,
            SuperAdminAuditLog.after_data,
        )
        .filter(
            SuperAdminAuditLog.restaurante_id == rid,
            SuperAdminAuditLog.action.in_(
                (
                    "SUPERADMIN_TENANT_ONBOARD",
                    "UNIVERSAL_TENANT_PROVISION",
                    QA_OPERATION_START,
                    QA_OPERATION_END,
                )
            ),
        )
        .order_by(SuperAdminAuditLog.id.desc())
        .all()
    )

    latest_qa_action: str | None = None
    latest_qa_data: Any = None
    onboard_after_data: dict[str, Any] | None = None

    for action, after_data in rows:
        if latest_qa_action is None and action in (QA_OPERATION_START, QA_OPERATION_END):
            latest_qa_action = action
            latest_qa_data = after_data
        if onboard_after_data is None and action in (
            "SUPERADMIN_TENANT_ONBOARD",
            "UNIVERSAL_TENANT_PROVISION",
        ):
            onboard_after_data = dict(after_data) if isinstance(after_data, dict) else None
        if latest_qa_action is not None and onboard_after_data is not None:
            break

    active_data: dict[str, Any] | None = None
    if latest_qa_action == QA_OPERATION_START and isinstance(latest_qa_data, dict):
        raw_expiry = (
            latest_qa_data.get("expires_at")
            if latest_qa_data.get("mode") == "operational_qa"
            else None
        )
        if isinstance(raw_expiry, str):
            try:
                expires_at = datetime.datetime.fromisoformat(raw_expiry.replace("Z", "+00:00"))
                if expires_at.tzinfo is not None and (
                    datetime.datetime.now(datetime.timezone.utc) < expires_at.astimezone(datetime.timezone.utc)
                ):
                    active_data = dict(latest_qa_data)
            except ValueError:
                active_data = None

    if isinstance(db_info, dict):
        db_info.setdefault("_koma_qa_record_by_rid", {})[rid] = active_data
        db_info.setdefault("_koma_qa_active_by_rid", {})[rid] = active_data is not None
        db_info.setdefault("_koma_onboard_after_data_by_rid", {})[rid] = onboard_after_data
    return active_data, onboard_after_data


def get_active_operational_qa_record(
    db: Session,
    restaurante_id: int,
) -> dict[str, Any] | None:
    """Retorna os metadados da janela de QA operacional ativa, ou None se inativa/expirada."""
    if restaurante_id is None or restaurante_id <= 0:
        return None
    rid = int(restaurante_id)
    active_data, _ = _load_provisioning_audit_snapshot(db, rid)
    return active_data


def is_superadmin_operational_qa_active(db: Session, restaurante_id: int) -> bool:
    """Janela temporária autorizada pelo Super Admin para testes operacionais.

    Esta janela é independente de contrato, assinatura, cobrança e trial SaaS.
    É revogável, possui validade curta e nunca concede acesso entre tenants.
    """
    return get_active_operational_qa_record(db, restaurante_id) is not None


def validate_operational_qa_token(
    db: Session,
    restaurante_id: int,
    raw_token: str | None,
) -> bool:
    """Valida em tempo constante o token efêmero de acesso ao cardápio em modo QA."""
    token = str(raw_token or "").strip()
    if not token or "." not in token or restaurante_id is None or restaurante_id <= 0:
        return False
    tid_part, secret_part = token.split(".", 1)
    if not tid_part.isdigit() or int(tid_part) != int(restaurante_id) or len(secret_part) < 16:
        return False
    record = get_active_operational_qa_record(db, int(restaurante_id))
    if not record:
        return False
    expected_hash = str(record.get("qa_token_hash") or "").strip().lower()
    if len(expected_hash) != 64:
        return False
    actual_hash = hashlib.sha256(token.encode("utf-8")).hexdigest().lower()
    return hmac.compare_digest(actual_hash, expected_hash)


def _is_base_provisional_preparation(db: Session, restaurante_id: int) -> bool:
    rid = int(restaurante_id)
    db_info = getattr(db, "info", None)
    base_cache = db_info.get("_koma_base_provisional_by_rid") if isinstance(db_info, dict) else None
    if isinstance(base_cache, dict) and rid in base_cache:
        base_provisional = bool(base_cache[rid])
    else:
        def _cache_base(value: bool) -> bool:
            if isinstance(db_info, dict):
                db_info.setdefault("_koma_base_provisional_by_rid", {})[rid] = value
            return value

        _, after_data = _load_provisioning_audit_snapshot(db, rid)
        if not isinstance(after_data, dict) or after_data.get("trial_status") != "pending_setup":
            base_provisional = _cache_base(False)
        else:
            sub_exists = (
                db.query(SaaSSubscription.id)
                .filter(SaaSSubscription.restaurante_id == rid)
                .first()
            )
            if sub_exists is not None:
                base_provisional = _cache_base(False)
            else:
                from ..contract_models import RestaurantContractAcceptance
                contract_exists = (
                    db.query(RestaurantContractAcceptance.id)
                    .filter(RestaurantContractAcceptance.restaurante_id == rid)
                    .first()
                )
                base_provisional = _cache_base(contract_exists is None)

    if not base_provisional:
        return False

    # Exceção operacional explícita e reversível configurada apenas quando autorizada.
    allowed_raw = os.getenv("KOMA_PROVISIONAL_OPERATION_ALLOWLIST", "").strip()
    allowed_ids = [value.strip() for value in allowed_raw.split(",")] if allowed_raw else []
    if (
        allowed_ids
        and all(re.fullmatch(r"[1-9][0-9]*", value) for value in allowed_ids)
        and str(rid) in allowed_ids
    ):
        restaurant = (
            db.query(Restaurante)
            .filter(Restaurante.id == rid)
            .one_or_none()
        )
        if restaurant is not None and str(restaurant.saas_status or "").lower() == "active":
            logger.warning("PROVISIONAL_OPERATION_OVERRIDE tenant=%s", rid)
            return False

    return True


def is_provisional_preparation(
    db: Session,
    restaurante_id: int,
    *,
    allow_qa: bool = True,
    qa_token: str | None = None,
) -> bool:
    """Retorna True se o restaurante está em preparação provisória sem liberação para o canal.

    Para canais públicos (`allow_qa=False`), uma janela de QA ativa só libera acesso
    mediante ``qa_token`` criptográfico válido para este tenant.
    """
    if restaurante_id is None or restaurante_id <= 0:
        return False

    if not _is_base_provisional_preparation(db, restaurante_id):
        return False

    if allow_qa:
        return not is_superadmin_operational_qa_active(db, restaurante_id)
    return not validate_operational_qa_token(db, restaurante_id, qa_token)


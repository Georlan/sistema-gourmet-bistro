from __future__ import annotations

import datetime
import hashlib
import hmac
import json
import secrets
import uuid
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import HTTPException, Request, status
from sqlalchemy import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..contract_models import ContractAcceptance, RestaurantContractAcceptance
from ..contract_validation import is_valid_cpf, normalize_tax_id, tax_id_kind
from ..crypt import encrypt_field
from ..legal_config import (
    LEGAL_SOURCE_BLOB_SHA,
    LEGAL_SOURCE_COMMIT,
    LEGAL_VERSION,
    get_legal_provider_identity,
)
from ..models import Restaurante, SuperAdminAuditLog
from ..saas_billing_models import SaaSPlanChange, SaaSSubscription
from ..subscription import (
    COMMERCIAL_PRICING_VERSION,
    subscription_annual_monthly_equivalent,
    subscription_annual_total,
    subscription_marketplace_rate,
    subscription_monthly_price,
)
from .billing_service import tenant_commercial_terms
from .saas_mercadopago import SaasMercadoPagoError, default_saas_mp_service


_EXPECTED_DOCUMENTS = {
    "terms": "termos",
    "commercial": "planos",
    "dpa": "dpa",
    "privacy": "privacidade",
}
_RECURRING_METHODS = {"credit_card", "account_money", "pix_automatic"}
_MONEY = Decimal("0.01")


def _clean_text(value: str) -> str:
    return " ".join(value.strip().split())


def _canonical_document(document: dict[str, Any]) -> str:
    return json.dumps(
        document,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _document_hash(snapshot: str) -> str:
    return hashlib.sha256(snapshot.encode("utf-8")).hexdigest()


def _evidence_hash(value: str) -> str:
    return hmac.new(
        settings.SECRET_KEY.encode("utf-8"),
        value.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _resolve_source_ip(request: Request) -> tuple[str, str]:
    cloudflare_ip = (request.headers.get("cf-connecting-ip") or "").strip()
    if cloudflare_ip:
        return cloudflare_ip[:128], "cf-connecting-ip"
    forwarded = (request.headers.get("x-forwarded-for") or "").strip()
    if forwarded:
        first = forwarded.split(",", 1)[0].strip()
        if first:
            return first[:128], "x-forwarded-for"
    client = request.client.host if request.client else "unknown"
    return str(client)[:128], "direct"


def _validate_legal_bundle(payload: Any) -> dict[str, str]:
    if payload.legal_version != LEGAL_VERSION:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A versão jurídica exibida ficou desatualizada. Recarregue a página.",
        )
    if (
        payload.legal_source_commit != LEGAL_SOURCE_COMMIT
        or payload.legal_source_blob_sha != LEGAL_SOURCE_BLOB_SHA
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A origem dos documentos jurídicos não corresponde à versão vigente.",
        )
    if set(payload.documents) != set(_EXPECTED_DOCUMENTS):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Pacote jurídico incompleto.",
        )

    snapshots: dict[str, str] = {}
    for key, expected_slug in _EXPECTED_DOCUMENTS.items():
        document = payload.documents.get(key)
        if not isinstance(document, dict):
            raise HTTPException(422, f"Documento jurídico inválido: {key}.")
        if document.get("slug") != expected_slug or document.get("version") != LEGAL_VERSION:
            raise HTTPException(
                409,
                f"Documento jurídico desatualizado: {expected_slug}.",
            )
        snapshots[key] = _canonical_document(document)
    return snapshots


def _serialize_money(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return f"{value.quantize(_MONEY):.2f}"


def _serialize_rate(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.000001')):.6f}"


def _cycle_kind(value: str | None) -> str:
    clean = str(value or "").strip().lower()
    if clean in {"mensal", "monthly"}:
        return "monthly"
    if clean in {"anual", "annual"}:
        return "annual"
    return clean


def _target_financials(plan: str, billing_cycle: str) -> tuple[Decimal, Decimal, Decimal | None, Decimal]:
    fixed = subscription_monthly_price(plan)
    rate = subscription_marketplace_rate(plan)
    if _cycle_kind(billing_cycle) == "annual":
        billing = subscription_annual_total(plan)
        equivalent = subscription_annual_monthly_equivalent(plan)
    else:
        billing = fixed
        equivalent = None
    return fixed, billing, equivalent, rate


def _provider_action(
    subscription: SaaSSubscription,
    *,
    current_billing_amount: Decimal,
    target_billing_amount: Decimal,
) -> str:
    method = str(subscription.payment_method_type or "").strip().lower()
    provider_ref = str(subscription.provider_subscription_id or "").strip()

    if target_billing_amount <= 0:
        if method in _RECURRING_METHODS and provider_ref:
            return "cancel"
        if method == "pix" and provider_ref:
            return "verify_pix"
        return "none"

    if current_billing_amount <= 0:
        return "billing_setup_required"
    if method == "pix":
        return "verify_pix" if provider_ref else "none"
    if method in _RECURRING_METHODS and provider_ref:
        return "update_amount"
    return "billing_setup_required"


def create_plan_change(
    db: Session,
    *,
    tenant_id: int,
    user_id: str,
    payload: Any,
    request: Request,
) -> dict[str, Any]:
    if payload.signup_token:
        raise HTTPException(422, "Mudança de plano autenticada não usa token de inscrição.")
    if not payload.powers_declared:
        raise HTTPException(422, "A declaração de poderes para contratar é obrigatória.")

    try:
        current_terms = tenant_commercial_terms(db, tenant_id)
    except RuntimeError as exc:
        raise HTTPException(409, "Os termos comerciais atuais estão indisponíveis.") from exc
    if current_terms is None:
        raise HTTPException(
            409,
            "Tenant legado sem aceite vinculado exige migração comercial supervisionada.",
        )

    restaurant = (
        db.query(Restaurante)
        .filter(Restaurante.id == tenant_id)
        .with_for_update()
        .one_or_none()
    )
    subscription = (
        db.query(SaaSSubscription)
        .filter(SaaSSubscription.restaurante_id == tenant_id)
        .with_for_update()
        .one_or_none()
    )
    if restaurant is None or subscription is None:
        raise HTTPException(409, "Assinatura canônica do restaurante não está disponível.")
    if str(subscription.status or "").strip().lower() != "active":
        raise HTTPException(
            409,
            "Mudança de plano só pode ser aplicada com a assinatura canônica ativa.",
        )

    active_change = (
        db.query(SaaSPlanChange)
        .filter(
            SaaSPlanChange.restaurante_id == tenant_id,
            SaaSPlanChange.status.in_(("pending", "provider_syncing", "provider_synced")),
        )
        .one_or_none()
    )
    if active_change is not None:
        raise HTTPException(
            409,
            "Já existe uma mudança comercial em andamento para este restaurante.",
        )

    fixed, billing_amount, annual_equivalent, target_rate = _target_financials(
        payload.plan,
        payload.billing_cycle,
    )
    if payload.plan == "pocket" and _cycle_kind(payload.billing_cycle) != "monthly":
        raise HTTPException(
            422,
            "Pocket não possui componente fixo anual. A mudança deve usar ciclo mensal.",
        )
    if fixed > 0 and _cycle_kind(payload.billing_cycle) != _cycle_kind(current_terms.billing_cycle):
        raise HTTPException(
            409,
            "Mudança de ciclo de cobrança não faz parte do fluxo canônico de troca de plano v1.",
        )

    same_commercial_terms = (
        current_terms.plan == payload.plan
        and _cycle_kind(current_terms.billing_cycle) == _cycle_kind(payload.billing_cycle)
        and current_terms.fixed_monthly_price.quantize(_MONEY) == fixed.quantize(_MONEY)
        and current_terms.billing_amount.quantize(_MONEY) == billing_amount.quantize(_MONEY)
        and current_terms.marketplace_rate == target_rate
        and current_terms.pricing_version == COMMERCIAL_PRICING_VERSION
    )
    if same_commercial_terms:
        raise HTTPException(409, "O restaurante já possui estes termos comerciais.")

    snapshots = _validate_legal_bundle(payload)
    hashes = {key: _document_hash(value) for key, value in snapshots.items()}

    contracting_tax_id = normalize_tax_id(payload.contracting_party_tax_id)
    contracting_kind = tax_id_kind(contracting_tax_id)
    if contracting_kind is None:
        raise HTTPException(422, "CPF/CNPJ do contratante inválido.")
    representative_tax_id = normalize_tax_id(payload.representative_tax_id)
    if not is_valid_cpf(representative_tax_id):
        raise HTTPException(422, "CPF do representante inválido.")

    try:
        provider = get_legal_provider_identity()
    except RuntimeError as exc:
        raise HTTPException(
            503,
            "Identificação jurídica do prestador ainda não está configurada.",
        ) from exc

    now = datetime.datetime.now(datetime.timezone.utc)
    local_now = now.astimezone(ZoneInfo("America/Fortaleza"))
    protocol = f"KOMA-CTR-{now:%Y%m%d}-{secrets.token_hex(6).upper()}"
    acceptance_id = str(uuid.uuid4())
    change_id = str(uuid.uuid4())
    source_ip, ip_source = _resolve_source_ip(request)
    user_agent = (request.headers.get("user-agent") or "não informado").strip()[:1024]
    action = _provider_action(
        subscription,
        current_billing_amount=current_terms.billing_amount,
        target_billing_amount=billing_amount,
    )

    receipt: dict[str, Any] = {
        "protocol": protocol,
        "acceptedAtUtc": now.isoformat(),
        "acceptedAtBrasilia": local_now.isoformat(),
        "contractPurpose": "plan_change",
        "provider": {
            "name": provider.name,
            "taxId": provider.tax_id,
            "address": provider.address,
            "location": provider.location,
        },
        "contractingParty": {
            "name": _clean_text(payload.contracting_party_name),
            "taxId": contracting_tax_id,
            "taxIdKind": contracting_kind,
            "restaurantName": _clean_text(payload.restaurant_name),
            "email": payload.email,
            "phone": _clean_text(payload.phone),
        },
        "representative": {
            "name": _clean_text(payload.representative_name),
            "taxId": representative_tax_id,
            "role": _clean_text(payload.representative_role),
            "powersDeclared": True,
        },
        "commercial": {
            "pricingVersion": COMMERCIAL_PRICING_VERSION,
            "plan": payload.plan,
            "billingCycle": payload.billing_cycle,
            "fixedMonthlyPrice": _serialize_money(fixed),
            "billingAmount": _serialize_money(billing_amount),
            "annualMonthlyEquivalent": _serialize_money(annual_equivalent),
            "marketplaceRate": _serialize_rate(target_rate),
            "fixedBillingRequired": billing_amount > 0,
            "trialDays": 0,
            "trialWaivesFixedFeeOnly": False,
        },
        "change": {
            "fromProtocol": current_terms.protocol,
            "fromPlan": current_terms.plan,
            "fromPricingVersion": current_terms.pricing_version,
            "fromFixedMonthlyPrice": _serialize_money(current_terms.fixed_monthly_price),
            "fromBillingAmount": _serialize_money(current_terms.billing_amount),
            "fromMarketplaceRate": _serialize_rate(current_terms.marketplace_rate),
            "toPlan": payload.plan,
            "effectiveRule": "provider_sync_then_atomic_apply",
        },
        "documents": {
            "version": LEGAL_VERSION,
            "terms": {"slug": "termos", "hash": hashes["terms"]},
            "commercial": {"slug": "planos", "hash": hashes["commercial"]},
            "dpa": {"slug": "dpa", "hash": hashes["dpa"]},
            "privacy": {"slug": "privacidade", "hash": hashes["privacy"]},
            "sourceCommit": LEGAL_SOURCE_COMMIT,
            "sourceBlobSha": LEGAL_SOURCE_BLOB_SHA,
        },
        "evidence": {
            "requestId": payload.request_id,
            "sourceIp": source_ip,
            "ipSource": ip_source,
            "sourceIpHash": _evidence_hash(source_ip),
            "userAgent": user_agent,
            "userAgentHash": _evidence_hash(user_agent),
        },
        "provisioning": {
            "status": "plan_change_pending",
            "message": (
                "Novos termos aceitos. Eles só se tornam autoridade após a "
                "sincronização financeira e a aplicação atômica da mudança."
            ),
        },
    }

    values = {
        "id": acceptance_id,
        "protocol": protocol,
        "request_id": payload.request_id,
        "contracting_party_name": _clean_text(payload.contracting_party_name),
        "contracting_party_tax_id_encrypted": encrypt_field(contracting_tax_id),
        "contracting_party_tax_id_last4": contracting_tax_id[-4:],
        "restaurant_name": _clean_text(payload.restaurant_name),
        "representative_name": _clean_text(payload.representative_name),
        "representative_tax_id_encrypted": encrypt_field(representative_tax_id),
        "representative_tax_id_last4": representative_tax_id[-4:],
        "representative_role": _clean_text(payload.representative_role),
        "email": payload.email,
        "phone": _clean_text(payload.phone),
        "plan": payload.plan,
        "billing_cycle": payload.billing_cycle,
        "fixed_monthly_price": fixed,
        "billing_amount": billing_amount,
        "annual_monthly_equivalent": annual_equivalent,
        "marketplace_rate": target_rate,
        "legal_version": LEGAL_VERSION,
        "terms_hash": hashes["terms"],
        "commercial_hash": hashes["commercial"],
        "dpa_hash": hashes["dpa"],
        "privacy_hash": hashes["privacy"],
        "terms_snapshot": snapshots["terms"],
        "commercial_snapshot": snapshots["commercial"],
        "dpa_snapshot": snapshots["dpa"],
        "privacy_snapshot": snapshots["privacy"],
        "legal_source_commit": LEGAL_SOURCE_COMMIT,
        "legal_source_blob_sha": LEGAL_SOURCE_BLOB_SHA,
        "powers_declared": True,
        "accepted_at": now,
        "source_ip_encrypted": encrypt_field(source_ip),
        "source_ip_hash": _evidence_hash(source_ip),
        "user_agent": user_agent,
        "user_agent_hash": _evidence_hash(user_agent),
        "receipt_snapshot_encrypted": encrypt_field(
            json.dumps(receipt, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        ),
    }

    try:
        db.execute(insert(ContractAcceptance.__table__).values(**values))
        change = SaaSPlanChange(
            id=change_id,
            restaurante_id=tenant_id,
            acceptance_id=acceptance_id,
            source_protocol=current_terms.protocol,
            source_plan=current_terms.plan,
            target_plan=payload.plan,
            billing_cycle=payload.billing_cycle,
            target_billing_amount=billing_amount,
            target_marketplace_rate=target_rate,
            pricing_version=COMMERCIAL_PRICING_VERSION,
            status="pending",
            provider_action=action,
            requested_by_user_id=str(user_id),
            created_at=now,
            updated_at=now,
        )
        db.add(change)
        db.add(
            SuperAdminAuditLog(
                restaurante_id=tenant_id,
                actor=f"usuario:{user_id}",
                action="SUBSCRIPTION_PLAN_CHANGE_ACCEPTED",
                reason="Novos termos comerciais aceitos pelo administrador do restaurante",
                before_data={
                    "protocol": current_terms.protocol,
                    "plan": current_terms.plan,
                    "billing_amount": _serialize_money(current_terms.billing_amount),
                    "marketplace_rate": _serialize_rate(current_terms.marketplace_rate),
                },
                after_data={
                    "change_id": change_id,
                    "protocol": protocol,
                    "plan": payload.plan,
                    "billing_amount": _serialize_money(billing_amount),
                    "marketplace_rate": _serialize_rate(target_rate),
                    "provider_action": action,
                    "status": "pending",
                },
            )
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            409,
            "Esta mudança já foi registrada ou existe outra mudança em andamento.",
        ) from exc

    return {
        "id": change_id,
        "status": "pending",
        "protocol": protocol,
        "sourceProtocol": current_terms.protocol,
        "sourcePlan": current_terms.plan,
        "targetPlan": payload.plan,
        "billingCycle": payload.billing_cycle,
        "providerAction": action,
        "billingSetupRequired": action == "billing_setup_required",
        "receipt": receipt,
    }


def _parse_provider_datetime(value: object) -> datetime.datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=datetime.timezone.utc)
    return parsed.astimezone(datetime.timezone.utc)


def _sync_provider(change: SaaSPlanChange, subscription: SaaSSubscription) -> None:
    action = str(change.provider_action or "none")
    provider_ref = str(subscription.provider_subscription_id or "").strip()

    if action == "billing_setup_required":
        raise HTTPException(
            409,
            "A mudança exige configurar um meio de cobrança antes da aplicação.",
        )
    if action == "none":
        return
    if action == "verify_pix":
        if not provider_ref:
            return
        try:
            payment = default_saas_mp_service.get_payment(provider_ref)
        except SaasMercadoPagoError as exc:
            raise HTTPException(
                502,
                "Não foi possível verificar a cobrança Pix atual antes da troca.",
            ) from exc
        provider_status = str(payment.get("status") or "").strip().lower()
        expires_at = _parse_provider_datetime(payment.get("date_of_expiration"))
        now = datetime.datetime.now(datetime.timezone.utc)
        if provider_status in {"pending", "in_process"} and (
            expires_at is None or now < expires_at
        ):
            raise HTTPException(
                409,
                "Existe uma cobrança Pix pendente. Aguarde o pagamento ou a expiração antes de trocar o plano.",
            )
        if provider_status == "approved":
            approved_at = _parse_provider_datetime(payment.get("date_approved"))
            current_period_start = subscription.current_period_start
            if current_period_start is not None and current_period_start.tzinfo is None:
                current_period_start = current_period_start.replace(
                    tzinfo=datetime.timezone.utc
                )
            elif current_period_start is not None:
                current_period_start = current_period_start.astimezone(
                    datetime.timezone.utc
                )
            if (
                approved_at is None
                or current_period_start is None
                or current_period_start < approved_at
            ):
                raise HTTPException(
                    409,
                    "Existe um Pix aprovado aguardando reconciliação. "
                    "Aguarde o KÔMA atualizar o período pago antes de trocar o plano.",
                )
        return
    if not provider_ref:
        raise HTTPException(409, "Assinatura recorrente sem vínculo com o provedor.")

    if action == "update_amount":
        try:
            current = default_saas_mp_service.get_preapproval(provider_ref)
            current_status = str(current.get("status") or "").strip().lower()
            if current_status in {"cancelled", "canceled"}:
                raise HTTPException(
                    409,
                    "A recorrência atual está cancelada e precisa de novo setup de cobrança.",
                )
            current_amount = (
                (current.get("auto_recurring") or {}).get("transaction_amount")
                if isinstance(current, dict)
                else None
            )
            if current_amount is not None and Decimal(str(current_amount)).quantize(_MONEY) == Decimal(
                str(change.target_billing_amount)
            ).quantize(_MONEY):
                return
            result = default_saas_mp_service.update_preapproval_amount(
                provider_ref,
                amount=Decimal(str(change.target_billing_amount)),
                plan=change.target_plan,
            )
        except SaasMercadoPagoError as exc:
            raise HTTPException(
                502,
                "O gateway não confirmou o novo valor da assinatura.",
            ) from exc
        if str(result.get("status") or "").strip().lower() in {"cancelled", "canceled"}:
            raise HTTPException(502, "O gateway devolveu a assinatura como cancelada.")
        return

    if action == "cancel":
        try:
            current = default_saas_mp_service.get_preapproval(provider_ref)
            current_status = str(current.get("status") or "").strip().lower()
            if current_status not in {"cancelled", "canceled"}:
                result = default_saas_mp_service.cancel_preapproval(provider_ref)
                if str(result.get("status") or "").strip().lower() not in {
                    "cancelled",
                    "canceled",
                }:
                    raise HTTPException(
                        502,
                        "O gateway ainda não confirmou o cancelamento da recorrência.",
                    )
        except SaasMercadoPagoError as exc:
            raise HTTPException(
                502,
                "Não foi possível cancelar a recorrência antes de ativar o Pocket.",
            ) from exc
        return

    raise HTTPException(409, "Ação financeira de mudança de plano desconhecida.")


def apply_plan_change(
    db: Session,
    *,
    tenant_id: int,
    user_id: str,
    change_id: str,
) -> dict[str, Any]:
    change = (
        db.query(SaaSPlanChange)
        .filter(
            SaaSPlanChange.id == change_id,
            SaaSPlanChange.restaurante_id == tenant_id,
        )
        .with_for_update()
        .one_or_none()
    )
    if change is None:
        raise HTTPException(404, "Mudança de plano não encontrada.")
    if change.status == "applied":
        return {
            "id": change.id,
            "status": "applied",
            "targetPlan": change.target_plan,
            "protocol": None,
            "idempotent": True,
        }
    if change.status == "canceled":
        raise HTTPException(409, "Esta mudança de plano foi cancelada.")

    try:
        current_terms = tenant_commercial_terms(db, tenant_id)
    except RuntimeError as exc:
        raise HTTPException(409, "Os termos comerciais atuais estão indisponíveis.") from exc
    if current_terms is None or current_terms.protocol != change.source_protocol:
        raise HTTPException(
            409,
            "A autoridade comercial mudou desde este aceite. Inicie uma nova troca de plano.",
        )

    subscription = (
        db.query(SaaSSubscription)
        .filter(SaaSSubscription.restaurante_id == tenant_id)
        .with_for_update()
        .one_or_none()
    )
    if subscription is None or str(subscription.status or "").strip().lower() != "active":
        raise HTTPException(409, "A assinatura canônica precisa estar ativa para aplicar a troca.")

    if change.status != "provider_synced":
        if change.provider_action == "billing_setup_required":
            raise HTTPException(
                409,
                "A mudança foi aceita, mas exige configurar um novo meio de cobrança.",
            )
        change.status = "provider_syncing"
        change.last_error_code = None
        change.updated_at = datetime.datetime.now(datetime.timezone.utc)
        db.commit()

        try:
            _sync_provider(change, subscription)
        except HTTPException as exc:
            change = (
                db.query(SaaSPlanChange)
                .filter(
                    SaaSPlanChange.id == change_id,
                    SaaSPlanChange.restaurante_id == tenant_id,
                )
                .with_for_update()
                .one()
            )
            change.status = "pending"
            change.last_error_code = (
                "pending_pix_invoice" if exc.status_code == 409 else "provider_sync_failed"
            )
            change.updated_at = datetime.datetime.now(datetime.timezone.utc)
            db.commit()
            raise

        change = (
            db.query(SaaSPlanChange)
            .filter(
                SaaSPlanChange.id == change_id,
                SaaSPlanChange.restaurante_id == tenant_id,
            )
            .with_for_update()
            .one()
        )
        change.status = "provider_synced"
        change.provider_synced_at = datetime.datetime.now(datetime.timezone.utc)
        change.last_error_code = None
        change.updated_at = change.provider_synced_at
        db.commit()

    change = (
        db.query(SaaSPlanChange)
        .filter(
            SaaSPlanChange.id == change_id,
            SaaSPlanChange.restaurante_id == tenant_id,
        )
        .with_for_update()
        .one()
    )
    subscription = (
        db.query(SaaSSubscription)
        .filter(SaaSSubscription.restaurante_id == tenant_id)
        .with_for_update()
        .one()
    )
    restaurant = (
        db.query(Restaurante)
        .filter(Restaurante.id == tenant_id)
        .with_for_update()
        .one()
    )
    current_terms = tenant_commercial_terms(db, tenant_id)
    if current_terms is None or current_terms.protocol != change.source_protocol:
        raise HTTPException(
            409,
            "A autoridade comercial mudou durante a sincronização. A aplicação foi interrompida.",
        )

    existing_link = (
        db.query(RestaurantContractAcceptance)
        .filter(RestaurantContractAcceptance.acceptance_id == change.acceptance_id)
        .one_or_none()
    )
    if existing_link is not None:
        raise HTTPException(
            409,
            "O novo aceite já foi vinculado fora do fluxo canônico; revisão necessária.",
        )

    before_plan = str(restaurant.plano or "")
    before_method = str(subscription.payment_method_type or "") or None
    before_provider_ref = str(subscription.provider_subscription_id or "") or None
    now = datetime.datetime.now(datetime.timezone.utc)

    db.add(
        RestaurantContractAcceptance(
            id=str(uuid.uuid4()),
            restaurante_id=tenant_id,
            acceptance_id=change.acceptance_id,
            linked_at=now,
        )
    )
    restaurant.plano = change.target_plan

    if Decimal(str(change.target_billing_amount)).quantize(_MONEY) <= 0:
        subscription.provider_customer_id = None
        subscription.provider_subscription_id = None
        subscription.payment_method_type = None
        subscription.billing_cycle = "monthly"
        subscription.status = "active"
        subscription.trial_started_at = None
        subscription.trial_ends_at = None
        subscription.current_period_start = None
        subscription.current_period_end = None
        subscription.grace_until = None
    else:
        subscription.billing_cycle = _cycle_kind(change.billing_cycle)
        subscription.status = "active"

    subscription.updated_at = now
    change.status = "applied"
    change.applied_at = now
    change.updated_at = now

    db.add(
        SuperAdminAuditLog(
            restaurante_id=tenant_id,
            actor=f"usuario:{user_id}",
            action="SUBSCRIPTION_PLAN_CHANGE_APPLY",
            reason="Mudança comercial aplicada após sincronização financeira",
            before_data={
                "protocol": current_terms.protocol,
                "plan": current_terms.plan,
                "billing_amount": _serialize_money(current_terms.billing_amount),
                "marketplace_rate": _serialize_rate(current_terms.marketplace_rate),
                "payment_method_type": before_method,
                "provider_reference_present": bool(before_provider_ref),
            },
            after_data={
                "change_id": change.id,
                "acceptance_id": change.acceptance_id,
                "plan": change.target_plan,
                "billing_amount": _serialize_money(
                    Decimal(str(change.target_billing_amount))
                ),
                "marketplace_rate": _serialize_rate(
                    Decimal(str(change.target_marketplace_rate))
                ),
                "provider_action": change.provider_action,
                "status": "applied",
            },
        )
    )
    db.commit()

    return {
        "id": change.id,
        "status": "applied",
        "sourcePlan": before_plan,
        "targetPlan": change.target_plan,
        "marketplaceRate": _serialize_rate(
            Decimal(str(change.target_marketplace_rate))
        ),
        "billingAmount": _serialize_money(
            Decimal(str(change.target_billing_amount))
        ),
        "providerAction": change.provider_action,
        "idempotent": False,
    }

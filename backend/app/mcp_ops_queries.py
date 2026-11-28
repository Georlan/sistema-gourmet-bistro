"""Authoritative read-only engineering MCP queries for checkout outcomes and print flow."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import case, func, select, text
from sqlalchemy.orm import Session

from .database import tenant_session_scope
from .mcp_db_guard import DEFAULT_STATEMENT_TIMEOUT_MS, configure_readonly_tx
from .models import (
    Categoria,
    Comanda,
    ConfiguracaoRestaurante,
    GrupoModificador,
    PrintAgentToken,
    PrintJob,
    Produto,
    ProdutoFamilia,
    RestaurantPaymentAccount,
    Restaurante,
)
from .restaurant_profile_models import RestauranteOperationProfile
from .services.operational_modes import explicit_order_types
from .services.tenant_deprovisioning import verify_tenant_deprovisioned
from .services.universal_provisioning import (
    DEFAULT_TRIAL_DAYS,
    UniversalProvisioningInput,
    provision_restaurant,
    restaurant_trials,
)

ALLOWED_CHECKOUT_WINDOWS = (15, 60, 1440)
AGENT_ONLINE_THRESHOLD_SECONDS = 90
PRINT_DELAY_THRESHOLD_SECONDS = 120
PRINT_RECENT_WINDOW_MINUTES = 60

_ACCEPTED_DELIVERY_STATUSES = ("aceito", "producao", "pronto", "transito", "finalizado")
_AWAITING_DELIVERY_STATUSES = ("analise", "pendente")
_ONLINE_PENDING_STATUSES = ("pending", "pending_released")
_ONLINE_FAILED_STATUSES = ("rejected", "cancelled", "expired", "error")


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _query_cutoff(db: Session, dt: datetime) -> datetime:
    bind = db.get_bind()
    if bind is not None and bind.dialect.name == "sqlite":
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.astimezone(timezone.utc)


def _discover_restaurant_ids(db: Session) -> list[int]:
    bind = db.get_bind()
    if bind is not None and bind.dialect.name == "postgresql":
        rows = db.execute(
            text("SELECT id FROM koma_internal.list_public_restaurants() ORDER BY id")
        ).scalars().all()
    else:
        rows = db.execute(text("SELECT id FROM restaurantes ORDER BY id")).scalars().all()
    return [int(row) for row in rows if row is not None and int(row) > 0]


def get_checkout_outcomes(
    db: Session,
    *,
    window_minutes: int = 60,
    now: datetime | None = None,
    statement_timeout_ms: int = DEFAULT_STATEMENT_TIMEOUT_MS,
) -> dict[str, Any]:
    """Aggregate persisted order and online payment outcomes across tenants without PII or IDs."""
    if isinstance(window_minutes, bool) or not isinstance(window_minutes, int) or window_minutes not in ALLOWED_CHECKOUT_WINDOWS:
        return {
            "status": "unknown",
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "window_minutes must be one of 15, 60, or 1440.",
                "retryable": False,
            },
        }

    ref_now = _as_utc(now) or datetime.now(timezone.utc)
    cutoff = _query_cutoff(db, ref_now - timedelta(minutes=window_minutes))
    restaurant_ids = _discover_restaurant_ids(db)

    total_orders = 0
    accepted_or_progressed = 0
    awaiting_acceptance = 0
    refused = 0
    in_store_or_untracked = 0
    online_approved = 0
    online_pending = 0
    online_failed = 0
    tenants_with_activity = 0

    for rid in restaurant_ids:
        with tenant_session_scope(db, rid):
            configure_readonly_tx(db, statement_timeout_ms=statement_timeout_ms)
            row = (
                db.query(
                    func.count(Comanda.id),
                    func.coalesce(
                        func.sum(case((Comanda.delivery_status.in_(_ACCEPTED_DELIVERY_STATUSES), 1), else_=0)),
                        0,
                    ),
                    func.coalesce(
                        func.sum(case((Comanda.delivery_status.in_(_AWAITING_DELIVERY_STATUSES), 1), else_=0)),
                        0,
                    ),
                    func.coalesce(
                        func.sum(case((Comanda.delivery_status == "recusado", 1), else_=0)),
                        0,
                    ),
                    func.coalesce(
                        func.sum(case((Comanda.delivery_status.is_(None), 1), else_=0)),
                        0,
                    ),
                    func.coalesce(
                        func.sum(case((Comanda.online_payment_status == "approved", 1), else_=0)),
                        0,
                    ),
                    func.coalesce(
                        func.sum(case((Comanda.online_payment_status.in_(_ONLINE_PENDING_STATUSES), 1), else_=0)),
                        0,
                    ),
                    func.coalesce(
                        func.sum(case((Comanda.online_payment_status.in_(_ONLINE_FAILED_STATUSES), 1), else_=0)),
                        0,
                    ),
                )
                .filter(
                    Comanda.restaurante_id == rid,
                    Comanda.criado_em >= cutoff,
                    Comanda.onboarding_test.is_(False),
                )
                .one()
            )
            tenant_total = int(row[0] or 0)
            if tenant_total > 0:
                tenants_with_activity += 1
            total_orders += tenant_total
            accepted_or_progressed += int(row[1] or 0)
            awaiting_acceptance += int(row[2] or 0)
            refused += int(row[3] or 0)
            in_store_or_untracked += int(row[4] or 0)
            online_approved += int(row[5] or 0)
            online_pending += int(row[6] or 0)
            online_failed += int(row[7] or 0)

    status = "normal"
    if total_orders == 0:
        status = "normal"
    elif online_failed > 0 and online_approved == 0 and accepted_or_progressed == 0:
        status = "degraded"

    return {
        "status": status,
        "window_minutes": window_minutes,
        "observed_at": ref_now.isoformat(),
        "tenants_with_activity_count": tenants_with_activity,
        "persisted_orders": {
            "total": total_orders,
            "accepted_or_progressed": accepted_or_progressed,
            "awaiting_acceptance": awaiting_acceptance,
            "refused": refused,
            "in_store_or_untracked_delivery": in_store_or_untracked,
        },
        "online_payments": {
            "approved": online_approved,
            "pending_or_released": online_pending,
            "failed_or_cancelled": online_failed,
        },
        "coverage": {
            "source": "authoritative_database_readonly",
            "denominator_scope": "persisted_comandas_excluding_onboarding_test",
            "pre_persistence_failures_included": False,
            "cache_ttl_seconds": 20,
        },
    }


def get_print_flow_summary(
    db: Session,
    *,
    now: datetime | None = None,
    statement_timeout_ms: int = DEFAULT_STATEMENT_TIMEOUT_MS,
) -> dict[str, Any]:
    """Aggregate print queue backlog and agent liveness without mutating state or exposing tenant IDs."""
    ref_now = _as_utc(now) or datetime.now(timezone.utc)
    recent_cutoff = _query_cutoff(db, ref_now - timedelta(minutes=PRINT_RECENT_WINDOW_MINUTES))
    online_cutoff = ref_now - timedelta(seconds=AGENT_ONLINE_THRESHOLD_SECONDS)
    delay_cutoff = ref_now - timedelta(seconds=PRINT_DELAY_THRESHOLD_SECONDS)
    restaurant_ids = _discover_restaurant_ids(db)

    pending_count = 0
    claimed_count = 0
    printing_count = 0
    printed_last_60m = 0
    failed_last_60m = 0
    cancelled_last_60m = 0
    delayed_unresolved_jobs = 0
    oldest_unresolved_dt: datetime | None = None
    active_agents_total = 0
    agents_online = 0

    for rid in restaurant_ids:
        with tenant_session_scope(db, rid):
            configure_readonly_tx(db, statement_timeout_ms=statement_timeout_ms)

            job_counts = (
                db.query(
                    func.coalesce(func.sum(case((PrintJob.status == "pending", 1), else_=0)), 0),
                    func.coalesce(func.sum(case((PrintJob.status == "claimed", 1), else_=0)), 0),
                    func.coalesce(func.sum(case((PrintJob.status == "printing", 1), else_=0)), 0),
                    func.coalesce(
                        func.sum(
                            case(
                                (
                                    (PrintJob.status == "printed") & (PrintJob.created_at >= recent_cutoff),
                                    1,
                                ),
                                else_=0,
                            )
                        ),
                        0,
                    ),
                    func.coalesce(
                        func.sum(
                            case(
                                (
                                    (PrintJob.status == "failed") & (PrintJob.created_at >= recent_cutoff),
                                    1,
                                ),
                                else_=0,
                            )
                        ),
                        0,
                    ),
                    func.coalesce(
                        func.sum(
                            case(
                                (
                                    (PrintJob.status == "cancelled") & (PrintJob.created_at >= recent_cutoff),
                                    1,
                                ),
                                else_=0,
                            )
                        ),
                        0,
                    ),
                )
                .filter(PrintJob.restaurante_id == rid)
                .one()
            )
            pending_count += int(job_counts[0] or 0)
            claimed_count += int(job_counts[1] or 0)
            printing_count += int(job_counts[2] or 0)
            printed_last_60m += int(job_counts[3] or 0)
            failed_last_60m += int(job_counts[4] or 0)
            cancelled_last_60m += int(job_counts[5] or 0)

            unresolved_created = (
                db.query(PrintJob.created_at)
                .filter(
                    PrintJob.restaurante_id == rid,
                    PrintJob.status.in_(("pending", "claimed", "printing")),
                )
                .all()
            )
            for (created_raw,) in unresolved_created:
                created_utc = _as_utc(created_raw)
                if created_utc is None:
                    continue
                if created_utc < delay_cutoff:
                    delayed_unresolved_jobs += 1
                if oldest_unresolved_dt is None or created_utc < oldest_unresolved_dt:
                    oldest_unresolved_dt = created_utc

            agent_rows = (
                db.query(PrintAgentToken.last_seen_at)
                .filter(
                    PrintAgentToken.restaurante_id == rid,
                    PrintAgentToken.ativo.is_(True),
                )
                .all()
            )
            for (last_seen_raw,) in agent_rows:
                active_agents_total += 1
                last_seen_utc = _as_utc(last_seen_raw)
                if last_seen_utc is not None and last_seen_utc >= online_cutoff:
                    agents_online += 1

    agents_silent = max(0, active_agents_total - agents_online)
    oldest_age_seconds = (
        max(0, int((ref_now - oldest_unresolved_dt).total_seconds()))
        if oldest_unresolved_dt is not None
        else 0
    )

    unresolved_total = pending_count + claimed_count + printing_count
    status = "normal"
    if delayed_unresolved_jobs > 0 or failed_last_60m > 0 or (unresolved_total > 0 and agents_online == 0 and active_agents_total > 0):
        status = "degraded"

    return {
        "status": status,
        "observed_at": ref_now.isoformat(),
        "queue": {
            "pending": pending_count,
            "claimed": claimed_count,
            "printing": printing_count,
            "delayed_unresolved_jobs": delayed_unresolved_jobs,
            "oldest_unresolved_age_seconds": oldest_age_seconds,
            "printed_last_60m": printed_last_60m,
            "failed_last_60m": failed_last_60m,
            "cancelled_last_60m": cancelled_last_60m,
        },
        "agents": {
            "active_total": active_agents_total,
            "online_within_90s": agents_online,
            "silent": agents_silent,
        },
        "physical_output_verified": False,
        "physical_output_note": "Software job status and agent heartbeats do not prove physical paper output.",
        "coverage": {
            "source": "authoritative_database_readonly",
            "recent_window_minutes": PRINT_RECENT_WINDOW_MINUTES,
            "delay_threshold_seconds": PRINT_DELAY_THRESHOLD_SECONDS,
            "maintenance_writes_executed": False,
            "cache_ttl_seconds": 20,
        },
    }


def list_restaurants_operational_summary(
    db: Session,
    *,
    limit: int = 50,
    include_suspended: bool = True,
    now: datetime | None = None,
    statement_timeout_ms: int = DEFAULT_STATEMENT_TIMEOUT_MS,
) -> dict[str, Any]:
    """Lista resumo operacional dos restaurantes autorizados em READ ONLY sem expor PII."""
    bounded_limit = max(1, min(int(limit), 100))
    ref_now = _as_utc(now) or datetime.now(timezone.utc)
    recent_cutoff = _query_cutoff(db, ref_now - timedelta(minutes=PRINT_RECENT_WINDOW_MINUTES))
    online_cutoff = ref_now - timedelta(seconds=AGENT_ONLINE_THRESHOLD_SECONDS)
    restaurant_ids = _discover_restaurant_ids(db)

    items: list[dict[str, Any]] = []
    for rid in restaurant_ids[:bounded_limit]:
        with tenant_session_scope(db, rid):
            configure_readonly_tx(db, statement_timeout_ms=statement_timeout_ms)
            rest = db.query(Restaurante).filter(Restaurante.id == rid).one_or_none()
            if rest is None:
                continue
            saas_status = str(getattr(rest, "saas_status", "active") or "active")
            if not include_suspended and saas_status == "suspended":
                continue

            profile = (
                db.query(RestauranteOperationProfile)
                .filter(RestauranteOperationProfile.restaurante_id == rid)
                .one_or_none()
            )
            trial_row = (
                db.execute(
                    select(
                        restaurant_trials.c.trial_status,
                        restaurant_trials.c.trial_started_at,
                        restaurant_trials.c.trial_ends_at,
                    ).where(restaurant_trials.c.restaurante_id == rid)
                )
                .mappings()
                .first()
            )
            trial_ends_at = _as_utc(trial_row.get("trial_ends_at")) if trial_row else None

            categories_count = int(
                db.query(func.count(Categoria.id)).filter(Categoria.restaurante_id == rid).scalar() or 0
            )
            active_products_count = int(
                db.query(func.count(Produto.id))
                .filter(Produto.restaurante_id == rid, Produto.ativo.is_(True))
                .scalar()
                or 0
            )

            mp_connected = (
                db.query(RestaurantPaymentAccount.id)
                .filter(
                    RestaurantPaymentAccount.restaurante_id == rid,
                    RestaurantPaymentAccount.provider == "mercado_pago",
                    RestaurantPaymentAccount.status == "active",
                )
                .first()
                is not None
            )

            agent_rows = (
                db.query(PrintAgentToken.last_seen_at)
                .filter(
                    PrintAgentToken.restaurante_id == rid,
                    PrintAgentToken.ativo.is_(True),
                )
                .all()
            )
            agents_online = sum(
                1
                for (last_seen_raw,) in agent_rows
                if (last_seen := _as_utc(last_seen_raw)) is not None and last_seen >= online_cutoff
            )

            pending_print_jobs = int(
                db.query(func.count(PrintJob.id))
                .filter(
                    PrintJob.restaurante_id == rid,
                    PrintJob.status.in_(("pending", "claimed", "printing")),
                )
                .scalar()
                or 0
            )
            failed_print_jobs_60m = int(
                db.query(func.count(PrintJob.id))
                .filter(
                    PrintJob.restaurante_id == rid,
                    PrintJob.status == "failed",
                    PrintJob.created_at >= recent_cutoff,
                )
                .scalar()
                or 0
            )

            items.append(
                {
                    "id": str(rest.id),
                    "name": str(rest.nome or ""),
                    "slug": str(rest.slug or ""),
                    "plan": str(rest.plano or ""),
                    "saasStatus": saas_status,
                    "operationProfile": str(profile.profile_key) if profile else "generic",
                    "trialStatus": str(trial_row.get("trial_status") or "pending_setup") if trial_row else "pending_setup",
                    "trialEndsAt": trial_ends_at.isoformat() if trial_ends_at else None,
                    "categoriesCount": categories_count,
                    "activeProductsCount": active_products_count,
                    "mercadoPagoConnected": mp_connected,
                    "printAgentsActive": len(agent_rows),
                    "printAgentsOnline": agents_online,
                    "pendingPrintJobs": pending_print_jobs,
                    "failedPrintJobsLast60m": failed_print_jobs_60m,
                    "publicMenuPath": f"/c/{rest.slug}" if rest.slug else None,
                }
            )

    return {
        "observed_at": ref_now.isoformat(),
        "total": len(items),
        "restaurants": items,
        "coverage": {
            "source": "authoritative_database_readonly",
            "pii_included": False,
        },
    }


def get_restaurant_readiness_summary(
    db: Session,
    tenant_id: int,
    *,
    now: datetime | None = None,
    statement_timeout_ms: int = DEFAULT_STATEMENT_TIMEOUT_MS,
) -> dict[str, Any]:
    """Consulta prontidão operacional e diagnóstico de implantação de um tenant sem expor PII."""
    if tenant_id <= 0:
        return {
            "status": "unknown",
            "error": {"code": "VALIDATION_ERROR", "message": "tenant_id must be positive", "retryable": False},
        }
    ref_now = _as_utc(now) or datetime.now(timezone.utc)
    recent_cutoff = _query_cutoff(db, ref_now - timedelta(minutes=PRINT_RECENT_WINDOW_MINUTES))
    online_cutoff = ref_now - timedelta(seconds=AGENT_ONLINE_THRESHOLD_SECONDS)

    with tenant_session_scope(db, tenant_id):
        configure_readonly_tx(db, statement_timeout_ms=statement_timeout_ms)
        rest = db.query(Restaurante).filter(Restaurante.id == tenant_id).one_or_none()
        if rest is None:
            return {
                "exists": False,
                "tenantId": tenant_id,
                "observed_at": ref_now.isoformat(),
            }

        config = (
            db.query(ConfiguracaoRestaurante)
            .filter(ConfiguracaoRestaurante.restaurante_id == tenant_id)
            .one_or_none()
        )
        profile = (
            db.query(RestauranteOperationProfile)
            .filter(RestauranteOperationProfile.restaurante_id == tenant_id)
            .one_or_none()
        )
        trial_row = (
            db.execute(
                select(
                    restaurant_trials.c.trial_status,
                    restaurant_trials.c.trial_started_at,
                    restaurant_trials.c.trial_ends_at,
                ).where(restaurant_trials.c.restaurante_id == tenant_id)
            )
            .mappings()
            .first()
        )
        categories_count = int(
            db.query(func.count(Categoria.id)).filter(Categoria.restaurante_id == tenant_id).scalar() or 0
        )
        total_products_count = int(
            db.query(func.count(Produto.id)).filter(Produto.restaurante_id == tenant_id).scalar() or 0
        )
        active_products_count = int(
            db.query(func.count(Produto.id))
            .filter(Produto.restaurante_id == tenant_id, Produto.ativo.is_(True))
            .scalar()
            or 0
        )
        modifier_groups_count = int(
            db.query(func.count(GrupoModificador.id))
            .filter(GrupoModificador.restaurante_id == tenant_id)
            .scalar()
            or 0
        )
        meio_a_meio_groups_count = int(
            db.query(func.count(GrupoModificador.id))
            .filter(
                GrupoModificador.restaurante_id == tenant_id,
                GrupoModificador.tipo == "meio_a_meio",
            )
            .scalar()
            or 0
        )
        families_count = int(
            db.query(func.count(ProdutoFamilia.id))
            .filter(ProdutoFamilia.restaurante_id == tenant_id)
            .scalar()
            or 0
        )
        mp_connected = (
            db.query(RestaurantPaymentAccount.id)
            .filter(
                RestaurantPaymentAccount.restaurante_id == tenant_id,
                RestaurantPaymentAccount.provider == "mercado_pago",
                RestaurantPaymentAccount.status == "active",
            )
            .first()
            is not None
        )
        agent_rows = (
            db.query(PrintAgentToken.last_seen_at, PrintAgentToken.is_primary)
            .filter(
                PrintAgentToken.restaurante_id == tenant_id,
                PrintAgentToken.ativo.is_(True),
            )
            .all()
        )
        agents_online = sum(
            1
            for last_seen_raw, _ in agent_rows
            if (last_seen := _as_utc(last_seen_raw)) is not None and last_seen >= online_cutoff
        )
        pending_print_jobs = int(
            db.query(func.count(PrintJob.id))
            .filter(
                PrintJob.restaurante_id == tenant_id,
                PrintJob.status.in_(("pending", "claimed", "printing")),
            )
            .scalar()
            or 0
        )
        failed_print_jobs_60m = int(
            db.query(func.count(PrintJob.id))
            .filter(
                PrintJob.restaurante_id == tenant_id,
                PrintJob.status == "failed",
                PrintJob.created_at >= recent_cutoff,
            )
            .scalar()
            or 0
        )

        hours_configured = bool(isinstance(rest.horarios_funcionamento, list) and len(rest.horarios_funcionamento) > 0)
        order_types = explicit_order_types(config) if config is not None else []
        operations_configured = len(order_types) > 0
        profile_configured = bool(str(rest.nome or "").strip()) and bool(
            str(rest.endereco or "").strip() or rest.socials
        )
        catalog_configured = active_products_count > 0

        steps = {
            "profile": profile_configured,
            "hours": hours_configured,
            "catalog": catalog_configured,
            "operations": operations_configured,
        }
        missing_steps = [k for k, ready in steps.items() if not ready]
        trial_started_at = _as_utc(trial_row.get("trial_started_at")) if trial_row else None
        trial_ends_at = _as_utc(trial_row.get("trial_ends_at")) if trial_row else None

        return {
            "exists": True,
            "observed_at": ref_now.isoformat(),
            "tenantId": str(rest.id),
            "name": str(rest.nome or ""),
            "slug": str(rest.slug or ""),
            "plan": str(rest.plano or ""),
            "saasStatus": str(getattr(rest, "saas_status", "active") or "active"),
            "statusOverride": str(rest.status_override or "Automático"),
            "operationProfile": str(profile.profile_key) if profile else "generic",
            "trial": {
                "status": str(trial_row.get("trial_status") or "pending_setup") if trial_row else "pending_setup",
                "startedAt": trial_started_at.isoformat() if trial_started_at else None,
                "endsAt": trial_ends_at.isoformat() if trial_ends_at else None,
                "daysGranted": DEFAULT_TRIAL_DAYS,
            },
            "steps": steps,
            "missingEssentialSteps": missing_steps,
            "essentialStepsCompleted": sum(1 for v in steps.values() if v),
            "essentialStepsTotal": len(steps),
            "configurationComplete": len(missing_steps) == 0,
            "catalog": {
                "categoriesCount": categories_count,
                "productsTotal": total_products_count,
                "activeProductsCount": active_products_count,
                "modifierGroupsCount": modifier_groups_count,
                "meioAMeioGroupsCount": meio_a_meio_groups_count,
                "familiesCount": families_count,
            },
            "operations": {
                "orderTypes": order_types,
                "deliveryEnabled": bool(config.delivery_ativo) if config else True,
                "deliveryFeeMode": str(config.tipo_taxa_entrega or "fixa") if config else "fixa",
                "deliveryFixedFee": float(config.taxa_entrega_fixa or 0.0) if config else 0.0,
                "acceptedPaymentMethods": list(rest.formas_pagamento_aceitas or []),
                "mercadoPagoConnected": mp_connected,
            },
            "printing": {
                "activeAgentsTotal": len(agent_rows),
                "onlineWithin90s": agents_online,
                "hasPrimaryAgent": any(bool(is_primary) for _, is_primary in agent_rows),
                "pendingJobs": pending_print_jobs,
                "failedJobsLast60m": failed_print_jobs_60m,
            },
            "publicMenuPath": f"/c/{rest.slug}" if rest.slug else None,
            "coverage": {
                "source": "authoritative_database_readonly",
                "pii_included": False,
            },
        }


def preview_restaurant_provisioning_readonly(
    db: Session,
    *,
    structured_text: str | None = None,
    name: str | None = None,
    subdomain: str | None = None,
    plan: str = "pro",
    operation_profile: str | None = None,
    segment_preset: str | None = None,
    menu_text: str | None = None,
    statement_timeout_ms: int = DEFAULT_STATEMENT_TIMEOUT_MS,
) -> dict[str, Any]:
    """Executa dry-run seguro (somente leitura, sem PII) para pré-visualizar provisionamento."""
    configure_readonly_tx(db, statement_timeout_ms=statement_timeout_ms)
    engine_input = UniversalProvisioningInput(
        name=name or "",
        subdomain=subdomain,
        explicit_subdomain=bool(subdomain and subdomain.strip()),
        plan=plan or "pro",
        operation_profile=operation_profile,
        segment_preset=segment_preset,
        menu_text=menu_text,
        structured_text=structured_text,
    )
    preview = provision_restaurant(
        db,
        engine_input,
        origin="express_api",
        actor="mcp_preview",
        allow_id_reuse=True,
        dry_run=True,
    )
    # Remove campos potenciais de contato/PII se presentes na saída de dry-run
    return {
        "dryRun": True,
        "readyToProvision": bool(preview.get("readyToProvision")),
        "restaurant": {
            "name": preview.get("name"),
            "slug": preview.get("subdomain"),
            "slugAvailable": bool(preview.get("slugAvailable")),
            "plan": preview.get("plan"),
            "operationProfile": preview.get("operationProfile"),
            "segmentPreset": preview.get("segmentPreset"),
            "suggestedRestaurantId": preview.get("suggestedRestaurantId"),
            "idSelectionMode": preview.get("idSelectionMode"),
        },
        "operations": preview.get("operations"),
        "bootstrap": preview.get("bootstrap"),
        "missingFields": preview.get("missingFields"),
        "warnings": preview.get("warnings"),
        "coverage": {
            "source": "authoritative_database_readonly",
            "pii_included": False,
        },
    }


def verify_tenant_deprovision_readonly(
    db: Session,
    tenant_id: int,
    *,
    statement_timeout_ms: int = DEFAULT_STATEMENT_TIMEOUT_MS,
) -> dict[str, Any]:
    """Audita ausência de resíduos operacionais e política de ID em transação READ ONLY."""
    if tenant_id <= 0:
        return {
            "status": "unknown",
            "error": {"code": "VALIDATION_ERROR", "message": "tenant_id must be positive", "retryable": False},
        }
    with tenant_session_scope(db, tenant_id):
        configure_readonly_tx(db, statement_timeout_ms=statement_timeout_ms)
    return verify_tenant_deprovisioned(db, tenant_id)

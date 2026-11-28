"""Motor oficial, auditável e idempotente de desligamento e desprovisionamento de tenant."""

from __future__ import annotations

import datetime
import hashlib
import json
import os
import re
from typing import Any, Iterable, Literal
from urllib.parse import unquote

import httpx
from fastapi import HTTPException, status
from sqlalchemy import MetaData, Table, and_, delete, exists, func, or_, select, text, update
from sqlalchemy.exc import NoReferencedTableError
from sqlalchemy.orm import Session

from ..config import settings
from ..database import tenant_session_scope
from ..models import Restaurante, SuperAdminAuditLog, Usuario
from ..security import revoke_user_sessions
from .storage_paths import extract_bucket_object_path
from .tenant_id_reuse import inspect_tenant_id_eligibility

CARDAPIO_STORAGE_BUCKET = "cardapio-assets"
_SAFE_OBJECT_FILENAME_RE = r"[A-Za-z0-9][A-Za-z0-9_.-]*"

DeprovisionMode = Literal["qa_purge", "client_offboarding"]

# Tenants reais/base protegidos contra exclusão integral via ferramenta de desprovisionamento.
PROTECTED_TENANT_IDS = frozenset({1, 6})

PRESERVED_AUDIT_TABLES = frozenset({"super_admin_audit_logs"})

GLOBAL_SHARED_TABLES = frozenset(
    {
        "alembic_version",
        "contract_acceptances",
        "email_delivery_receipts",
        "fiscal_official_reference_snapshots",
        "fiscal_official_reference_states",
        "koma_event_attributions",
        "koma_event_lead_history",
        "koma_event_leads",
        "koma_event_visits",
        "restaurant_signups",
        "signup_notifications",
        "super_admin_company_receipts",
        "super_admin_finance_audit",
        "super_admin_finance_months",
    }
)


def _utc_now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _confirmation_phrase(tenant_id: int, mode: DeprovisionMode) -> str:
    prefix = "DEPROVISION_TENANT" if mode == "qa_purge" else "OFFBOARD_TENANT"
    return f"{prefix}_{tenant_id}"


def _database_name(db: Session) -> str:
    bind = db.get_bind()
    if bind is None:
        return ":unknown:"
    if bind.dialect.name == "postgresql":
        return str(db.execute(text("SELECT current_database()")).scalar_one()).strip()
    return str(bind.url.database or ":memory:")


def _reflect_metadata(db: Session) -> MetaData:
    metadata = MetaData()
    metadata.reflect(bind=db.get_bind())
    return metadata


def _single_tenant_predicate(
    table: Table,
    tenant_id: int,
    *,
    trail: frozenset[str] = frozenset(),
):
    """Deriva predicado SQL estritamente escopado ao tenant_id por coluna direta ou FK."""
    if table.name in trail:
        return None
    next_trail = trail | {table.name}

    if table.name == "restaurantes":
        return table.c.id == tenant_id

    direct_columns = [
        table.c[col_name]
        for col_name in ("restaurante_id", "destino_restaurante_id")
        if col_name in table.c
    ]
    if direct_columns:
        if len(direct_columns) == 1:
            return direct_columns[0] == tenant_id
        return or_(*(col == tenant_id for col in direct_columns))

    alternatives = []
    try:
        constraints = tuple(table.foreign_key_constraints)
    except NoReferencedTableError:
        constraints = ()
    for constraint in constraints:
        try:
            parent = constraint.referred_table
        except NoReferencedTableError:
            continue
        parent_scope = _single_tenant_predicate(parent, tenant_id, trail=next_trail)
        if parent_scope is None:
            continue
        pairs = [element.parent == element.column for element in constraint.elements]
        if pairs:
            alternatives.append(
                exists(select(1).select_from(parent).where(and_(*pairs, parent_scope)))
            )
    return or_(*alternatives) if alternatives else None


def _count_rows(db: Session, table: Table, predicate) -> int:
    stmt = select(func.count()).select_from(table)
    if predicate is not None:
        stmt = stmt.where(predicate)
    return int(db.execute(stmt).scalar_one() or 0)


def _extract_gallery_values(raw_gallery: Any) -> list[str]:
    if not raw_gallery:
        return []
    parsed = raw_gallery
    if isinstance(raw_gallery, str):
        try:
            parsed = json.loads(raw_gallery)
        except (TypeError, ValueError):
            parsed = [raw_gallery]
    if not isinstance(parsed, list):
        return []
    values: list[str] = []
    for entry in parsed:
        if isinstance(entry, str) and entry.strip():
            values.append(entry.strip())
        elif isinstance(entry, dict):
            for key in ("url", "path", "object_path"):
                val = entry.get(key)
                if isinstance(val, str) and val.strip():
                    values.append(val.strip())
    return values


def _collect_storage_assets(db: Session, metadata: MetaData, tenant_id: int) -> list[str]:
    assets: set[str] = set()
    rest_table = metadata.tables.get("restaurantes")
    if rest_table is not None:
        cols = [
            rest_table.c[c]
            for c in ("logo_url", "banner_url", "cardapio_logo_path", "cardapio_banner_path")
            if c in rest_table.c
        ]
        if cols:
            row = db.execute(select(*cols).where(rest_table.c.id == tenant_id)).first()
            if row is not None:
                for val in row:
                    if isinstance(val, str) and val.strip():
                        assets.add(val.strip())

    prod_table = metadata.tables.get("produtos")
    if prod_table is not None and "restaurante_id" in prod_table.c:
        prod_cols = [
            prod_table.c[c]
            for c in ("imagem", "imagem_url", "imagens_galeria")
            if c in prod_table.c
        ]
        if prod_cols:
            rows = db.execute(
                select(*prod_cols).where(prod_table.c.restaurante_id == tenant_id)
            ).fetchall()
            for row in rows:
                for idx, col in enumerate(prod_cols):
                    val = row[idx]
                    if col.name == "imagens_galeria":
                        assets.update(_extract_gallery_values(val))
                    elif isinstance(val, str) and val.strip():
                        assets.add(val.strip())

    ret_table = metadata.tables.get("product_image_retirements")
    if ret_table is not None and {"restaurante_id", "object_path"}.issubset(ret_table.c.keys()):
        ret_rows = db.execute(
            select(ret_table.c.object_path).where(ret_table.c.restaurante_id == tenant_id)
        ).fetchall()
        for (val,) in ret_rows:
            if isinstance(val, str) and val.strip():
                assets.add(val.strip())

    return sorted(assets)


def _is_tenant_owned_object_path(object_path: str | None, tenant_id: int) -> bool:
    if not object_path or not isinstance(object_path, str):
        return False
    pattern = rf"^{int(tenant_id)}/(products|logo|banner)/{_SAFE_OBJECT_FILENAME_RE}$"
    if not re.fullmatch(pattern, object_path):
        return False
    parts = object_path.split("/")
    return len(parts) == 3 and parts[-1] not in {".", ".."} and "\\" not in object_path


def _discover_other_tenant_ids(db: Session, tenant_id: int) -> list[int]:
    bind = db.get_bind()
    if bind is not None and bind.dialect.name == "postgresql":
        rows = db.execute(
            text("SELECT id FROM koma_internal.list_public_restaurants() ORDER BY id")
        ).scalars().all()
    else:
        rows = db.execute(text("SELECT id FROM restaurantes ORDER BY id")).scalars().all()
    return [int(rid) for rid in rows if rid is not None and int(rid) != int(tenant_id)]


def _is_referenced_by_other_tenant(
    db: Session,
    metadata: MetaData,
    *,
    tenant_id: int,
    object_path: str,
    other_tenant_ids: list[int],
) -> bool:
    filename = object_path.rsplit("/", 1)[-1]
    bind = db.get_bind()
    if bind is not None and bind.dialect.name == "postgresql" and "/products/" in object_path:
        try:
            if bool(
                db.execute(
                    text("SELECT koma_internal.product_image_referenced(:tenant, :path)"),
                    {"tenant": tenant_id, "path": object_path},
                ).scalar_one()
            ):
                # Re-check below in case only the target tenant references it before deletion;
                # product_image_referenced checks other rows, so inspect per-other-tenant to be exact.
                pass
        except Exception:
            pass

    rest_table = metadata.tables.get("restaurantes")
    prod_table = metadata.tables.get("produtos")
    for other_id in other_tenant_ids:
        with tenant_session_scope(db, other_id):
            if rest_table is not None:
                cols = [
                    rest_table.c[c]
                    for c in ("logo_url", "banner_url", "cardapio_logo_path", "cardapio_banner_path")
                    if c in rest_table.c
                ]
                if cols:
                    row = db.execute(select(*cols).where(rest_table.c.id == other_id)).first()
                    if row is not None and any(
                        object_path in unquote(str(val)) or filename == unquote(str(val)).rsplit("/", 1)[-1]
                        for val in row
                        if val
                    ):
                        return True
            if prod_table is not None and "restaurante_id" in prod_table.c:
                p_cols = [
                    prod_table.c[c]
                    for c in ("imagem", "imagem_url", "imagens_galeria")
                    if c in prod_table.c
                ]
                if p_cols:
                    for p_row in db.execute(select(*p_cols).where(prod_table.c.restaurante_id == other_id)).fetchall():
                        vals: list[str] = []
                        for idx, col in enumerate(p_cols):
                            if col.name == "imagens_galeria":
                                vals.extend(_extract_gallery_values(p_row[idx]))
                            elif p_row[idx]:
                                vals.append(str(p_row[idx]))
                        if any(object_path in unquote(v) or filename in unquote(v) for v in vals):
                            return True
    return False


def _build_storage_cleanup_plan(
    db: Session,
    metadata: MetaData,
    tenant_id: int,
    mode: DeprovisionMode,
    raw_assets: list[str],
    *,
    other_tenant_ids: list[int] | None = None,
) -> dict[str, Any]:
    """Classifica cada asset por propriedade inequívoca e proteção cross-tenant."""
    if other_tenant_ids is None:
        other_tenant_ids = _discover_other_tenant_ids(db, tenant_id)

    owned_paths: set[str] = set()
    cross_tenant_or_unowned: list[str] = []
    preserved_shared_paths: list[str] = []
    eligible_delete_paths: list[str] = []
    retained_for_offboarding: list[str] = []

    for raw in raw_assets:
        obj_path = extract_bucket_object_path(raw)
        if obj_path is None or not _is_tenant_owned_object_path(obj_path, tenant_id):
            cross_tenant_or_unowned.append(raw)
            continue
        owned_paths.add(obj_path)

    for obj_path in sorted(owned_paths):
        if _is_referenced_by_other_tenant(
            db,
            metadata,
            tenant_id=tenant_id,
            object_path=obj_path,
            other_tenant_ids=other_tenant_ids,
        ):
            preserved_shared_paths.append(obj_path)
        elif mode == "client_offboarding":
            retained_for_offboarding.append(obj_path)
        else:
            eligible_delete_paths.append(obj_path)

    supabase_configured = bool(
        (settings.SUPABASE_URL or os.getenv("SUPABASE_URL", "")).strip()
        and (settings.SUPABASE_SERVICE_ROLE_KEY or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")).strip()
    )

    return {
        "bucket": CARDAPIO_STORAGE_BUCKET,
        "supabaseConfigured": supabase_configured,
        "eligibleDeletePaths": eligible_delete_paths,
        "retainedForOffboarding": retained_for_offboarding,
        "preservedSharedPaths": preserved_shared_paths,
        "ignoredExternalOrUnowned": sorted(set(cross_tenant_or_unowned)),
    }


def cleanup_verified_storage_objects(
    tenant_id: int,
    object_paths: Iterable[str],
    *,
    dry_run: bool = False,
    http_client: httpx.Client | None = None,
) -> dict[str, Any]:
    """Remove objetos individualmente no Supabase Storage somente após validação estrita de posse.

    Nunca executa remoção genérica de diretório/prefixo curinga nem expõe credenciais.
    """
    validated_paths: list[str] = []
    rejected_paths: list[str] = []
    seen: set[str] = set()
    for raw_path in object_paths:
        candidate = extract_bucket_object_path(raw_path) or str(raw_path or "").strip()
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        if _is_tenant_owned_object_path(candidate, tenant_id):
            validated_paths.append(candidate)
        else:
            rejected_paths.append(candidate)

    result: dict[str, Any] = {
        "bucket": CARDAPIO_STORAGE_BUCKET,
        "dryRun": bool(dry_run),
        "attempted": list(validated_paths),
        "deleted": [],
        "alreadyMissing": [],
        "failed": [],
        "retryablePaths": [],
        "rejectedUnowned": rejected_paths,
        "skippedUnconfigured": False,
    }
    if not validated_paths or dry_run:
        return result

    supabase_url = (settings.SUPABASE_URL or os.getenv("SUPABASE_URL", "")).strip().rstrip("/")
    service_key = (
        settings.SUPABASE_SERVICE_ROLE_KEY or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    ).strip()
    if http_client is None and (not supabase_url or not service_key):
        result["skippedUnconfigured"] = True
        result["retryablePaths"] = list(validated_paths)
        return result

    delete_url = (
        f"{supabase_url}/storage/v1/object/{CARDAPIO_STORAGE_BUCKET}"
        if supabase_url
        else f"/storage/v1/object/{CARDAPIO_STORAGE_BUCKET}"
    )
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }

    owned_client = http_client is None
    client = http_client or httpx.Client(timeout=20.0, trust_env=False)
    try:
        for obj_path in validated_paths:
            try:
                resp = client.request(
                    "DELETE",
                    delete_url,
                    headers=headers,
                    json={"prefixes": [obj_path]},
                )
                if resp.status_code in {200, 204}:
                    result["deleted"].append(obj_path)
                elif resp.status_code == 404:
                    result["alreadyMissing"].append(obj_path)
                else:
                    result["failed"].append(
                        {"path": obj_path, "status": int(resp.status_code)}
                    )
                    result["retryablePaths"].append(obj_path)
            except httpx.HTTPError as exc:
                result["failed"].append(
                    {"path": obj_path, "error": type(exc).__name__}
                )
                result["retryablePaths"].append(obj_path)
    finally:
        if owned_client:
            client.close()

    return result


def _collect_external_integrations(db: Session, metadata: MetaData, tenant_id: int) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "paymentAccounts": 0,
        "whatsappMessages": 0,
        "printAgents": 0,
        "pushSubscriptions": 0,
    }
    mapping = (
        ("restaurant_payment_accounts", "paymentAccounts"),
        ("mensagens_whatsapp", "whatsappMessages"),
        ("print_agent_tokens", "printAgents"),
    )
    for table_name, key in mapping:
        table = metadata.tables.get(table_name)
        if table is not None and "restaurante_id" in table.c:
            summary[key] = _count_rows(db, table, table.c.restaurante_id == tenant_id)
    push_count = 0
    for table_name in ("order_push_subscriptions", "staff_push_subscriptions"):
        table = metadata.tables.get(table_name)
        if table is not None and "restaurante_id" in table.c:
            push_count += _count_rows(db, table, table.c.restaurante_id == tenant_id)
    summary["pushSubscriptions"] = push_count
    return summary


def _inspect_safety_blockers(
    db: Session,
    metadata: MetaData,
    tenant_id: int,
    mode: DeprovisionMode,
) -> list[dict[str, Any]]:
    blockers: list[dict[str, Any]] = []
    if tenant_id in PROTECTED_TENANT_IDS:
        blockers.append(
            {
                "code": "protected_tenant",
                "detail": f"Tenant #{tenant_id} faz parte dos estabelecimentos protegidos contra desligamento/exclusão.",
            }
        )
        return blockers

    if mode != "qa_purge":
        return blockers

    grants = metadata.tables.get("saas_commercial_grants")
    if grants is not None and {"restaurante_id", "active"}.issubset(grants.c.keys()):
        active_grants = _count_rows(
            db,
            grants,
            and_(grants.c.restaurante_id == tenant_id, grants.c.active.is_(True)),
        )
        if active_grants > 0:
            blockers.append(
                {
                    "code": "active_founders_or_commercial_grant",
                    "count": active_grants,
                    "detail": "Tenant possui concessão comercial especial ativa (Founders/Grant) e não pode sofrer qa_purge.",
                }
            )

    subs = metadata.tables.get("saas_subscriptions")
    if subs is not None and {"restaurante_id", "status"}.issubset(subs.c.keys()):
        active_subs = _count_rows(
            db,
            subs,
            and_(subs.c.restaurante_id == tenant_id, subs.c.status == "active"),
        )
        if active_subs > 0:
            blockers.append(
                {
                    "code": "active_paid_subscription",
                    "count": active_subs,
                    "detail": "Tenant possui assinatura SaaS paga ativa; utilize mode='client_offboarding'.",
                }
            )

    fiscal_docs = metadata.tables.get("fiscal_documents")
    if fiscal_docs is not None and "restaurante_id" in fiscal_docs.c:
        fiscal_count = _count_rows(db, fiscal_docs, fiscal_docs.c.restaurante_id == tenant_id)
        if fiscal_count > 0:
            blockers.append(
                {
                    "code": "fiscal_retention_required",
                    "count": fiscal_count,
                    "detail": "Tenant possui documentos fiscais sujeitos à retenção legal obrigatória.",
                }
            )

    online_intents = metadata.tables.get("online_payment_intents")
    if online_intents is not None and {"restaurante_id", "status"}.issubset(online_intents.c.keys()):
        settled_intents = _count_rows(
            db,
            online_intents,
            and_(
                online_intents.c.restaurante_id == tenant_id,
                online_intents.c.status.in_(("approved", "paid", "succeeded")),
            ),
        )
        if settled_intents > 0:
            blockers.append(
                {
                    "code": "settled_online_payments",
                    "count": settled_intents,
                    "detail": "Tenant possui pagamentos online liquidados; utilize mode='client_offboarding'.",
                }
            )

    return blockers


def _compute_fingerprint(
    *,
    database: str,
    tenant_id: int,
    mode: DeprovisionMode,
    target_counts: dict[str, int],
    preserved_counts: dict[str, int],
) -> str:
    payload = json.dumps(
        {
            "database": database,
            "tenant_id": tenant_id,
            "mode": mode,
            "targets": target_counts,
            "preserved": preserved_counts,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def build_deprovision_plan(
    db: Session,
    tenant_id: int,
    *,
    mode: DeprovisionMode = "qa_purge",
) -> dict[str, Any]:
    """Calcula plano determinístico (dry-run) de desprovisionamento sem alterar dados."""
    if tenant_id <= 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="tenant_id deve ser um inteiro positivo.",
        )

    other_tenant_ids = _discover_other_tenant_ids(db, tenant_id)
    with tenant_session_scope(db, tenant_id):
        metadata = _reflect_metadata(db)
        database = _database_name(db)
        restaurante = (
            db.query(Restaurante).filter(Restaurante.id == tenant_id).one_or_none()
        )
        blockers = _inspect_safety_blockers(db, metadata, tenant_id, mode)

        target_counts: dict[str, int] = {}
        preserved_counts: dict[str, int] = {}

        for table in metadata.sorted_tables:
            if table.name in GLOBAL_SHARED_TABLES:
                continue
            predicate = _single_tenant_predicate(table, tenant_id)
            if predicate is None:
                continue
            row_count = _count_rows(db, table, predicate)
            if row_count <= 0:
                continue
            if table.name in PRESERVED_AUDIT_TABLES:
                preserved_counts[table.name] = row_count
                continue
            if mode == "qa_purge":
                target_counts[table.name] = row_count
            elif table.name in {
                "order_push_subscriptions",
                "staff_push_subscriptions",
                "motoboy_tokens_ativos",
            }:
                target_counts[table.name] = row_count
            else:
                preserved_counts[table.name] = row_count

        if mode == "client_offboarding":
            for pending_table, status_col, pending_vals in (
                ("print_jobs", "status", ("pending", "claimed", "printing")),
                ("integration_outbox", "status", ("pending", "processing")),
            ):
                table = metadata.tables.get(pending_table)
                if table is not None and {"restaurante_id", status_col}.issubset(table.c.keys()):
                    cnt = _count_rows(
                        db,
                        table,
                        and_(
                            table.c.restaurante_id == tenant_id,
                            table.c[status_col].in_(pending_vals),
                        ),
                    )
                    if cnt > 0:
                        target_counts[f"{pending_table}(pending)"] = cnt

        fingerprint = _compute_fingerprint(
            database=database,
            tenant_id=tenant_id,
            mode=mode,
            target_counts=target_counts,
            preserved_counts=preserved_counts,
        )

        restaurant_meta = (
            {
                "id": str(restaurante.id),
                "name": str(restaurante.nome or ""),
                "slug": str(restaurante.slug or ""),
                "plan": str(restaurante.plano or ""),
                "saasStatus": str(getattr(restaurante, "saas_status", "active") or "active"),
            }
            if restaurante is not None
            else None
        )

        storage_assets = _collect_storage_assets(db, metadata, tenant_id)
        external_integrations = _collect_external_integrations(db, metadata, tenant_id)

    storage_plan = _build_storage_cleanup_plan(
        db,
        metadata,
        tenant_id,
        mode,
        storage_assets,
        other_tenant_ids=other_tenant_ids,
    )

    return {
        "ok": True,
        "mode": mode,
        "dryRun": True,
        "tenantId": tenant_id,
        "database": database,
        "exists": restaurante is not None,
        "restaurant": restaurant_meta,
        "eligible": len(blockers) == 0,
        "blockers": blockers,
        "deleteCounts": target_counts,
        "deleteTotal": sum(target_counts.values()),
        "preservedCounts": preserved_counts,
        "storageAssets": storage_assets,
        "storagePlan": storage_plan,
        "externalIntegrations": external_integrations,
        "expectedConfirmation": _confirmation_phrase(tenant_id, mode),
        "fingerprint": fingerprint,
    }


def verify_tenant_deprovisioned(db: Session, tenant_id: int) -> dict[str, Any]:
    """Audita ausência de resíduos operacionais e registra a política de não-reutilização de ID."""
    with tenant_session_scope(db, tenant_id):
        metadata = _reflect_metadata(db)

        def _table_count(name: str) -> int:
            table = metadata.tables.get(name)
            if table is None:
                return 0
            pred = _single_tenant_predicate(table, tenant_id)
            return _count_rows(db, table, pred) if pred is not None else 0

        categories = {
            "restaurantes": _table_count("restaurantes"),
            "usuarios": _table_count("usuarios"),
            "produtos": _table_count("produtos"),
            "comandas": _table_count("comandas"),
            "print_agent_tokens": _table_count("print_agent_tokens"),
            "print_jobs": _table_count("print_jobs"),
            "push_subscriptions": _table_count("order_push_subscriptions") + _table_count("staff_push_subscriptions"),
            "integration_outbox": _table_count("integration_outbox"),
        }

        residual_tables: dict[str, int] = {}
        for table in metadata.sorted_tables:
            if table.name in GLOBAL_SHARED_TABLES or table.name in PRESERVED_AUDIT_TABLES:
                continue
            pred = _single_tenant_predicate(table, tenant_id)
            if pred is None:
                continue
            cnt = _count_rows(db, table, pred)
            if cnt > 0:
                residual_tables[table.name] = cnt

        audit_logs_preserved = _table_count("super_admin_audit_logs")
        storage_residual_assets = _collect_storage_assets(db, metadata, tenant_id)
        last_storage_audit = (
            db.query(SuperAdminAuditLog)
            .filter(
                SuperAdminAuditLog.restaurante_id == tenant_id,
                SuperAdminAuditLog.action == "TENANT_STORAGE_CLEANUP",
            )
            .order_by(SuperAdminAuditLog.id.desc())
            .first()
        )
        last_storage_summary = (
            dict(last_storage_audit.after_data)
            if last_storage_audit is not None and isinstance(last_storage_audit.after_data, dict)
            else None
        )
        eligibility = inspect_tenant_id_eligibility(db, tenant_id, preserve_transaction=False)

        return {
            "tenantId": tenant_id,
            "clean": len(residual_tables) == 0,
            "categories": categories,
            "residualOperationalTables": residual_tables,
            "residualOperationalTotal": sum(residual_tables.values()),
            "storageResidualAssets": storage_residual_assets,
            "lastStorageCleanupAudit": last_storage_summary,
            "auditLogsPreserved": audit_logs_preserved,
            "idReusePolicy": {
                "reusable": bool(eligibility.get("eligible")),
                "status": str(eligibility.get("status") or "blocked"),
                "policy": "no_reuse_when_historical_audit_present",
                "reason": (
                    "ID preservado com histórico imutável em super_admin_audit_logs para impedir "
                    "colisão com JWTs, caches, webhooks ou vínculos externos antigos."
                ),
            },
        }


def execute_deprovision(
    db: Session,
    tenant_id: int,
    *,
    mode: DeprovisionMode = "qa_purge",
    actor: str,
    reason: str,
    expected_fingerprint: str | None = None,
    confirmation: str | None = None,
    cleanup_storage: bool = True,
    retry_storage_paths: Iterable[str] | None = None,
    storage_http_client: httpx.Client | None = None,
) -> dict[str, Any]:
    """Executa desprovisionamento isolado, idempotente e auditável de um único tenant."""
    clean_reason = (reason or "").strip()
    if len(clean_reason) < 8:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Informe um motivo de auditoria com pelo menos 8 caracteres.",
        )

    plan = build_deprovision_plan(db, tenant_id, mode=mode)
    if not plan["eligible"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "Tenant bloqueado para a operação solicitada.",
                "blockers": plan["blockers"],
            },
        )

    if confirmation != plan["expectedConfirmation"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Confirmação inválida. Informe exatamente '{plan['expectedConfirmation']}'.",
        )

    if expected_fingerprint and expected_fingerprint != plan["fingerprint"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="O estado do tenant mudou após o dry-run; gere um novo plano antes de executar.",
        )

    if mode == "qa_purge" and not plan["exists"] and plan["deleteTotal"] == 0:
        retry_candidates = list(retry_storage_paths or [])
        storage_cleanup = None
        if cleanup_storage and retry_candidates:
            storage_cleanup = cleanup_verified_storage_objects(
                tenant_id,
                retry_candidates,
                dry_run=False,
                http_client=storage_http_client,
            )
            with tenant_session_scope(db, tenant_id):
                db.add(
                    SuperAdminAuditLog(
                        restaurante_id=tenant_id,
                        actor=actor,
                        action="TENANT_STORAGE_CLEANUP",
                        reason=clean_reason,
                        before_data={"requestedPaths": retry_candidates},
                        after_data=storage_cleanup,
                    )
                )
                db.commit()
        verification = verify_tenant_deprovisioned(db, tenant_id)
        return {
            "ok": True,
            "mode": mode,
            "dryRun": False,
            "tenantId": tenant_id,
            "alreadyDeprovisioned": True,
            "deletedCounts": {},
            "deletedTotal": 0,
            "fingerprint": plan["fingerprint"],
            "storageAssets": plan["storageAssets"],
            "storagePlan": plan["storagePlan"],
            "storageCleanup": storage_cleanup,
            "verification": verification,
        }

    if mode == "client_offboarding" and not plan["exists"]:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Restaurante não encontrado para offboarding.",
        )

    now = _utc_now()
    deleted_counts: dict[str, int] = {}

    with tenant_session_scope(db, tenant_id):
        bind = db.get_bind()
        if bind is not None and bind.dialect.name == "postgresql":
            db.execute(
                text("SELECT pg_advisory_xact_lock(hashtext(:lock_key))"),
                {"lock_key": f"koma-deprovision-{tenant_id}"},
            )

        metadata = _reflect_metadata(db)

        # 1. Suspensão imediata e revogação de sessões antes de limpar/desativar recursos
        rest = db.query(Restaurante).filter(Restaurante.id == tenant_id).one_or_none()
        if rest is not None:
            rest.saas_status = "suspended"

        tenant_users = (
            db.query(Usuario)
            .filter(Usuario.restaurante_id == tenant_id)
            .all()
        )
        for user in tenant_users:
            revoke_user_sessions(db, user_id=str(user.id), restaurante_id=tenant_id)
        db.flush()
        db.info.setdefault("revoked_websocket_sessions", set()).add((tenant_id, None))

        if mode == "client_offboarding":
            print_agents_table = metadata.tables.get("print_agent_tokens")
            if print_agents_table is not None and "restaurante_id" in print_agents_table.c:
                agent_values: dict[str, Any] = {}
                if "ativo" in print_agents_table.c:
                    agent_values["ativo"] = False
                if "is_primary" in print_agents_table.c:
                    agent_values["is_primary"] = False
                if agent_values:
                    db.execute(
                        update(print_agents_table)
                        .where(print_agents_table.c.restaurante_id == tenant_id)
                        .values(**agent_values)
                    )

            print_jobs_table = metadata.tables.get("print_jobs")
            if print_jobs_table is not None and {"restaurante_id", "status"}.issubset(print_jobs_table.c.keys()):
                res = db.execute(
                    delete(print_jobs_table).where(
                        and_(
                            print_jobs_table.c.restaurante_id == tenant_id,
                            print_jobs_table.c.status.in_(("pending", "claimed", "printing")),
                        )
                    )
                )
                deleted_counts["print_jobs(pending)"] = int(res.rowcount or 0)

            outbox_table = metadata.tables.get("integration_outbox")
            if outbox_table is not None and {"restaurante_id", "status"}.issubset(outbox_table.c.keys()):
                outbox_values: dict[str, Any] = {"status": "dead_letter"}
                if "last_error" in outbox_table.c:
                    outbox_values["last_error"] = "tenant_offboarded"
                db.execute(
                    update(outbox_table)
                    .where(
                        and_(
                            outbox_table.c.restaurante_id == tenant_id,
                            outbox_table.c.status.in_(("pending", "processing")),
                        )
                    )
                    .values(**outbox_values)
                )

            subs_table = metadata.tables.get("saas_subscriptions")
            if subs_table is not None and {"restaurante_id", "status"}.issubset(subs_table.c.keys()):
                db.execute(
                    update(subs_table)
                    .where(
                        and_(
                            subs_table.c.restaurante_id == tenant_id,
                            subs_table.c.status != "canceled",
                        )
                    )
                    .values(status="canceled")
                )

            for table_name in (
                "order_push_subscriptions",
                "staff_push_subscriptions",
                "motoboy_tokens_ativos",
            ):
                table = metadata.tables.get(table_name)
                if table is not None and "restaurante_id" in table.c:
                    res = db.execute(
                        delete(table).where(table.c.restaurante_id == tenant_id)
                    )
                    if res.rowcount:
                        deleted_counts[table_name] = int(res.rowcount)
        else:
            # qa_purge: remove todas as dependências em ordem topológica reversa, preservando auditoria
            for table in reversed(metadata.sorted_tables):
                if (
                    table.name in GLOBAL_SHARED_TABLES
                    or table.name in PRESERVED_AUDIT_TABLES
                    or table.name == "restaurantes"
                ):
                    continue
                pred = _single_tenant_predicate(table, tenant_id)
                if pred is None:
                    continue
                res = db.execute(delete(table).where(pred))
                if res.rowcount:
                    deleted_counts[table.name] = int(res.rowcount)

            rest_table = metadata.tables.get("restaurantes")
            if rest_table is not None:
                res = db.execute(delete(rest_table).where(rest_table.c.id == tenant_id))
                if res.rowcount:
                    deleted_counts["restaurantes"] = int(res.rowcount)

        db.add(
            SuperAdminAuditLog(
                restaurante_id=tenant_id,
                actor=actor,
                action="TENANT_DEPROVISIONED" if mode == "qa_purge" else "TENANT_OFFBOARDED",
                reason=clean_reason,
                before_data=plan["restaurant"] or {"id": str(tenant_id)},
                after_data={
                    "mode": mode,
                    "fingerprint": plan["fingerprint"],
                    "deletedCounts": deleted_counts,
                    "storageAssets": plan["storageAssets"],
                    "storagePlan": plan["storagePlan"],
                    "executedAt": now.isoformat(),
                },
            )
        )
        db.commit()

    storage_cleanup: dict[str, Any] | None = None
    storage_targets = list(
        dict.fromkeys(
            [
                *(plan["storagePlan"].get("eligibleDeletePaths") or []),
                *(retry_storage_paths or []),
            ]
        )
    )
    if mode == "qa_purge" and cleanup_storage and storage_targets:
        storage_cleanup = cleanup_verified_storage_objects(
            tenant_id,
            storage_targets,
            dry_run=False,
            http_client=storage_http_client,
        )
        with tenant_session_scope(db, tenant_id):
            db.add(
                SuperAdminAuditLog(
                    restaurante_id=tenant_id,
                    actor=actor,
                    action="TENANT_STORAGE_CLEANUP",
                    reason=clean_reason,
                    before_data={"eligiblePaths": storage_targets},
                    after_data=storage_cleanup,
                )
            )
            db.commit()

    verification = verify_tenant_deprovisioned(db, tenant_id)
    return {
        "ok": True,
        "mode": mode,
        "dryRun": False,
        "tenantId": tenant_id,
        "alreadyDeprovisioned": False,
        "deletedCounts": deleted_counts,
        "deletedTotal": sum(deleted_counts.values()),
        "fingerprint": plan["fingerprint"],
        "storageAssets": plan["storageAssets"],
        "storagePlan": plan["storagePlan"],
        "storageCleanup": storage_cleanup,
        "verification": verification,
    }

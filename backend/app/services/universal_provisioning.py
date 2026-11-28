"""Motor central e unificado de provisionamento de restaurantes (KÔMA)."""

from __future__ import annotations

import datetime
import logging
import math
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Literal

from fastapi import HTTPException, status
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

from ..database import Base, tenant_session_scope
from ..models import (
    Categoria,
    ConfiguracaoRestaurante,
    Produto,
    Restaurante,
    SuperAdminAuditLog,
    Usuario,
)
from ..restaurant_profile_models import RestauranteOperationProfile
from ..security import get_password_hash
from ..subscription import VALID_SUBSCRIPTION_PLANS
from .express_provisioning_parser import parse_express_provisioning_input
from .tenant_id_reuse import (
    assert_tenant_id_eligible_in_locked_tx,
    provisioning_concurrency_guard,
    reserve_sequential_tenant_id,
    reserve_superadmin_tenant_id,
)
from .universal_presets import (
    DEFAULT_TRIAL_DAYS,
    EMAIL_RE,
    INVITATION_TTL_HOURS,
    RESERVED_SLUGS,
    SLUG_RE,
    SUPPORTED_OPERATION_PROFILES,
    build_deterministic_import_product_id,
    format_socials_with_phone,
    infer_category_print_destination,
    segment_categories_for,
    slugify_category_id,
    slugify_restaurant_name,
)

logger = logging.getLogger("koma.universal_provisioning")

ProvisioningOrigin = Literal["public_self_service", "express_api", "super_admin"]

restaurant_trials = Table(
    "restaurant_trials",
    Base.metadata,
    Column(
        "restaurante_id",
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column("trial_started_at", DateTime(timezone=True), nullable=False),
    Column("trial_ends_at", DateTime(timezone=True), nullable=False),
    Column("trial_status", String(20), nullable=False),
    Column(
        "created_at",
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    ),
    Column(
        "updated_at",
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    ),
    CheckConstraint(
        "trial_status IN ('active', 'ended', 'converted')",
        name="ck_restaurant_trials_status",
    ),
    extend_existing=True,
)


def utc_now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def lock_onboarding_transaction(db: Session) -> None:
    """Serializa provisionamentos para tornar duplo clique e concorrência seguros."""
    if db.get_bind().dialect.name == "postgresql":
        db.execute(
            text(
                "SELECT pg_advisory_xact_lock(hashtext('koma-superadmin-onboarding'))"
            )
        )


def slug_owner_id(db: Session, slug: str) -> int | None:
    if db.get_bind().dialect.name == "postgresql":
        value = db.execute(
            text("SELECT id FROM koma_internal.resolve_public_restaurant(:identifier)"),
            {"identifier": slug},
        ).scalar_one_or_none()
        return int(value) if value is not None else None

    value = db.execute(
        text(
            "SELECT id FROM restaurantes "
            "WHERE lower(COALESCE(slug, '')) = lower(:slug) LIMIT 1"
        ),
        {"slug": slug},
    ).scalar_one_or_none()
    return int(value) if value is not None else None


def reserve_restaurant_id(
    db: Session,
    *,
    requested_id: int | None = None,
    allow_id_reuse: bool = False,
    excluded_ids: set[int] | None = None,
) -> int:
    if allow_id_reuse:
        tenant_id, _ = reserve_superadmin_tenant_id(
            db,
            requested_id=requested_id,
            excluded_ids=excluded_ids,
        )
        return tenant_id
    return reserve_sequential_tenant_id(db, excluded_ids=excluded_ids)


def create_default_trial(db: Session, tenant_id: int) -> dict[str, Any]:
    started_at = utc_now()
    ends_at = started_at + datetime.timedelta(days=DEFAULT_TRIAL_DAYS)
    db.execute(
        restaurant_trials.insert().values(
            restaurante_id=tenant_id,
            trial_started_at=started_at,
            trial_ends_at=ends_at,
            trial_status="active",
            created_at=started_at,
            updated_at=started_at,
        )
    )
    return {
        "started_at": started_at,
        "ends_at": ends_at,
        "status": "active",
        "days": DEFAULT_TRIAL_DAYS,
    }


def _discover_candidate_restaurant_ids(db: Session, *, limit: int = 25) -> list[int]:
    bind = db.get_bind()
    if bind is not None and bind.dialect.name == "postgresql":
        rows = db.execute(
            text("SELECT id FROM koma_internal.list_public_restaurants() ORDER BY id DESC")
        ).scalars().all()
    else:
        rows = db.execute(text("SELECT id FROM restaurantes ORDER BY id DESC")).scalars().all()
    ids = [int(row) for row in rows if row is not None]
    return ids[:limit] if limit > 0 else ids


def _admin_email_exists_anywhere(db: Session, email: str) -> bool:
    clean_email = (email or "").strip().lower()
    if not clean_email:
        return False
    bind = db.get_bind()
    if bind is not None and bind.dialect.name == "postgresql":
        rows = db.execute(
            text(
                "SELECT id FROM koma_internal.auth_user_candidates(:identifier, NULL)"
            ),
            {"identifier": clean_email},
        ).all()
        return len(rows) > 0

    found = db.execute(
        text(
            "SELECT 1 FROM usuarios WHERE lower(coalesce(email, '')) = :identifier LIMIT 1"
        ),
        {"identifier": clean_email},
    ).scalar_one_or_none()
    return found is not None


@dataclass
class UniversalProvisioningInput:
    name: str = ""
    subdomain: str | None = None
    explicit_subdomain: bool = False
    plan: str = "pro"
    operation_profile: str | None = None
    segment_preset: str | None = None
    admin_name: str = ""
    admin_email: str = ""
    admin_password: str | None = None
    phone: str | None = None
    address: str | None = None
    order_types: list[str] = field(default_factory=list)
    operating_hours: list[dict[str, str]] = field(default_factory=list)
    apply_segment_preset: bool = False
    menu_text: str | None = None
    menu_items: list[dict[str, Any]] = field(default_factory=list)
    structured_text: str | None = None
    requested_restaurant_id: int | None = None
    defer_trial: bool = True
    qa_lab: bool = False
    qa_hours: int = 24
    audit_action: str = "UNIVERSAL_TENANT_PROVISION"
    audit_reason: str = "Provisionamento unificado de restaurante"
    commercial_terms_status: str = "not_contracted"


def _resolve_unique_slug(db: Session, base_slug: str, *, allow_suffix: bool) -> str:
    candidate = base_slug[:100].rstrip("-") or "restaurante"
    if slug_owner_id(db, candidate) is None and candidate not in RESERVED_SLUGS:
        return candidate
    if not allow_suffix:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="O slug/subdomínio informado já está em uso por outro restaurante.",
        )
    for counter in range(2, 50):
        suffix = f"-{counter}"
        trimmed = candidate[: max(1, 100 - len(suffix))].rstrip("-")
        next_slug = f"{trimmed}{suffix}"
        if next_slug not in RESERVED_SLUGS and slug_owner_id(db, next_slug) is None:
            return next_slug
    suffix = f"-{uuid.uuid4().hex[:6]}"
    trimmed = candidate[: max(1, 100 - len(suffix))].rstrip("-")
    return f"{trimmed}{suffix}"


def _prepare_provisioning_spec(
    payload: UniversalProvisioningInput,
    *,
    dry_run: bool,
) -> dict[str, Any]:
    parsed_structured: dict[str, Any] | None = None
    if payload.structured_text and payload.structured_text.strip():
        parsed_structured = parse_express_provisioning_input(
            structured_text=payload.structured_text,
            require_admin_credentials=True,
        )
    parsed_fields = (parsed_structured or {}).get("fields", {})

    name = (payload.name or str(parsed_fields.get("name") or "")).strip()
    raw_subdomain = (payload.subdomain or "").strip().lower()
    explicit_slug = bool(payload.explicit_subdomain or raw_subdomain)
    if raw_subdomain:
        slug = raw_subdomain
    elif parsed_fields.get("slug"):
        slug = str(parsed_fields["slug"]).strip().lower()
    elif name:
        slug = slugify_restaurant_name(name)
    else:
        slug = ""

    plan = (payload.plan or str(parsed_fields.get("plan") or "pro")).strip().lower()
    operation_profile = (
        payload.operation_profile
        or str(parsed_fields.get("operation_profile") or "generic")
    ).strip().lower()
    segment_preset = payload.segment_preset or parsed_fields.get("segment_preset")

    admin_name = (payload.admin_name or str(parsed_fields.get("admin_name") or "")).strip()
    admin_email = (payload.admin_email or str(parsed_fields.get("admin_email") or "")).strip().lower()
    phone = payload.phone or parsed_fields.get("phone")
    address = payload.address or parsed_fields.get("address")

    order_types: list[str] = []
    for candidate in list(payload.order_types or parsed_fields.get("order_types") or []):
        clean_mode = str(candidate).strip().lower()
        if clean_mode in {"consumo_local", "retirada", "delivery"} and clean_mode not in order_types:
            order_types.append(clean_mode)

    operating_hours = list(payload.operating_hours or parsed_fields.get("operating_hours") or [])

    warnings: list[str] = list((parsed_structured or {}).get("warnings") or [])
    menu_items: list[dict[str, Any]] = []
    for raw_item in (parsed_structured or {}).get("menu_items") or []:
        if isinstance(raw_item, dict):
            menu_items.append(dict(raw_item))

    if payload.menu_text and payload.menu_text.strip():
        menu_parsed = parse_express_provisioning_input(
            structured_text=f"Cardápio:\n{payload.menu_text.strip()}",
            require_admin_credentials=False,
        )
        menu_items.extend(menu_parsed.get("menu_items") or [])
        warnings.extend(menu_parsed.get("warnings") or [])

    for raw_item in payload.menu_items or []:
        if not isinstance(raw_item, dict):
            continue
        item_name = str(raw_item.get("name") or raw_item.get("nome") or "").strip()
        raw_price = raw_item.get("price", raw_item.get("preco"))
        if not item_name or raw_price is None:
            continue
        try:
            price = round(float(raw_price), 2)
        except (TypeError, ValueError):
            continue
        if price < 0:
            continue
        cat_name = str(raw_item.get("category") or raw_item.get("categoria") or "Cardápio").strip() or "Cardápio"
        menu_items.append(
            {
                "name": item_name,
                "price": price,
                "category": cat_name,
                "category_id": slugify_category_id(cat_name),
                "print_destination": infer_category_print_destination(cat_name),
                "description": str(raw_item.get("description") or raw_item.get("descricao") or "").strip(),
            }
        )

    categories_preview: list[dict[str, str]] = []
    seen_cat_ids: set[str] = set()
    if payload.apply_segment_preset:
        for cat in segment_categories_for(segment_preset, operation_profile):
            if cat["id"] not in seen_cat_ids:
                seen_cat_ids.add(cat["id"])
                categories_preview.append(dict(cat))
    for item in menu_items:
        cid = str(item.get("category_id") or slugify_category_id(str(item.get("category") or "Cardápio")))
        cname = str(item.get("category") or "Cardápio").strip() or "Cardápio"
        dest = str(item.get("print_destination") or infer_category_print_destination(cname))
        if cid not in seen_cat_ids:
            seen_cat_ids.add(cid)
            categories_preview.append({"id": cid, "nome": cname, "destino_impressao": dest})

    missing_fields: list[str] = []
    if len(name) < 2:
        missing_fields.append("name")
    if len(admin_name) < 2:
        missing_fields.append("admin_name")
    if not admin_email or not EMAIL_RE.fullmatch(admin_email):
        missing_fields.append("admin_email")

    if not dry_run:
        if len(name) < 2:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="O nome do restaurante deve ter ao menos 2 caracteres.",
            )
        if not slug or not SLUG_RE.fullmatch(slug):
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
                    f"Plano inválido '{plan}'. Escolha entre: "
                    f"{', '.join(sorted(VALID_SUBSCRIPTION_PLANS))}."
                ),
            )
        if operation_profile not in SUPPORTED_OPERATION_PROFILES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=(
                    "Tipo de operação indisponível. Escolha entre: "
                    "Outro, Pizzaria, Açaí, Churrasco ou Marmitaria."
                ),
            )
        if len(admin_name) < 2:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="O nome do administrador deve ter ao menos 2 caracteres.",
            )
        if not admin_email or not EMAIL_RE.fullmatch(admin_email):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Informe um e-mail válido para o administrador inicial.",
            )
        if payload.admin_password is not None:
            if len(payload.admin_password) < 8 or len(payload.admin_password.encode("utf-8")) > 72:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="A senha deve possuir entre 8 caracteres e 72 bytes.",
                )

    return {
        "name": name,
        "slug": slug,
        "explicit_slug": explicit_slug,
        "plan": plan,
        "operation_profile": operation_profile,
        "segment_preset": segment_preset,
        "admin_name": admin_name,
        "admin_email": admin_email,
        "phone": phone,
        "address": address,
        "order_types": order_types,
        "operating_hours": operating_hours,
        "categories": categories_preview,
        "menu_items": menu_items,
        "missing_fields": missing_fields,
        "warnings": warnings,
    }


def _find_idempotent_replay(
    db: Session,
    *,
    origin: ProvisioningOrigin,
    idempotency_key: str,
    admin_email: str,
    slug_hint: str | None = None,
) -> dict[str, Any] | None:
    clean_key = idempotency_key.strip()
    if not clean_key:
        return None
    candidates: list[int] = []
    if slug_hint:
        direct_tid = slug_owner_id(db, slug_hint)
        if direct_tid is not None:
            candidates.append(direct_tid)
    for tid in _discover_candidate_restaurant_ids(db, limit=25):
        if tid not in candidates:
            candidates.append(tid)
    for tid in candidates:
        with tenant_session_scope(db, tid):
            rows = (
                db.query(SuperAdminAuditLog)
                .filter(
                    SuperAdminAuditLog.restaurante_id == tid,
                    SuperAdminAuditLog.action.in_(
                        ("UNIVERSAL_TENANT_PROVISION", "SUPERADMIN_TENANT_ONBOARD")
                    ),
                )
                .order_by(SuperAdminAuditLog.id.desc())
                .all()
            )
            for row in rows:
                data = row.after_data if isinstance(row.after_data, dict) else {}
                if (
                    data.get("idempotency_key") == clean_key
                    and data.get("origin") == origin
                ):
                    if origin == "public_self_service" and admin_email and data.get("admin_email") != admin_email:
                        raise HTTPException(
                            status_code=status.HTTP_409_CONFLICT,
                            detail="Chave de idempotência já utilizada por outra inscrição.",
                        )
                    restaurante = db.query(Restaurante).filter(Restaurante.id == tid).one()
                    profile = (
                        db.query(RestauranteOperationProfile)
                        .filter(RestauranteOperationProfile.restaurante_id == tid)
                        .one_or_none()
                    )
                    admin_user = (
                        db.query(Usuario)
                        .filter(Usuario.restaurante_id == tid, Usuario.cargo == "admin")
                        .order_by(Usuario.created_at.asc())
                        .first()
                    )
                    trial_status = str(data.get("trial_status") or "pending_setup")
                    trial_started_at = data.get("trial_started_at")
                    trial_ends_at = data.get("trial_ends_at")
                    return {
                        "id": str(tid),
                        "idSelectionMode": str(data.get("id_selection_mode") or "replay"),
                        "name": restaurante.nome,
                        "subdomain": str(restaurante.slug or ""),
                        "plan": restaurante.plano,
                        "operationProfile": str(profile.profile_key) if profile else "generic",
                        "origin": origin,
                        "status": "ACTIVE",
                        "preparationMode": trial_status == "pending_setup",
                        "commercialStatus": "preparation" if trial_status == "pending_setup" else "administrative",
                        "onlinePaymentStatus": "disconnected",
                        "commercialTermsStatus": str(data.get("commercial_terms_status") or "not_contracted"),
                        "qaLab": bool(data.get("qa_lab")),
                        "idempotentReplay": True,
                        "trial": {
                            "status": trial_status,
                            "startedAt": trial_started_at,
                            "endsAt": trial_ends_at,
                            "daysRemaining": DEFAULT_TRIAL_DAYS,
                            "daysGranted": DEFAULT_TRIAL_DAYS,
                        },
                        "admin": {
                            "id": admin_user.id if admin_user else str(data.get("admin_user_id") or ""),
                            "name": admin_user.nome if admin_user else "",
                            "email": admin_user.email if admin_user else str(data.get("admin_email") or ""),
                            "status": admin_user.status if admin_user else "ativo",
                        },
                        "activation": {
                            "mode": "password_set" if (admin_user and admin_user.status == "ativo") else "invite_pending",
                            "token": None,
                        },
                        "bootstrap": {
                            "categoriesCreated": int(data.get("categories_created") or 0),
                            "productsCreated": int(data.get("products_created") or 0),
                        },
                        "paths": {
                            "cashier": "/?view=caixa",
                            "publicMenu": f"/c/{restaurante.slug}",
                        },
                        "message": "Provisionamento recuperado de forma idempotente sem duplicar registros.",
                    }
    return None


def _build_dry_run_response(
    db: Session,
    *,
    spec: dict[str, Any],
    origin: ProvisioningOrigin,
    allow_id_reuse: bool,
    requested_restaurant_id: int | None,
    defer_trial: bool,
    qa_lab: bool,
) -> dict[str, Any]:
    candidate_id: int | None = None
    id_selection_mode = "sequence"
    if allow_id_reuse:
        candidate_id, id_selection_mode = reserve_superadmin_tenant_id(
            db,
            requested_id=requested_restaurant_id,
        )

    slug_available = (
        bool(spec["slug"])
        and spec["slug"] not in RESERVED_SLUGS
        and slug_owner_id(db, spec["slug"]) is None
    )

    return {
        "dryRun": True,
        "readyToProvision": len(spec["missing_fields"]) == 0,
        "origin": origin,
        "suggestedRestaurantId": str(candidate_id) if candidate_id is not None else None,
        "idSelectionMode": id_selection_mode,
        "name": spec["name"],
        "subdomain": spec["slug"],
        "slugAvailable": slug_available,
        "plan": spec["plan"],
        "operationProfile": spec["operation_profile"],
        "segmentPreset": spec["segment_preset"],
        "deferTrial": defer_trial,
        "qaLab": qa_lab,
        "admin": {
            "name": spec["admin_name"],
            "email": spec["admin_email"],
        },
        "contact": {
            "phone": spec["phone"],
            "address": spec["address"],
        },
        "operations": {
            "orderTypes": spec["order_types"],
            "operatingHours": spec["operating_hours"],
        },
        "bootstrap": {
            "categories": spec["categories"],
            "productsCount": len(spec["menu_items"]),
            "menuItems": spec["menu_items"],
        },
        "missingFields": spec["missing_fields"],
        "warnings": spec["warnings"],
    }


def provision_restaurant(
    db: Session,
    payload: UniversalProvisioningInput,
    *,
    origin: ProvisioningOrigin,
    actor: str,
    allow_id_reuse: bool = False,
    allow_existing_admin_email: bool = False,
    declared_actor: str | None = None,
    dry_run: bool = False,
    idempotency_key: str | None = None,
    password_hasher: Callable[[str], str] = get_password_hash,
) -> dict[str, Any]:
    """Provisiona atomicamente um tenant e seus artefatos iniciais em um único núcleo."""
    spec = _prepare_provisioning_spec(payload, dry_run=dry_run)

    if dry_run:
        return _build_dry_run_response(
            db,
            spec=spec,
            origin=origin,
            allow_id_reuse=allow_id_reuse,
            requested_restaurant_id=payload.requested_restaurant_id,
            defer_trial=payload.defer_trial,
            qa_lab=payload.qa_lab,
        )

    if payload.requested_restaurant_id is not None and not allow_id_reuse:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="A seleção manual de ID é exclusiva do provisionamento autorizado.",
        )

    if origin == "public_self_service" and len(spec["menu_items"]) > 250:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Importe até 250 itens na criação inicial; itens adicionais podem ser importados no painel.",
        )

    clean_idempotency = str(idempotency_key or "").strip() or None
    if clean_idempotency:
        replay = _find_idempotent_replay(
            db,
            origin=origin,
            idempotency_key=clean_idempotency,
            admin_email=spec["admin_email"],
            slug_hint=spec["slug"],
        )
        if replay is not None:
            return replay

    with provisioning_concurrency_guard():
        if clean_idempotency:
            replay = _find_idempotent_replay(
                db,
                origin=origin,
                idempotency_key=clean_idempotency,
                admin_email=spec["admin_email"],
                slug_hint=spec["slug"],
            )
            if replay is not None:
                return replay

        if (
            origin == "public_self_service"
            and not allow_existing_admin_email
            and _admin_email_exists_anywhere(db, spec["admin_email"])
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Já existe uma conta KÔMA associada a este e-mail. "
                    "Entre com sua conta atual ou utilize outro e-mail para este estabelecimento."
                ),
            )

        excluded_ids: set[int] = set()
        max_attempts = 1 if payload.requested_restaurant_id is not None else 5

        for attempt in range(max_attempts):
            if allow_id_reuse:
                tenant_id, id_selection_mode = reserve_superadmin_tenant_id(
                    db,
                    requested_id=payload.requested_restaurant_id,
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
                    lock_onboarding_transaction(db)
                    if allow_id_reuse:
                        assert_tenant_id_eligible_in_locked_tx(
                            db,
                            tenant_id,
                            requested_id=payload.requested_restaurant_id,
                        )

                    resolved_slug = _resolve_unique_slug(
                        db,
                        spec["slug"],
                        allow_suffix=not spec["explicit_slug"],
                    )

                    restaurante = Restaurante(
                        id=tenant_id,
                        nome=spec["name"],
                        slug=resolved_slug,
                        plano=spec["plan"],
                        saas_status="active",
                        endereco=spec["address"],
                        socials=format_socials_with_phone(spec["phone"]),
                        horarios_funcionamento=spec["operating_hours"] or None,
                        # Apenas Dinheiro nasce habilitado sem setup prévio; Pix exige Mercado Pago OAuth ou Pix Direto.
                        formas_pagamento_aceitas=["Dinheiro"],
                    )
                    db.add(restaurante)
                    db.flush()

                    db.add(
                        RestauranteOperationProfile(
                            restaurante_id=tenant_id,
                            profile_key=spec["operation_profile"],
                        )
                    )

                    if payload.defer_trial:
                        trial = {
                            "status": "pending_setup",
                            "started_at": None,
                            "ends_at": None,
                            "days": DEFAULT_TRIAL_DAYS,
                        }
                    else:
                        trial = create_default_trial(db, tenant_id)

                    delivery_enabled = (
                        "delivery" in spec["order_types"]
                        if spec["order_types"]
                        else True
                    )
                    config = ConfiguracaoRestaurante(
                        restaurante_id=tenant_id,
                        impressao_nome_restaurante=spec["name"][:80],
                        tipos_pedido_ativos=spec["order_types"] or None,
                        delivery_ativo=delivery_enabled,
                    )
                    db.add(config)

                    now = utc_now()
                    if payload.admin_password:
                        invite_token: str | None = None
                        initial_admin = Usuario(
                            restaurante_id=tenant_id,
                            nome=spec["admin_name"],
                            email=spec["admin_email"],
                            telefone=spec["phone"],
                            cargo="admin",
                            status="ativo",
                            senha_hash=password_hasher(payload.admin_password),
                        )
                    else:
                        invite_token = str(uuid.uuid4())
                        initial_admin = Usuario(
                            restaurante_id=tenant_id,
                            nome=spec["admin_name"],
                            email=spec["admin_email"],
                            telefone=spec["phone"],
                            cargo="admin",
                            status="pendente_ativacao",
                            senha_hash=None,
                            token_convite=invite_token,
                            token_expira_em=now + datetime.timedelta(hours=INVITATION_TTL_HOURS),
                        )
                    db.add(initial_admin)
                    db.flush()

                    categories_created = 0
                    products_created = 0
                    created_cat_ids: set[str] = set()

                    for idx, cat in enumerate(spec["categories"], start=1):
                        cid = cat["id"]
                        if cid in created_cat_ids:
                            continue
                        created_cat_ids.add(cid)
                        db.add(
                            Categoria(
                                id=cid,
                                restaurante_id=tenant_id,
                                nome=cat["nome"],
                                destino_impressao=cat["destino_impressao"],
                                ordem_exibicao=idx,
                            )
                        )
                        categories_created += 1

                    if spec["categories"]:
                        db.flush()

                    seen_prod_ids: set[str] = set()
                    for idx, item in enumerate(spec["menu_items"], start=1):
                        cid = str(item.get("category_id") or slugify_category_id(str(item.get("category") or "Cardápio")))
                        cname = str(item.get("category") or "Cardápio").strip() or "Cardápio"
                        if cid not in created_cat_ids:
                            created_cat_ids.add(cid)
                            db.add(
                                Categoria(
                                    id=cid,
                                    restaurante_id=tenant_id,
                                    nome=cname,
                                    destino_impressao=str(
                                        item.get("print_destination")
                                        or infer_category_print_destination(cname)
                                    ),
                                    ordem_exibicao=len(created_cat_ids),
                                )
                            )
                            categories_created += 1
                            db.flush()

                        pid = build_deterministic_import_product_id(item["name"], cid)
                        if pid in seen_prod_ids:
                            pid = f"{pid}-{idx}"
                        seen_prod_ids.add(pid)
                        db.add(
                            Produto(
                                id=pid,
                                restaurante_id=tenant_id,
                                nome=item["name"],
                                categoria_id=cid,
                                preco=round(float(item["price"]), 2),
                                descricao=str(item.get("description") or ""),
                                ativo=True,
                                ordem_exibicao=idx,
                            )
                        )
                        products_created += 1

                    after_data = {
                        "restaurante_id": tenant_id,
                        "origin": origin,
                        "verified_actor": str(actor or origin),
                        "declared_actor": declared_actor,
                        "idempotency_key": clean_idempotency,
                        "id_selection_mode": id_selection_mode,
                        "requested_restaurant_id": payload.requested_restaurant_id,
                        "nome": spec["name"],
                        "slug": resolved_slug,
                        "plano": spec["plan"],
                        "saas_status": "active",
                        "operation_profile": spec["operation_profile"],
                        "trial_status": trial["status"],
                        "trial_started_at": trial["started_at"].isoformat() if trial["started_at"] else None,
                        "trial_ends_at": trial["ends_at"].isoformat() if trial["ends_at"] else None,
                        "trial_days": trial["days"],
                        "admin_user_id": initial_admin.id,
                        "admin_email": spec["admin_email"],
                        "mercado_pago": "disconnected",
                        "commercial_terms_status": payload.commercial_terms_status,
                        "qa_lab": bool(payload.qa_lab),
                        "categories_created": categories_created,
                        "products_created": products_created,
                    }

                    db.add(
                        SuperAdminAuditLog(
                            restaurante_id=tenant_id,
                            actor=str(actor or origin),
                            action=payload.audit_action,
                            reason=payload.audit_reason,
                            before_data=None,
                            after_data=after_data,
                        )
                    )
                    db.commit()

                    qa_session: dict[str, Any] | None = None
                    if payload.qa_lab:
                        from .restaurant_provisioning import start_operational_qa_session

                        with tenant_session_scope(db, tenant_id):
                            qa_session = start_operational_qa_session(
                                db,
                                restaurante_id=tenant_id,
                                actor=str(actor or origin),
                                reason="Janela automática para laboratório de homologação QA",
                                hours=max(1, min(int(payload.qa_hours or 24), 72)),
                            )

                    logger.info(
                        "UNIVERSAL PROVISIONED tenant=%s origin=%s mode=%s actor=%s profile=%s trial_status=%s cats=%s prods=%s qa=%s",
                        tenant_id,
                        origin,
                        id_selection_mode,
                        actor,
                        spec["operation_profile"],
                        trial["status"],
                        categories_created,
                        products_created,
                        payload.qa_lab,
                    )

                    response: dict[str, Any] = {
                        "id": str(tenant_id),
                        "idSelectionMode": id_selection_mode,
                        "name": spec["name"],
                        "subdomain": resolved_slug,
                        "plan": spec["plan"],
                        "operationProfile": spec["operation_profile"],
                        "origin": origin,
                        "status": "ACTIVE",
                        "preparationMode": trial["status"] == "pending_setup",
                        "commercialStatus": "preparation" if trial["status"] == "pending_setup" else "administrative",
                        "onlinePaymentStatus": "disconnected",
                        "commercialTermsStatus": payload.commercial_terms_status,
                        "qaLab": bool(payload.qa_lab),
                        "idempotentReplay": False,
                        "trial": {
                            "status": trial["status"],
                            "startedAt": trial["started_at"].isoformat() if trial["started_at"] else None,
                            "endsAt": trial["ends_at"].isoformat() if trial["ends_at"] else None,
                            "daysRemaining": trial["days"] if trial["started_at"] else DEFAULT_TRIAL_DAYS,
                            "daysGranted": DEFAULT_TRIAL_DAYS,
                        },
                        "admin": {
                            "id": initial_admin.id,
                            "name": spec["admin_name"],
                            "email": spec["admin_email"],
                            "status": initial_admin.status,
                            "cargo": initial_admin.cargo,
                            "role": initial_admin.cargo,
                            "restaurante_id": tenant_id,
                        },
                        "activation": {
                            "mode": "password_set" if payload.admin_password else "invite_pending",
                            "token": invite_token,
                        },
                        "bootstrap": {
                            "categoriesCreated": categories_created,
                            "productsCreated": products_created,
                            "orderTypes": spec["order_types"],
                            "operatingHours": spec["operating_hours"],
                        },
                        "warnings": spec["warnings"],
                        "paths": {
                            "cashier": "/?view=caixa",
                            "publicMenu": f"/c/{resolved_slug}",
                        },
                        "message": (
                            "Restaurante criado em modo de preparação sem consumir os 7 dias grátis."
                            if trial["status"] == "pending_setup"
                            else "Restaurante provisionado com 7 dias grátis."
                        ),
                    }
                    if qa_session is not None:
                        response["qa"] = {
                            "active": True,
                            "expiresAt": qa_session["expiresAt"],
                            "qaMenuPath": qa_session["qaMenuPath"],
                        }
                    return response
            except HTTPException as exc:
                if (
                    payload.requested_restaurant_id is None
                    and exc.status_code == status.HTTP_409_CONFLICT
                    and "slug/subdomínio" not in str(exc.detail)
                    and attempt + 1 < max_attempts
                ):
                    excluded_ids.add(tenant_id)
                    continue
                raise
            except IntegrityError:
                if db.in_transaction():
                    db.rollback()
                if payload.requested_restaurant_id is None and attempt + 1 < max_attempts:
                    excluded_ids.add(tenant_id)
                    continue
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Não foi possível provisionar: um dos identificadores já está em uso.",
                )

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Não foi possível alocar um ID elegível livre para o restaurante.",
    )

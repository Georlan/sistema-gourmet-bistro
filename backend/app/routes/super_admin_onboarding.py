import datetime
import logging
import math
import re
from typing import Any

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

from ..database import Base, SessionLocal, tenant_session_scope
from ..models import ConfiguracaoRestaurante, Restaurante, SuperAdminAuditLog, Usuario
from ..security import get_password_hash
from ..subscription import VALID_SUBSCRIPTION_PLANS
from .super_admin import _discover_restaurant_ids, get_current_admin

logger = logging.getLogger("koma.super_admin.onboarding")
router = APIRouter(prefix="/super-admin", tags=["SuperAdmin"])

_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
DEFAULT_TRIAL_DAYS = 7
MAX_TRIAL_ACTION_DAYS = 90

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


class TenantOnboardingRequest(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    subdomain: str = Field(min_length=2, max_length=100)
    plan: str = Field(min_length=2, max_length=32)
    admin_name: str = Field(min_length=2, max_length=100)
    admin_email: str = Field(min_length=3, max_length=100)
    temporary_password: str = Field(min_length=8, max_length=72)

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


def _reserve_restaurant_id(db) -> int:
    """Reserva um ID gerado pelo banco antes de vincular a transação ao novo tenant.

    Em PostgreSQL o valor vem da sequência da PK e não é reutilizado mesmo que o
    provisionamento falhe. A gravação do restaurante e de todos os seus defaults
    acontece depois, em uma única transação RLS vinculada a esse ID.
    """
    if db.get_bind().dialect.name == "postgresql":
        new_id = db.execute(
            text(
                "SELECT nextval(pg_get_serial_sequence('public.restaurantes', 'id'))"
            )
        ).scalar_one()
        db.rollback()
        return int(new_id)

    new_id = db.execute(
        text("SELECT COALESCE(MAX(id), 0) + 1 FROM restaurantes")
    ).scalar_one()
    db.rollback()
    return int(new_id)


def _serialize_conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _slug_owner_id(db, slug: str) -> int | None:
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


def _lock_onboarding_transaction(db) -> None:
    """Serializa somente provisionamentos para tornar duplo clique seguro."""
    if db.get_bind().dialect.name == "postgresql":
        db.execute(
            text(
                "SELECT pg_advisory_xact_lock(hashtext('koma-superadmin-onboarding'))"
            )
        )


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


def _create_default_trial(db, tenant_id: int) -> dict[str, Any]:
    started_at = _utc_now()
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


@router.get("/trials")
def list_trials(admin: dict[str, Any] = Depends(get_current_admin)):
    """Lista o entitlement de teste grátis sem inferir cobrança ou MRR."""
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


@router.post("/restaurantes", status_code=status.HTTP_201_CREATED)
def create_tenant(
    payload: TenantOnboardingRequest,
    admin: dict[str, Any] = Depends(get_current_admin),
):
    """Cria restaurante, administrador inicial, defaults e auditoria sem SQL manual.

    O ID é reservado pela sequência do banco. Depois disso, todas as escritas são
    executadas sob o mesmo tenant/RLS e confirmadas em um único commit. O fluxo não
    cria conta Mercado Pago nem integrações externas: o novo restaurante nasce
    explicitamente desconectado, recebe 7 dias grátis de SaaS e conecta o recebedor
    do Cardápio Online depois via OAuth.
    """
    normalized = _normalize_payload(payload)
    db = SessionLocal()
    tenant_id: int | None = None

    try:
        tenant_id = _reserve_restaurant_id(db)

        with tenant_session_scope(db, tenant_id):
            _lock_onboarding_transaction(db)

            if _slug_owner_id(db, normalized["slug"]) is not None:
                raise _serialize_conflict(
                    "O slug/subdomínio informado já está em uso por outro restaurante."
                )

            restaurante = Restaurante(
                id=tenant_id,
                nome=normalized["name"],
                slug=normalized["slug"],
                plano=normalized["plan"],
                saas_status="active",
            )
            db.add(restaurante)
            db.flush()

            trial = _create_default_trial(db, tenant_id)

            config = ConfiguracaoRestaurante(
                restaurante_id=tenant_id,
                impressao_nome_restaurante=normalized["name"],
            )
            db.add(config)

            initial_admin = Usuario(
                restaurante_id=tenant_id,
                nome=normalized["admin_name"],
                email=normalized["admin_email"],
                cargo="admin",
                status="ativo",
                senha_hash=get_password_hash(payload.temporary_password),
            )
            db.add(initial_admin)
            db.flush()

            audit = SuperAdminAuditLog(
                restaurante_id=tenant_id,
                actor=str(admin.get("user") or "superadmin"),
                action="SUPERADMIN_TENANT_ONBOARD",
                reason="Provisionamento inicial de restaurante pelo Super Admin",
                before_data=None,
                after_data={
                    "restaurante_id": tenant_id,
                    "nome": normalized["name"],
                    "slug": normalized["slug"],
                    "plano": normalized["plan"],
                    "saas_status": "active",
                    "trial_status": trial["status"],
                    "trial_started_at": trial["started_at"].isoformat(),
                    "trial_ends_at": trial["ends_at"].isoformat(),
                    "trial_days": trial["days"],
                    "admin_user_id": initial_admin.id,
                    "admin_email": normalized["admin_email"],
                    "mercado_pago": "disconnected",
                },
            )
            db.add(audit)
            db.commit()

            logger.info(
                "SUPERADMIN TENANT ONBOARDED tenant=%s actor=%s plan=%s trial_days=%s",
                tenant_id,
                admin.get("user"),
                normalized["plan"],
                DEFAULT_TRIAL_DAYS,
            )

            return {
                "id": str(tenant_id),
                "name": normalized["name"],
                "subdomain": normalized["slug"],
                "plan": normalized["plan"],
                "status": "ACTIVE",
                "onlinePaymentStatus": "disconnected",
                "trial": {
                    "status": "active",
                    "startedAt": trial["started_at"].isoformat(),
                    "endsAt": trial["ends_at"].isoformat(),
                    "daysRemaining": DEFAULT_TRIAL_DAYS,
                    "daysGranted": DEFAULT_TRIAL_DAYS,
                },
                "admin": {
                    "id": initial_admin.id,
                    "name": normalized["admin_name"],
                    "email": normalized["admin_email"],
                    "status": "ativo",
                },
                "paths": {
                    "cashier": "/?view=caixa",
                    "publicMenu": f"/c/{normalized['slug']}",
                },
                "message": "Restaurante provisionado com 7 dias grátis.",
            }
    except HTTPException:
        if db.in_transaction():
            db.rollback()
        raise
    except IntegrityError:
        if db.in_transaction():
            db.rollback()
        logger.exception(
            "SUPERADMIN TENANT ONBOARD CONFLICT tenant=%s actor=%s",
            tenant_id,
            admin.get("user"),
        )
        raise _serialize_conflict(
            "Não foi possível provisionar: um dos identificadores já está em uso."
        )
    except Exception:
        if db.in_transaction():
            db.rollback()
        logger.exception(
            "SUPERADMIN TENANT ONBOARD FAILED tenant=%s actor=%s",
            tenant_id,
            admin.get("user"),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Falha ao provisionar o restaurante. Nenhuma criação parcial foi mantida.",
        )
    finally:
        db.close()
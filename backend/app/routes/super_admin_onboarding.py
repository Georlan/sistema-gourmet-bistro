import logging
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from ..database import SessionLocal, tenant_session_scope
from ..models import ConfiguracaoRestaurante, Restaurante, SuperAdminAuditLog, Usuario
from ..security import get_password_hash
from ..subscription import VALID_SUBSCRIPTION_PLANS
from .super_admin import get_current_admin

logger = logging.getLogger("koma.super_admin.onboarding")
router = APIRouter(prefix="/super-admin", tags=["SuperAdmin"])

_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


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


@router.post("/restaurantes", status_code=status.HTTP_201_CREATED)
def create_tenant(
    payload: TenantOnboardingRequest,
    admin: dict[str, Any] = Depends(get_current_admin),
):
    """Cria restaurante, administrador inicial, defaults e auditoria sem SQL manual.

    O ID é reservado pela sequência do banco. Depois disso, todas as escritas são
    executadas sob o mesmo tenant/RLS e confirmadas em um único commit. O fluxo não
    cria conta Mercado Pago nem integrações externas: o novo restaurante nasce
    explicitamente desconectado e conecta o recebedor depois via OAuth.
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
                    "admin_user_id": initial_admin.id,
                    "admin_email": normalized["admin_email"],
                    "mercado_pago": "disconnected",
                },
            )
            db.add(audit)
            db.commit()

            logger.info(
                "SUPERADMIN TENANT ONBOARDED tenant=%s actor=%s plan=%s",
                tenant_id,
                admin.get("user"),
                normalized["plan"],
            )

            return {
                "id": str(tenant_id),
                "name": normalized["name"],
                "subdomain": normalized["slug"],
                "plan": normalized["plan"],
                "status": "ACTIVE",
                "onlinePaymentStatus": "disconnected",
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
                "message": "Restaurante provisionado com sucesso.",
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

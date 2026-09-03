import datetime
import os
import time
import uuid
from typing import Any, Dict

import jwt
import httpx
from fastapi import APIRouter, Body, Depends, Header, HTTPException, Request, status
from sqlalchemy import func, text
from pydantic import BaseModel, Field

from ..config import settings
from ..database import SessionLocal, engine, tenant_session_scope
from ..models import Lancamento, Pagamento, RestaurantPaymentAccount, Restaurante
from ..security import IPRateLimiter, create_access_token, verify_password
from .super_admin_services import (
    CloudflareService,
    RailwayService,
    TelegramService,
    logger,
)
from ..services.whatsapp import obter_status_evolution

# --- ENVIRONMENT VARIABLES VALIDATION ---
railway_service_id = os.getenv("RAILWAY_SERVICE_ID", "")
if railway_service_id:
    try:
        uuid.UUID(railway_service_id)
    except ValueError:
        raise ValueError("Variável de ambiente 'RAILWAY_SERVICE_ID' deve estar em formato UUID válido.")


router = APIRouter(
    prefix="/super-admin",
    tags=["SuperAdmin"],
)


def _unavailable(detail: str, *, not_implemented: bool = False) -> None:
    raise HTTPException(
        status_code=(
            status.HTTP_501_NOT_IMPLEMENTED
            if not_implemented
            else status.HTTP_503_SERVICE_UNAVAILABLE
        ),
        detail=detail,
    )


# --- SUPERADMIN AUTHENTICATION ---
class TokenRequest(BaseModel):
    username: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=1024)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str


superadmin_login_rate_limiter = IPRateLimiter(requests_per_minute=8)


def _get_superadmin_credentials() -> tuple[str, str]:
    username = os.getenv("SUPERADMIN_USERNAME")
    password_hash = os.getenv("SUPERADMIN_PASSWORD_HASH")
    if not username or not password_hash:
        raise RuntimeError("SUPERADMIN_USERNAME and SUPERADMIN_PASSWORD_HASH must be configured.")
    return username, password_hash


@router.post("/token", response_model=TokenResponse)
def login_for_access_token(payload: TokenRequest, request: Request):
    """Verifica credenciais dedicadas e emite JWT exclusivo de superadmin."""
    superadmin_login_rate_limiter.check(request)
    try:
        expected_username, expected_password_hash = _get_superadmin_credentials()
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        )

    if payload.username != expected_username or not verify_password(
        payload.password, expected_password_hash
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(
        subject=payload.username,
        restaurante_id=0,
        role="superadmin",
    )
    return {
        "access_token": access_token,
        "token_type": "bearer",
    }


def get_current_admin(authorization: str = Header(None)) -> Dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Valid authorization bearer token required.",
        )

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Valid authorization bearer token required.",
        )

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Valid authorization bearer token required.",
        )

    if payload.get("role") != "superadmin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso restrito a superadministradores.",
        )

    if payload.get("sub") is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Valid authorization bearer token required.",
        )

    return {"user": payload.get("sub"), "role": payload.get("role")}


# --- TENANTS MANAGEMENT ---
def _discover_restaurant_ids(db) -> list[int]:
    bind = db.get_bind()
    if bind is not None and bind.dialect.name == "postgresql":
        rows = db.execute(
            text("SELECT id FROM koma_internal.list_public_restaurants() ORDER BY id")
        ).scalars().all()
    else:
        rows = db.execute(text("SELECT id FROM restaurantes ORDER BY id")).scalars().all()
    return [int(row) for row in rows if row is not None]


def _payment_status(account: RestaurantPaymentAccount | None) -> str:
    if account is None:
        return "disconnected"
    return "connected" if account.status == "active" else "disconnected"


@router.get("/restaurantes")
def list_tenants(admin: dict = Depends(get_current_admin)):
    """Retorna uma projeção cross-tenant real sem desativar RLS.

    A descoberta dos IDs usa o helper SECURITY DEFINER já existente no PostgreSQL.
    Cada restaurante é então lido dentro do próprio `tenant_session_scope`, de modo
    que plano, pagamentos e métricas continuam obedecendo ao isolamento RLS.
    Nenhum token, segredo ou dado pessoal é retornado.
    """
    db = SessionLocal()
    now = datetime.datetime.now(datetime.timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    result: list[dict[str, Any]] = []

    try:
        restaurant_ids = _discover_restaurant_ids(db)
        for restaurant_id in restaurant_ids:
            with tenant_session_scope(db, restaurant_id):
                restaurante = (
                    db.query(Restaurante)
                    .filter(Restaurante.id == restaurant_id)
                    .one_or_none()
                )
                if restaurante is None:
                    raise RuntimeError(
                        f"Restaurante {restaurant_id} foi descoberto, mas não pôde ser lido no próprio escopo RLS."
                    )

                monthly_orders = (
                    db.query(func.count(Lancamento.id))
                    .filter(Lancamento.timestamp >= month_start)
                    .scalar()
                    or 0
                )
                monthly_billing = (
                    db.query(func.coalesce(func.sum(Pagamento.valor), 0))
                    .filter(
                        Pagamento.status == "aprovado",
                        Pagamento.criado_em >= month_start,
                    )
                    .scalar()
                    or 0
                )
                last_activity = db.query(func.max(Lancamento.timestamp)).scalar()
                payment_account = (
                    db.query(RestaurantPaymentAccount)
                    .filter(RestaurantPaymentAccount.provider == "mercado_pago")
                    .one_or_none()
                )

                result.append(
                    {
                        "id": str(restaurante.id),
                        "name": restaurante.nome,
                        "subdomain": restaurante.slug,
                        "plan": restaurante.plano,
                        # O schema ainda não possui suspensão global de tenant.
                        # Enquanto a Fase 2B não criar esse estado, existência na
                        # base representa um tenant operacionalmente registrado.
                        "status": "ACTIVE",
                        "statusSource": "registered",
                        "monthlyOrders": int(monthly_orders),
                        "monthlyBilling": float(monthly_billing),
                        "createdAt": None,
                        "lastActivity": (
                            last_activity.isoformat()
                            if last_activity is not None
                            else None
                        ),
                        "onlinePaymentStatus": _payment_status(payment_account),
                    }
                )

        logger.info(
            "SUPERADMIN TENANT LIST actor=%s tenant_count=%s source=rls_scoped",
            admin.get("user"),
            len(result),
        )
        return result
    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "SUPERADMIN TENANT LIST FAILED actor=%s",
            admin.get("user"),
        )
        _unavailable("Falha ao consolidar a listagem cross-tenant com isolamento RLS.")
    finally:
        db.close()


class OnboardingRequest(BaseModel):
    name: str
    plan: str
    subdomain: str


@router.post("/restaurantes/onboarding")
async def trigger_onboarding(
    payload: OnboardingRequest,
    admin: dict = Depends(get_current_admin),
):
    _unavailable(
        "Onboarding automático não possui provisionamento transacional e auditável.",
        not_implemented=True,
    )


class StatusUpdateRequest(BaseModel):
    status: str


@router.put("/restaurantes/{tenant_id}/status")
async def update_tenant_status(
    tenant_id: str,
    payload: StatusUpdateRequest,
    admin: dict = Depends(get_current_admin),
):
    _unavailable(
        "Alteração cross-tenant de status não possui persistência e auditoria reais.",
        not_implemented=True,
    )


@router.post("/restaurantes/{tenant_id}/flush-cache")
async def flush_tenant_cache(tenant_id: str, admin: dict = Depends(get_current_admin)):
    _unavailable("Flush de cache não possui executor real configurado.", not_implemented=True)


# --- DEVOPS & INFRASTRUCTURE ---
@router.get("/railway/telemetry")
async def fetch_devops_telemetry(
    admin: dict = Depends(get_current_admin),
    railway: RailwayService = Depends(RailwayService),
):
    try:
        return await railway.get_service_metrics()
    except RuntimeError as exc:
        _unavailable(str(exc))


@router.post("/railway/restart")
async def trigger_emergency_reboot(
    admin: dict = Depends(get_current_admin),
    railway: RailwayService = Depends(RailwayService),
    telegram: TelegramService = Depends(TelegramService),
):
    try:
        reboot_success = await railway.trigger_emergency_restart()
    except RuntimeError as exc:
        _unavailable(str(exc), not_implemented=True)
    if reboot_success:
        logger.critical("EMERGENCY SERVER RESTART ISSUED BY SUPERADMIN")
        await telegram.send_alert(
            "🚨 <b>ALERTA CRÍTICO:</b> Reinicialização de Emergência do servidor central do SaaS disparada pelo SuperAdmin!"
        )
        return {"success": True, "reboot_dispatched": True}
    raise HTTPException(status_code=500, detail="Reboot command failed on hosting layer.")


@router.get("/github/runs")
async def get_github_runs(admin: dict = Depends(get_current_admin)):
    token = os.getenv("GITHUB_TOKEN", "").strip()
    owner = os.getenv("GITHUB_OWNER", "Georlan").strip()
    repo = os.getenv("GITHUB_REPO", "sistema-gourmet-bistro").strip()
    if not token:
        _unavailable("GitHub não configurado no servidor.")
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
    }
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"https://api.github.com/repos/{owner}/{repo}/actions/runs",
            params={"per_page": 20},
            headers=headers,
            timeout=10.0,
        )
    if response.status_code != 200:
        _unavailable(f"GitHub API respondeu HTTP {response.status_code}.")
    return response.json()


@router.post("/github/dispatch")
async def github_dispatch(admin: dict = Depends(get_current_admin)):
    _unavailable(
        "Dispatch GitHub não possui workflow/ref explícitos configurados.",
        not_implemented=True,
    )


@router.post("/git/deploy")
async def git_deploy(admin: dict = Depends(get_current_admin)):
    _unavailable("Deploy pelo painel não possui executor real configurado.", not_implemented=True)


@router.get("/cloudflare/dns")
async def get_cloudflare_dns(
    admin: dict = Depends(get_current_admin),
    cloudflare: CloudflareService = Depends(CloudflareService),
):
    try:
        return await cloudflare.list_dns_records()
    except RuntimeError as exc:
        _unavailable(str(exc))


@router.post("/cloudflare/cname")
async def create_cloudflare_cname(
    payload: Dict[str, Any] = Body(...),
    admin: dict = Depends(get_current_admin),
    cloudflare: CloudflareService = Depends(CloudflareService),
):
    subdomain = str(payload.get("subdomain") or "").strip()
    if not subdomain:
        raise HTTPException(status_code=422, detail="subdomain é obrigatório.")
    try:
        record = await cloudflare.create_cname_record(subdomain)
    except RuntimeError as exc:
        _unavailable(str(exc))
    return {
        "success": True,
        "record": record,
        "dataStatus": "real",
    }


@router.get("/integrations/health")
def get_integrations_health(admin: dict = Depends(get_current_admin)):
    database_started = time.perf_counter()
    database_status = "available"
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception:
        database_status = "unavailable"

    def configured(*names: str) -> dict:
        is_configured = all(bool(os.getenv(name)) for name in names)
        return {
            "status": "configured_unverified" if is_configured else "not_configured",
            "source": "environment",
            "simulated": False,
        }

    return {
        "database": {
            "status": database_status,
            "latency_ms": round((time.perf_counter() - database_started) * 1000, 2),
            "source": "select_1",
            "simulated": False,
        },
        "supabase": configured("SUPABASE_DB_URL", "SUPABASE_SERVICE_ROLE_KEY"),
        "cloudflare": configured("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID"),
        "railway": configured("RAILWAY_API_TOKEN", "RAILWAY_PROJECT_ID"),
        "github": configured("GITHUB_TOKEN"),
        "mercado_pago": configured(
            "MERCADO_PAGO_CLIENT_ID",
            "MERCADO_PAGO_CLIENT_SECRET",
            "MERCADO_PAGO_WEBHOOK_SECRET",
        ),
        "telegram": configured("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"),
        "evolution": {
            "status": "configured_unverified",
            "details": obter_status_evolution(),
            "simulated": False,
        },
    }


# --- TELEGRAM BOT ALERTING ---
@router.post("/telegram/notify")
async def trigger_developer_alert(
    text: str = Body(..., embed=True),
    admin: dict = Depends(get_current_admin),
    telegram: TelegramService = Depends(TelegramService),
):
    try:
        pushed = await telegram.send_alert(f"🚨 <b>Alerta Manual:</b> {text}")
    except RuntimeError as exc:
        _unavailable(str(exc))
    return {"success": pushed}


# --- CREDENTIALS MANAGEMENT ---
@router.get("/credentials")
async def get_credentials(admin: dict = Depends(get_current_admin)):
    return {
        "mercado_pago": {
            "configured": bool(os.getenv("MERCADO_PAGO_CLIENT_ID"))
            and bool(os.getenv("MERCADO_PAGO_CLIENT_SECRET"))
            and bool(os.getenv("MERCADO_PAGO_WEBHOOK_SECRET"))
        },
        "cloudflare": {"configured": bool(os.getenv("CLOUDFLARE_API_TOKEN"))},
        "railway": {"configured": bool(os.getenv("RAILWAY_API_TOKEN"))},
        "github": {"configured": bool(os.getenv("GITHUB_TOKEN"))},
        "telegram": {
            "configured": bool(os.getenv("TELEGRAM_BOT_TOKEN"))
            and bool(os.getenv("TELEGRAM_CHAT_ID"))
        },
        "supabase": {
            "configured": bool(os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
        },
    }


@router.post("/credentials")
async def update_credentials(admin: dict = Depends(get_current_admin)):
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Armazenamento seguro de credenciais não configurado.",
    )


@router.post("/test-connection")
async def test_connection(
    payload: Dict[str, str] = Body(...),
    admin: dict = Depends(get_current_admin),
):
    service = payload.get("service", "").lower()
    if service == "cloudflare":
        cloudflare = CloudflareService()
        try:
            await cloudflare.list_dns_records()
        except RuntimeError as exc:
            _unavailable(str(exc))
        return {"success": True, "service": service, "source": "cloudflare_api"}
    if service == "github":
        token = os.getenv("GITHUB_TOKEN", "").strip()
        if not token:
            _unavailable("GitHub não configurado no servidor.")
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.github.com/user",
                headers={"Authorization": f"Bearer {token}"},
                timeout=10.0,
            )
        if response.status_code != 200:
            _unavailable(f"GitHub API respondeu HTTP {response.status_code}.")
        return {"success": True, "service": service, "source": "github_api"}
    _unavailable(
        f"Teste real de conexão para {service or 'serviço desconhecido'} não implementado.",
        not_implemented=True,
    )


# --- DATABASE EDITOR ---
@router.get("/db/tables")
async def list_db_tables(admin: dict = Depends(get_current_admin)):
    _unavailable(
        "Editor genérico de banco foi desativado até possuir fonte e auditoria reais.",
        not_implemented=True,
    )


@router.get("/db/audit-log")
async def get_db_audit_log(admin: dict = Depends(get_current_admin)):
    _unavailable("Auditoria simulada removida; fonte real não configurada.", not_implemented=True)


@router.post("/db/backup")
async def trigger_db_backup(admin: dict = Depends(get_current_admin)):
    _unavailable("Backup pelo painel não possui executor real configurado.", not_implemented=True)


@router.get("/db/{tableName}/schema")
async def get_table_schema(tableName: str, admin: dict = Depends(get_current_admin)):
    _unavailable("Schema simulado removido; introspecção real não configurada.", not_implemented=True)


@router.get("/db/{tableName}")
async def get_table_data(tableName: str, admin: dict = Depends(get_current_admin)):
    _unavailable(
        "Dados simulados removidos; leitura genérica de tabelas não configurada.",
        not_implemented=True,
    )


@router.post("/db/{tableName}")
async def insert_table_row(
    tableName: str,
    payload: Dict[str, Any] = Body(...),
    admin: dict = Depends(get_current_admin),
):
    _unavailable("Escrita genérica no banco desativada por segurança.", not_implemented=True)


@router.put("/db/{tableName}/{rowId}")
async def update_table_row(
    tableName: str,
    rowId: str,
    payload: Dict[str, Any] = Body(...),
    admin: dict = Depends(get_current_admin),
):
    _unavailable("Escrita genérica no banco desativada por segurança.", not_implemented=True)


@router.delete("/db/{tableName}/{rowId}")
async def delete_table_row(
    tableName: str,
    rowId: str,
    admin: dict = Depends(get_current_admin),
):
    _unavailable("Exclusão genérica no banco desativada por segurança.", not_implemented=True)


# --- WEBSOCKET CLIENTS MONITOR ---
@router.get("/websocket-clients")
async def get_websocket_clients(admin: dict = Depends(get_current_admin)):
    _unavailable(
        "Inventário detalhado de clientes WebSocket não está disponível.",
        not_implemented=True,
    )


@router.post("/websocket-clients/toggle")
async def toggle_websocket_client(
    payload: Dict[str, Any] = Body(...),
    admin: dict = Depends(get_current_admin),
):
    _unavailable("Controle de cliente WebSocket não possui executor real.", not_implemented=True)

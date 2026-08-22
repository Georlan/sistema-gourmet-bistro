import os
import time
import logging
import uuid
from datetime import datetime
from typing import Dict, Any, List, Optional

import jwt
import httpx
from fastapi import APIRouter, Depends, HTTPException, status, Header, Body, BackgroundTasks
from sqlalchemy import text
from pydantic import BaseModel

from ..config import settings
from ..database import engine
from ..security import create_access_token, verify_password
from .super_admin_services import (
    SupabaseService,
    CloudflareService,
    RailwayService,
    TelegramService,
    is_mock_allowed,
    logger
)
from ..services.whatsapp import obter_status_evolution

# --- ENVIRONMENT VARIABLES VALIDATION ---
sentry_auth_token = os.getenv("SENTRY_AUTH_TOKEN", "")
if sentry_auth_token and not sentry_auth_token.startswith("sntryu_"):
    raise ValueError("Variável de ambiente 'SENTRY_AUTH_TOKEN' deve começar com o prefixo 'sntryu_'.")

railway_service_id = os.getenv("RAILWAY_SERVICE_ID", "")
if railway_service_id:
    try:
        uuid.UUID(railway_service_id)
    except ValueError:
        raise ValueError("Variável de ambiente 'RAILWAY_SERVICE_ID' deve estar em formato UUID válido.")


router = APIRouter(
    prefix="/super-admin",
    tags=["SuperAdmin"]
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


def _simulated_rows(rows: list[dict], capability: str) -> list[dict]:
    if not is_mock_allowed():
        _unavailable(f"{capability}: fonte real não configurada.")
    return [
        {**row, "dataStatus": "simulated", "dataSource": "development_fixture"}
        for row in rows
    ]

# Fixtures visíveis somente em development/test e sempre marcadas como simuladas.
SIMULATED_TENANTS = [
    { "id": "ten_01a", "name": "Pizzaria Sol", "subdomain": "pizzaria-sol.koma.com", "plan": "Bistro", "phone": "+55 (11) 99999-1111", "status": "ACTIVE", "monthlyOrders": 1420, "monthlyBilling": 49550.0, "createdAt": "2026-01-15", "lastActivity": "2026-07-15 15:30", "printerStatus": "online", "failedWebhooksCount24h": 0, "healthStatus": "green" },
    { "id": "ten_02b", "name": "Koma Burgers", "subdomain": "burgers.koma.com", "plan": "Delivery", "phone": "+55 (11) 98888-2222", "status": "ACTIVE", "monthlyOrders": 2890, "monthlyBilling": 86700.0, "createdAt": "2026-02-10", "lastActivity": "2026-07-15 15:24", "printerStatus": "online", "failedWebhooksCount24h": 0, "healthStatus": "green" },
    { "id": "ten_03c", "name": "Hamburgueria Silva", "subdomain": "hamburgueria-silva.koma.com", "plan": "Pocket", "phone": "+55 (11) 97777-3333", "status": "ACTIVE", "monthlyOrders": 540, "monthlyBilling": 16200.0, "createdAt": "2026-03-24", "lastActivity": "2026-07-15 14:15", "printerStatus": "online", "failedWebhooksCount24h": 2, "healthStatus": "red" },
    { "id": "ten_04d", "name": "Sushi Premium Co.", "subdomain": "sushi-premium.koma.com", "plan": "Premium", "phone": "+55 (11) 96666-4444", "status": "SUSPENDED", "monthlyOrders": 1200, "monthlyBilling": 120000.0, "createdAt": "2026-04-01", "lastActivity": "2026-07-15 11:00", "printerStatus": "offline", "failedWebhooksCount24h": 1, "healthStatus": "yellow" }
]

# (credentialsStore removido conforme regra P0.1 - credenciais não devem ficar em memória global)

# --- SECURITY / MOCK JWT VALIDATION ---
class TokenRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str

def _get_superadmin_credentials() -> tuple[str, str]:
    username = os.getenv("SUPERADMIN_USERNAME")
    password_hash = os.getenv("SUPERADMIN_PASSWORD_HASH")
    if not username or not password_hash:
        raise RuntimeError("SUPERADMIN_USERNAME and SUPERADMIN_PASSWORD_HASH must be configured.")
    return username, password_hash

@router.post("/token", response_model=TokenResponse)
def login_for_access_token(payload: TokenRequest):
    """
    Verifies superadmin credentials and encodes a signed JWT token for session security.
    """
    try:
        expected_username, expected_password_hash = _get_superadmin_credentials()
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc)
        )

    if payload.username != expected_username or not verify_password(payload.password, expected_password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(
        subject=payload.username,
        restaurante_id=0,
        role="superadmin"
    )
    return {
        "access_token": access_token,
        "token_type": "bearer"
    }


def get_current_admin(authorization: str = Header(None)) -> Dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Valid authorization bearer token required."
        )

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Valid authorization bearer token required."
        )

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Valid authorization bearer token required."
        )

    if payload.get("role") != "superadmin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso restrito a superadministradores."
        )

    if payload.get("sub") is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Valid authorization bearer token required."
        )

    return {"user": payload.get("sub"), "role": payload.get("role")}


# --- TENANTS MANAGEMENT ---
@router.get("/restaurantes")
async def list_tenants(
    admin: dict = Depends(get_current_admin),
    supabase: SupabaseService = Depends(SupabaseService)
):
    return _simulated_rows(SIMULATED_TENANTS, "Restaurantes SuperAdmin")

class OnboardingRequest(BaseModel):
    name: str
    plan: str
    subdomain: str

@router.post("/restaurantes/onboarding")
async def trigger_onboarding(
    payload: OnboardingRequest,
    admin: dict = Depends(get_current_admin),
    supabase: SupabaseService = Depends(SupabaseService),
    cloudflare: CloudflareService = Depends(CloudflareService),
    telegram: TelegramService = Depends(TelegramService)
):
    if not is_mock_allowed():
        _unavailable(
            "Onboarding automático ainda não possui provisionamento real completo.",
            not_implemented=True,
        )
    try:
        slug = payload.name.lower().replace(" ", "-")
        db_res = await supabase.create_tenant_schema(slug, payload.plan)
        dns_res = await cloudflare.create_cname_record(payload.subdomain)
        
        telegram_text = f"🎉 <b>Novo cliente!</b> {payload.name} se cadastrou no plano <b>{payload.plan}</b>!"
        await telegram.send_alert(telegram_text)

        new_tenant = {
            "id": f"ten_{uuid.uuid4().hex[:4]}",
            "name": payload.name,
            "subdomain": payload.subdomain,
            "plan": payload.plan,
            "phone": "+55 (11) 99999-0000",
            "status": "ACTIVE",
            "monthlyOrders": 0,
            "monthlyBilling": 0.0,
            "createdAt": datetime.now().strftime("%Y-%m-%d"),
            "lastActivity": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "printerStatus": "online",
            "failedWebhooksCount24h": 0,
            "healthStatus": "green"
        }
        SIMULATED_TENANTS.insert(0, new_tenant)

        return {
            "success": True,
            "dataStatus": "simulated",
            "tenant_slug": slug,
            "database": db_res,
            "dns": dns_res,
            "alert_dispatched": True,
            "tenant": new_tenant
        }
    except Exception as e:
        logger.error(f"[ONBOARDING FAILED] {str(e)}")
        await telegram.send_alert(f"🚨 <b>Alerta Sentry:</b> Exceção crítica durante Onboarding de {payload.name}! Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Onboarding pipeline failed: {str(e)}")

class StatusUpdateRequest(BaseModel):
    status: str

@router.put("/restaurantes/{tenant_id}/status")
async def update_tenant_status(
    tenant_id: str,
    payload: StatusUpdateRequest,
    admin: dict = Depends(get_current_admin),
    telegram: TelegramService = Depends(TelegramService)
):
    if not is_mock_allowed():
        _unavailable(
            "Alteração real de status de tenant não configurada.",
            not_implemented=True,
        )
    for tenant in SIMULATED_TENANTS:
        if tenant["id"] == tenant_id:
            tenant["status"] = payload.status
            break
            
    if payload.status == "SUSPENDED":
        await telegram.send_alert(f"⚠️ <b>Alerta Financeiro:</b> Inquilino ID {tenant_id} foi <b>SUSPENSO</b> devido a inadimplência no pagamento Asaas.")
    else:
        await telegram.send_alert(f"🟢 <b>Status Financeiro:</b> Inquilino ID {tenant_id} re-ativado e liberado.")
        
    return {"success": True, "dataStatus": "simulated", "tenant_id": tenant_id, "status": payload.status}

@router.post("/restaurantes/{tenant_id}/flush-cache")
async def flush_tenant_cache(tenant_id: str, admin: dict = Depends(get_current_admin)):
    _unavailable("Flush de cache não possui executor real configurado.", not_implemented=True)


# --- DEVOPS & INFRASTRUCTURE ---
@router.get("/railway/telemetry")
async def fetch_devops_telemetry(
    admin: dict = Depends(get_current_admin),
    railway: RailwayService = Depends(RailwayService)
):
    try:
        return await railway.get_service_metrics()
    except RuntimeError as exc:
        _unavailable(str(exc))

@router.post("/railway/restart")
async def trigger_emergency_reboot(
    admin: dict = Depends(get_current_admin),
    railway: RailwayService = Depends(RailwayService),
    telegram: TelegramService = Depends(TelegramService)
):
    try:
        reboot_success = await railway.trigger_emergency_restart()
    except RuntimeError as exc:
        _unavailable(str(exc), not_implemented=True)
    if reboot_success:
        logger.critical("EMERGENCY SERVER RESTART ISSUED BY SUPERADMIN")
        await telegram.send_alert("🚨 <b>ALERTA CRÍTICO:</b> Reinicialização de Emergência do servidor central do SaaS disparada pelo SuperAdmin!")
        return {"success": True, "reboot_dispatched": True}
    raise HTTPException(status_code=500, detail="Reboot command failed on hosting layer.")

@router.get("/github/runs")
async def get_github_runs(admin: dict = Depends(get_current_admin)):
    token = os.getenv("GITHUB_TOKEN", "").strip()
    owner = os.getenv("GITHUB_OWNER", "Georlan").strip()
    repo = os.getenv("GITHUB_REPO", "sistema-gourmet-bistro").strip()
    if not token:
        _unavailable("GitHub não configurado no servidor.")
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
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
    _unavailable("Dispatch GitHub não possui workflow/ref explícitos configurados.", not_implemented=True)

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
    is_simulated = str(record.get("status") or "").startswith("MOCK_")
    return {
        "success": True,
        "record": record,
        "dataStatus": "simulated" if is_simulated else "real",
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
        "sentry": configured("SENTRY_DSN", "SENTRY_AUTH_TOKEN"),
        "telegram": configured("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"),
        "evolution": {"status": "configured_unverified", "details": obter_status_evolution(), "simulated": False},
    }


# --- WEBHOOK RESOLVER ---
@router.post("/webhooks/asaas/{webhook_id}/confirm")
async def force_confirm_payment(
    webhook_id: str,
    admin: dict = Depends(get_current_admin),
    telegram: TelegramService = Depends(TelegramService)
):
    _unavailable(
        "Confirmação forçada de webhook foi desativada até existir fonte real, assinatura e auditoria.",
        not_implemented=True,
    )


# --- TELEGRAM BOT ALERTING ---
@router.post("/telegram/notify")
async def trigger_developer_alert(
    text: str = Body(..., embed=True),
    admin: dict = Depends(get_current_admin),
    telegram: TelegramService = Depends(TelegramService)
):
    pushed = await telegram.send_alert(f"🚨 <b>Alerta Manual:</b> {text}")
    return {"success": pushed}


# --- CREDENTIALS MANAGEMENT ---
@router.get("/credentials")
async def get_credentials(admin: dict = Depends(get_current_admin)):
    return {
        "sentry": {"configured": bool(os.getenv("SENTRY_AUTH_TOKEN"))},
        "cloudflare": {"configured": bool(os.getenv("CLOUDFLARE_API_TOKEN"))},
        "railway": {"configured": bool(os.getenv("RAILWAY_API_TOKEN"))},
        "github": {"configured": bool(os.getenv("GITHUB_TOKEN"))},
        "telegram": {
            "configured": bool(os.getenv("TELEGRAM_BOT_TOKEN"))
            and bool(os.getenv("TELEGRAM_CHAT_ID"))
        },
        "supabase": {
            "configured": bool(os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
        }
    }

@router.post("/credentials")
async def update_credentials(admin: dict = Depends(get_current_admin)):
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Armazenamento seguro de credenciais não configurado."
    )

@router.post("/test-connection")
async def test_connection(payload: Dict[str, str] = Body(...), admin: dict = Depends(get_current_admin)):
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
    _unavailable("Editor genérico de banco foi desativado até possuir fonte e auditoria reais.", not_implemented=True)


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
    _unavailable("Dados simulados removidos; leitura genérica de tabelas não configurada.", not_implemented=True)

@router.post("/db/{tableName}")
async def insert_table_row(tableName: str, payload: Dict[str, Any] = Body(...), admin: dict = Depends(get_current_admin)):
    _unavailable("Escrita genérica no banco desativada por segurança.", not_implemented=True)

@router.put("/db/{tableName}/{rowId}")
async def update_table_row(tableName: str, rowId: str, payload: Dict[str, Any] = Body(...), admin: dict = Depends(get_current_admin)):
    _unavailable("Escrita genérica no banco desativada por segurança.", not_implemented=True)

@router.delete("/db/{tableName}/{rowId}")
async def delete_table_row(tableName: str, rowId: str, admin: dict = Depends(get_current_admin)):
    _unavailable("Exclusão genérica no banco desativada por segurança.", not_implemented=True)

# --- SENTRY SYSTEM LOGS ---
@router.get("/sentry/issues")
async def get_sentry_issues(admin: dict = Depends(get_current_admin)):
    _unavailable("Consulta real de issues do Sentry não configurada.", not_implemented=True)

@router.post("/sentry/issues/{issue_id}/resolve")
async def resolve_sentry_issue(issue_id: str, admin: dict = Depends(get_current_admin)):
    _unavailable("Resolução de issue Sentry não possui mutação real configurada.", not_implemented=True)


# --- WEBSOCKET CLIENTS MONITOR ---
@router.get("/websocket-clients")
async def get_websocket_clients(admin: dict = Depends(get_current_admin)):
    _unavailable("Inventário detalhado de clientes WebSocket não está disponível.", not_implemented=True)

@router.post("/websocket-clients/toggle")
async def toggle_websocket_client(payload: Dict[str, Any] = Body(...), admin: dict = Depends(get_current_admin)):
    _unavailable("Controle de cliente WebSocket não possui executor real.", not_implemented=True)

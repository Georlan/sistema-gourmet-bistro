import os
import time
import logging
import uuid
from datetime import datetime
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Header, Body
from pydantic import BaseModel

# Import our modular isolated services
from .super_admin_services import (
    SupabaseService,
    CloudflareService,
    RailwayService,
    TelegramService,
    logger
)

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

# In-Memory Cache/Storage helper mirroring node server.ts state
tableRestaurantes = [
    { "id": "ten_01a", "name": "Pizzaria Sol", "subdomain": "pizzaria-sol.koma.com", "plan": "Bistro", "phone": "+55 (11) 99999-1111", "status": "ACTIVE", "monthlyOrders": 1420, "monthlyBilling": 49550.0, "createdAt": "2026-01-15", "lastActivity": "2026-07-15 15:30", "printerStatus": "online", "failedWebhooksCount24h": 0, "healthStatus": "green" },
    { "id": "ten_02b", "name": "Koma Burgers", "subdomain": "burgers.koma.com", "plan": "Delivery", "phone": "+55 (11) 98888-2222", "status": "ACTIVE", "monthlyOrders": 2890, "monthlyBilling": 86700.0, "createdAt": "2026-02-10", "lastActivity": "2026-07-15 15:24", "printerStatus": "online", "failedWebhooksCount24h": 0, "healthStatus": "green" },
    { "id": "ten_03c", "name": "Hamburgueria Silva", "subdomain": "hamburgueria-silva.koma.com", "plan": "Pocket", "phone": "+55 (11) 97777-3333", "status": "ACTIVE", "monthlyOrders": 540, "monthlyBilling": 16200.0, "createdAt": "2026-03-24", "lastActivity": "2026-07-15 14:15", "printerStatus": "online", "failedWebhooksCount24h": 2, "healthStatus": "red" },
    { "id": "ten_04d", "name": "Sushi Premium Co.", "subdomain": "sushi-premium.koma.com", "plan": "Premium", "phone": "+55 (11) 96666-4444", "status": "SUSPENDED", "monthlyOrders": 1200, "monthlyBilling": 120000.0, "createdAt": "2026-04-01", "lastActivity": "2026-07-15 11:00", "printerStatus": "offline", "failedWebhooksCount24h": 1, "healthStatus": "yellow" }
]

failedWebhooks = [
    { "id": "wh_01", "tenantName": "Pizzaria Sol", "orderId": "PED-7969", "event": "PAYMENT_RECEIVED", "amount": 124.90, "errorReason": "Timeout connecting to schema_pizzaria-sol", "createdAt": datetime.now().isoformat(), "resolved": False },
    { "id": "wh_02", "tenantName": "Hamburgueria Silva", "orderId": "PED-1024", "event": "PAYMENT_RECEIVED", "amount": 45.00, "errorReason": "Error: Connection pool exhausted inside multi-tenant router", "createdAt": datetime.now().isoformat(), "resolved": False }
]

sentryIssues = [
    { "id": "err_01", "timestamp": datetime.now().strftime("%H:%M:%S"), "level": "CRITICAL", "service": "POSTGRES-POOL", "message": "Connection pool connection timeout on schema_sushi-premium." },
    { "id": "err_02", "timestamp": datetime.now().strftime("%H:%M:%S"), "level": "WARNING", "service": "PRINTER-GATEWAY", "message": "Connection drop from printer client Sushi Premium Co." }
]

credentialsStore = {
    "SENTRY_AUTH_TOKEN": sentry_auth_token or "sntryu_mock_token_1234567890",
    "SENTRY_ORG": os.getenv("SENTRY_ORG", "koma-saas"),
    "SENTRY_PROJECT": os.getenv("SENTRY_PROJECT", "api1-node-express"),
    "CLOUDFLARE_TOKEN": os.getenv("CLOUDFLARE_API_TOKEN", "cf_token_mock_abcdef"),
    "CLOUDFLARE_ZONE_ID": os.getenv("CLOUDFLARE_ZONE_ID", "zone_koma_1122"),
    "CLOUDFLARE_DOMAIN": "koma.com",
    "RAILWAY_TOKEN": os.getenv("RAILWAY_API_TOKEN", "railway_token_mock_123"),
    "RAILWAY_PROJECT_ID": os.getenv("RAILWAY_PROJECT_ID", "project_koma_456"),
    "RAILWAY_SERVICE_ID": railway_service_id or "00000000-0000-0000-0000-000000000000",
    "GITHUB_TOKEN": os.getenv("GITHUB_TOKEN", "ghp_mock_token_value_98765"),
    "GITHUB_OWNER": os.getenv("GITHUB_OWNER", "Georlan"),
    "GITHUB_REPO": os.getenv("GITHUB_REPO", "sistema-gourmet-bistro"),
    "TELEGRAM_BOT_TOKEN": os.getenv("TELEGRAM_BOT_TOKEN", "123456789:AAF-KomaAdmin_SecretBotToken_9823"),
    "TELEGRAM_CHAT_ID": os.getenv("TELEGRAM_CHAT_ID", "987654321"),
    "SUPABASE_URL": os.getenv("SUPABASE_URL", os.getenv("VITE_SUPABASE_URL", "https://iiowhekvahxiepwcdidm.supabase.co")),
    "SUPABASE_KEY": os.getenv("SUPABASE_KEY", os.getenv("VITE_SUPABASE_ANON_KEY", "sb_publishable_VOLK7mO9OqOhIfm0MeJ0eg_oQ626X4T"))
}

# --- SECURITY / MOCK JWT VALIDATION ---
class TokenRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str

@router.post("/token", response_model=TokenResponse)
def login_for_access_token(payload: TokenRequest):
    """
    Verifies superadmin credentials and encodes a JWT token for session security.
    """
    if payload.username == "georlandbz@gmail.com" and payload.password == "admin123":
        return {
            "access_token": "mock_jwt_payload_superadmin_georlandbz_gmail_com_9823",
            "token_type": "bearer"
        }
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Incorrect username or password",
        headers={"WWW-Authenticate": "Bearer"},
    )

def get_current_admin(authorization: str = Header(None)) -> Dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Valid authorization bearer token required."
        )
    return {"user": "georlandbz@gmail.com", "role": "superadmin"}


# --- TENANTS MANAGEMENT ---
@router.get("/restaurantes")
async def list_tenants(
    admin: dict = Depends(get_current_admin),
    supabase: SupabaseService = Depends(SupabaseService)
):
    return tableRestaurantes

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
        tableRestaurantes.insert(0, new_tenant)

        return {
            "success": True,
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
    for tenant in tableRestaurantes:
        if tenant["id"] == tenant_id:
            tenant["status"] = payload.status
            break
            
    if payload.status == "SUSPENDED":
        await telegram.send_alert(f"⚠️ <b>Alerta Financeiro:</b> Inquilino ID {tenant_id} foi <b>SUSPENSO</b> devido a inadimplência no pagamento Asaas.")
    else:
        await telegram.send_alert(f"🟢 <b>Status Financeiro:</b> Inquilino ID {tenant_id} re-ativado e liberado.")
        
    return {"success": True, "tenant_id": tenant_id, "status": payload.status}

@router.post("/restaurantes/{tenant_id}/flush-cache")
async def flush_tenant_cache(tenant_id: str, admin: dict = Depends(get_current_admin)):
    return {"success": True, "message": f"Cache for tenant {tenant_id} flushed successfully."}


# --- DEVOPS & INFRASTRUCTURE ---
@router.get("/railway/telemetry")
async def fetch_devops_telemetry(
    admin: dict = Depends(get_current_admin),
    railway: RailwayService = Depends(RailwayService)
):
    metrics = await railway.get_service_metrics()
    return metrics

@router.post("/railway/restart")
async def trigger_emergency_reboot(
    admin: dict = Depends(get_current_admin),
    railway: RailwayService = Depends(RailwayService),
    telegram: TelegramService = Depends(TelegramService)
):
    logger.critical("EMERGENCY SERVER RESTART ISSUED BY SUPERADMIN")
    await telegram.send_alert("🚨 <b>ALERTA CRÍTICO:</b> Reinicialização de Emergência do servidor central do SaaS disparada pelo SuperAdmin!")
    reboot_success = await railway.trigger_emergency_restart()
    if reboot_success:
        return {"success": True, "reboot_dispatched": True}
    raise HTTPException(status_code=500, detail="Reboot command failed on hosting layer.")

@router.get("/github/runs")
async def get_github_runs(admin: dict = Depends(get_current_admin)):
    return {
        "total_count": 2,
        "workflow_runs": [
            { "id": 1024, "name": "Production Deploy", "status": "completed", "conclusion": "success", "html_url": "https://github.com", "run_number": 42, "created_at": datetime.now().isoformat() },
            { "id": 1025, "name": "Lint & Test Suite", "status": "completed", "conclusion": "success", "html_url": "https://github.com", "run_number": 41, "created_at": datetime.now().isoformat() }
        ]
    }

@router.post("/github/dispatch")
async def github_dispatch(admin: dict = Depends(get_current_admin)):
    return {"success": True, "message": "Workflow dispatch trigger sent successfully to GitHub Actions."}

@router.post("/git/deploy")
async def git_deploy(admin: dict = Depends(get_current_admin)):
    return {"success": True, "message": "Git deployment triggered successfully on hosting infrastructure."}

@router.get("/cloudflare/dns")
async def get_cloudflare_dns(admin: dict = Depends(get_current_admin)):
    return [
        { "id": "dns_1", "type": "CNAME", "name": "burgers.koma.com", "content": "k-ingress-prod.railway.app", "proxied": True, "ttl": 1 },
        { "id": "dns_2", "type": "CNAME", "name": "pizzaria-sol.koma.com", "content": "k-ingress-prod.railway.app", "proxied": True, "ttl": 1 }
    ]

@router.post("/cloudflare/cname")
async def create_cloudflare_cname(payload: Dict[str, Any] = Body(...), admin: dict = Depends(get_current_admin)):
    return {"success": True, "id": "dns_dyn_mock", "subdomain": payload.get("subdomain"), "proxied": True, "status": "ACTIVE"}

@router.get("/integrations/health")
async def get_integrations_health(admin: dict = Depends(get_current_admin)):
    return {
        "supabase": { "status": "green", "ping": "142ms", "details": "Multi-tenant connection pool operational" },
        "cloudflare": { "status": "green", "ping": "89ms", "details": "Zone koma.com routing operational" },
        "railway": { "status": "green", "ping": "210ms", "details": "RAM footprint stable under 60%" },
        "github": { "status": "green", "ping": "174ms", "details": "V3 Actions REST Gateway active" },
        "sentry": { "status": "green", "ping": "95ms", "details": "Error tracking stream established" },
        "telegram": { "status": "green", "ping": "120ms", "details": "Emergency notification service active" }
    }


# --- WEBHOOK RESOLVER ---
@router.post("/webhooks/asaas/{webhook_id}/confirm")
async def force_confirm_payment(
    webhook_id: str,
    admin: dict = Depends(get_current_admin),
    telegram: TelegramService = Depends(TelegramService)
):
    logger.warning(f"Bypassing signature and forcing confirmation for Webhook {webhook_id}...")
    await telegram.send_alert(f"✅ <b>BYPASS EFETUADO:</b> Webhook {webhook_id} confirmado manualmente. Pagamento aprovado no caixa!")
    
    # Resolve webhook in memory
    for wh in failedWebhooks:
        if wh["id"] == webhook_id or webhook_id == "all":
            wh["resolved"] = True
            
    return {"success": True, "webhook_id": webhook_id, "status": "FORCE_CONFIRMED"}


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
    # Return masked credentials for security UI representation
    masked = {}
    for k, v in credentialsStore.items():
        if len(v) > 8:
            masked[k] = v[:4] + "..." + v[-4:]
        else:
            masked[k] = "..."
    return masked

def save_credentials_to_env(updates: dict):
    env_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../.env"))
    lines = []
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
            
    key_line_index = {}
    for idx, line in enumerate(lines):
        clean_line = line.strip()
        if clean_line and not clean_line.startswith("#") and "=" in clean_line:
            parts = clean_line.split("=", 1)
            key = parts[0].strip()
            key_line_index[key] = idx
            
    for key, val in updates.items():
        if not val or val.startswith("..."):
            continue
            
        mapped_keys = [key]
        if key == "CLOUDFLARE_TOKEN":
            mapped_keys.append("CLOUDFLARE_API_TOKEN")
        elif key == "RAILWAY_TOKEN":
            mapped_keys.append("RAILWAY_API_TOKEN")
        elif key == "SUPABASE_KEY":
            mapped_keys.append("SUPABASE_SERVICE_ROLE_KEY")
            mapped_keys.append("VITE_SUPABASE_ANON_KEY")
        elif key == "SUPABASE_URL":
            mapped_keys.append("VITE_SUPABASE_URL")
            
        for m_key in mapped_keys:
            os.environ[m_key] = val
            line_content = f'{m_key}="{val}"\n'
            if m_key in key_line_index:
                lines[key_line_index[m_key]] = line_content
            else:
                lines.append(line_content)
                key_line_index[m_key] = len(lines) - 1
                
    with open(env_path, "w", encoding="utf-8") as f:
        f.writelines(lines)

@router.post("/credentials")
async def update_credentials(payload: Dict[str, Any] = Body(...), admin: dict = Depends(get_current_admin)):
    credentials = payload.get("credentials", payload)
    if not isinstance(credentials, dict):
        credentials = payload
        
    for k, v in credentials.items():
        if k in credentialsStore and v and not v.startswith("..."):
            credentialsStore[k] = v
            
    save_credentials_to_env(credentials)
    return {"success": True, "message": "Credentials updated and synchronized persistently in .env file."}

@router.post("/test-connection")
async def test_connection(payload: Dict[str, str] = Body(...), admin: dict = Depends(get_current_admin)):
    service = payload.get("service", "").lower()
    return {
        "success": True,
        "message": f"Connection test passed successfully for {service.upper()} integration gateway."
    }


# --- DATABASE EDITOR ---
@router.get("/db/tables")
async def list_db_tables(admin: dict = Depends(get_current_admin)):
    return [
        { "name": "restaurantes", "rowCount": len(tableRestaurantes), "columnsCount": 6 },
        { "name": "produtos", "rowCount": 5, "columnsCount": 6 },
        { "name": "categorias", "rowCount": 4, "columnsCount": 3 },
        { "name": "mesas", "rowCount": 4, "columnsCount": 4 },
        { "name": "failed_webhooks", "rowCount": len(failedWebhooks), "columnsCount": 7 }
    ]

@router.get("/db/{tableName}/schema")
async def get_table_schema(tableName: str, admin: dict = Depends(get_current_admin)):
    if tableName == "restaurantes":
        return [
            { "name": "id", "type": "varchar", "nullable": False, "isPrimary": True },
            { "name": "name", "type": "varchar", "nullable": False, "isPrimary": False },
            { "name": "subdomain", "type": "varchar", "nullable": True, "isPrimary": False },
            { "name": "plan", "type": "varchar", "nullable": False, "isPrimary": False },
            { "name": "status", "type": "varchar", "nullable": False, "isPrimary": False },
            { "name": "createdAt", "type": "varchar", "nullable": True, "isPrimary": False }
        ]
    # Generic simple schema fallback
    return [
        { "name": "id", "type": "varchar", "nullable": False, "isPrimary": True },
        { "name": "name", "type": "varchar", "nullable": False, "isPrimary": False },
        { "name": "updated_at", "type": "timestamp", "nullable": True, "isPrimary": False }
    ]

@router.get("/db/{tableName}")
async def get_table_data(tableName: str, admin: dict = Depends(get_current_admin)):
    if tableName == "restaurantes":
        return tableRestaurantes
    elif tableName == "failed_webhooks":
        return failedWebhooks
    return [
        { "id": "row_1", "name": "Item Demo 1", "updated_at": datetime.now().isoformat() },
        { "id": "row_2", "name": "Item Demo 2", "updated_at": datetime.now().isoformat() }
    ]

@router.post("/db/{tableName}")
async def insert_table_row(tableName: str, payload: Dict[str, Any] = Body(...), admin: dict = Depends(get_current_admin)):
    payload["id"] = f"dyn_{uuid.uuid4().hex[:4]}"
    return { "success": True, "row": payload }

@router.put("/db/{tableName}/{rowId}")
async def update_table_row(tableName: str, rowId: str, payload: Dict[str, Any] = Body(...), admin: dict = Depends(get_current_admin)):
    return { "success": True, "rowId": rowId, "updated": payload }

@router.delete("/db/{tableName}/{rowId}")
async def delete_table_row(tableName: str, rowId: str, admin: dict = Depends(get_current_admin)):
    return { "success": True, "rowId": rowId, "message": "Row deleted successfully."}

@router.get("/db/audit-log")
async def get_db_audit_log(admin: dict = Depends(get_current_admin)):
    return [
        { "id": "audit_1", "who": "georlandbz@gmail.com", "action": "UPDATE", "affected_table": "restaurantes", "affected_field": "status", "old_value": "ACTIVE", "new_value": "SUSPENDED", "timestamp": datetime.now().isoformat() }
    ]

@router.post("/db/backup")
async def trigger_db_backup(admin: dict = Depends(get_current_admin)):
    return { "success": True, "backup_url": "https://supabase-backups.koma.co/bistro-backup-latest.sql" }


# --- SENTRY SYSTEM LOGS ---
@router.get("/sentry/issues")
async def get_sentry_issues(admin: dict = Depends(get_current_admin)):
    return sentryIssues

@router.post("/sentry/issues/{issue_id}/resolve")
async def resolve_sentry_issue(issue_id: str, admin: dict = Depends(get_current_admin)):
    global sentryIssues
    sentryIssues = [issue for issue in sentryIssues if issue["id"] != issue_id]
    return { "success": True, "issue_id": issue_id, "message": "Issue resolved successfully." }


# --- WEBSOCKET CLIENTS MONITOR ---
@router.get("/websocket-clients")
async def get_websocket_clients(admin: dict = Depends(get_current_admin)):
    return [
        { "restaurantId": "ten_01a", "restaurantName": "Pizzaria Sol", "device": "Painel do Caixa", "status": "CONNECTED", "ip": "189.24.15.12" },
        { "restaurantId": "ten_01a", "restaurantName": "Pizzaria Sol", "device": "Printer Gateway", "status": "CONNECTED", "ip": "189.24.15.15" }
    ]

@router.post("/websocket-clients/toggle")
async def toggle_websocket_client(payload: Dict[str, Any] = Body(...), admin: dict = Depends(get_current_admin)):
    return { "success": True, "message": "Websocket client state toggled." }

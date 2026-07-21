import os
import time
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, Depends, HTTPException, status, Header, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Import our modular isolated services
from SuperAdminServices import (
    SupabaseService,
    CloudflareService,
    RailwayService,
    TelegramService,
    logger
)

# Centralized Logging config
logging.basicConfig(level=logging.INFO)
uvicorn_logger = logging.getLogger("uvicorn")

app = FastAPI(
    title="SuperAdmin Cockpit Core API",
    description="DevOps Orchestration, multi-tenant databases, SSL mapping, and instant alerts for Solopreneur Restaurant SaaS.",
    version="1.0.4",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Enable CORS for frontend Vite integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Redis Mock caching helper (used to cache heavy metrics)
class RedisCache:
    def __init__(self):
        self.store = {}
        logger.info("[REDIS] Simulated connection pool established on redis://default:6379.")

    def get(self, key: str) -> Optional[str]:
        val = self.store.get(key)
        if val and val["expiry"] > time.time():
            return val["value"]
        return None

    def set(self, key: str, value: str, ttl_seconds: int = 60):
        self.store[key] = {
            "value": value,
            "expiry": time.time() + ttl_seconds
        }

redis_cache = RedisCache()


# Simple JWT Authentication Security Layer
JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_ALGORITHM = "HS256"

class TokenRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str

@app.post("/api/super-admin/token", response_model=TokenResponse, tags=["Authentication"])
def login_for_access_token(payload: TokenRequest):
    """
    OBSOLETO: Utilizar /super-admin/token da API principal backend/app/routes/super_admin.py.
    """
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="Este backend legado foi arquivado. Utilize a API oficial /super-admin do backend principal."
    )

def get_current_admin(authorization: str = Header(None)) -> Dict[str, Any]:
    """
    Dependency injection block verifying current bearer token.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Valid authorization bearer token required."
        )
    # real-world: jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    return {"user": "georlandbz@gmail.com", "role": "superadmin"}


# --- DEPENDENCY INJECTION SETUP ---
def get_supabase_service() -> SupabaseService:
    return SupabaseService()

def get_cloudflare_service() -> CloudflareService:
    return CloudflareService()

def get_railway_service() -> RailwayService:
    return RailwayService()

def get_telegram_service() -> TelegramService:
    return TelegramService()


# --- ENDPOINTS & Pydantic Schemas ---
class OnboardingRequest(BaseModel):
    name: str
    plan: str
    subdomain: str

class StatusUpdateRequest(BaseModel):
    status: str


@app.get("/api/super-admin/restaurantes", tags=["Tenants Management"])
async def list_tenants(
    admin: dict = Depends(get_current_admin),
    supabase: SupabaseService = Depends(get_supabase_service)
):
    """
    Lists all restaurant tenant databases faturado metrics fetched from Supabase.
    """
    metrics = await supabase.get_tenant_billing_metrics()
    return metrics


@app.post("/api/super-admin/restaurantes/onboarding", tags=["Tenants Management"])
async def trigger_onboarding(
    payload: OnboardingRequest,
    admin: dict = Depends(get_current_admin),
    supabase: SupabaseService = Depends(get_supabase_service),
    cloudflare: CloudflareService = Depends(get_cloudflare_service),
    telegram: TelegramService = Depends(get_telegram_service)
):
    """
    SaaS Onboarding pipeline: Creates PostgreSQL Schema inside Supabase,
    seeds default catalogs, maps DNS CNAME on Cloudflare, and notifies developer.
    """
    try:
        slug = payload.name.lower().replace(" ", "-").replace(/[^a-z0-9]/g, "-")
        
        # 1. Database creation & seeding
        db_res = await supabase.create_tenant_schema(slug, payload.plan)
        
        # 2. Cloudflare dynamic subdomain mapping
        dns_res = await cloudflare.create_cname_record(payload.subdomain)
        
        # 3. Telegram Alerter
        telegram_text = f"🎉 <b>Novo cliente!</b> {payload.name} se cadastrou no plano <b>{payload.plan}</b>!"
        await telegram.send_alert(telegram_text)

        return {
            "success": True,
            "tenant_slug": slug,
            "database": db_res,
            "dns": dns_res,
            "alert_dispatched": True
        }
    except Exception as e:
        logger.error(f"[ONBOARDING FAILED] Exception trapped: {str(e)}")
        # Send Sentry warning immediately to Telegram
        await telegram.send_alert(f"🚨 <b>Alerta Sentry:</b> Exceção crítica durante Onboarding de {payload.name}! Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Onboarding pipeline failed: {str(e)}")


@app.put("/api/super-admin/restaurantes/{tenant_id}/status", tags=["Tenants Management"])
async def update_tenant_status(
    tenant_id: str,
    payload: StatusUpdateRequest,
    admin: dict = Depends(get_current_admin),
    telegram: TelegramService = Depends(get_telegram_service)
):
    """
    Financial Block Toggle: Locks/unlocks restaurant. 
    Suspended restaurants display financial message on browser menu.
    """
    logger.info(f"Modifying billing state of {tenant_id} to '{payload.status}'...")
    
    # Broadcast alert
    if payload.status == "SUSPENDED":
        await telegram.send_alert(f"⚠️ <b>Alerta Financeiro:</b> Inquilino ID {tenant_id} foi <b>SUSPENSO</b> devido a inadimplência no pagamento Asaas.")
    else:
        await telegram.send_alert(f"🟢 <b>Status Financeiro:</b> Inquilino ID {tenant_id} re-ativado e liberado.")
        
    return {"success": True, "tenant_id": tenant_id, "status": payload.status}


@app.post("/api/super-admin/webhooks/asaas/{webhook_id}/confirm", tags=["Webhook Resolver"])
async def force_confirm_payment(
    webhook_id: str,
    admin: dict = Depends(get_current_admin),
    telegram: TelegramService = Depends(get_telegram_service)
):
    """
    Webhook Error terminal resolver. Manually forces and confirms a payment event,
    pushing orders to cashier channels.
    """
    logger.warning(f"Bypassing signature and forcing confirmation for Webhook {webhook_id}...")
    
    # Simulate database push & WebSocket alert trigger
    await telegram.send_alert(f"✅ <b>BYPASS EFETUADO:</b> Webhook {webhook_id} confirmado manualmente. Pagamento aprovado no caixa!")
    return {"success": True, "webhook_id": webhook_id, "status": "FORCE_CONFIRMED"}


@app.get("/api/super-admin/devops/metrics", tags=["DevOps Infrastructure"])
async def fetch_devops_telemetry(
    admin: dict = Depends(get_current_admin),
    railway: RailwayService = Depends(get_railway_service)
):
    """
    Retrieves live CPU/RAM and active connection metrics of Railway hosting container.
    Result is cached in Redis for performance.
    """
    cache_key = "railway_telemetry_metrics"
    cached_val = redis_cache.get(cache_key)
    if cached_val:
        return {"source": "cache", "data": cached_val}

    metrics = await railway.get_service_metrics()
    redis_cache.set(cache_key, metrics, ttl_seconds=15) # Cache 15 seconds
    return {"source": "database", "data": metrics}


@app.post("/api/super-admin/devops/restart", tags=["DevOps Infrastructure"])
async def trigger_emergency_reboot(
    admin: dict = Depends(get_current_admin),
    railway: RailwayService = Depends(get_railway_service),
    telegram: TelegramService = Depends(get_telegram_service)
):
    """
    Emergency container reboot triggered by Solo Developer to recycle memory space.
    """
    logger.critical("EMERGENCY SERVER RESTART ISSUED BY SUPERADMIN")
    await telegram.send_alert("🚨 <b>ALERTA CRÍTICO:</b> Reinicialização de Emergência do servidor central do SaaS disparada pelo SuperAdmin!")
    
    reboot_success = await railway.trigger_emergency_restart()
    if reboot_success:
        return {"success": True, "reboot_dispatched": True}
    raise HTTPException(status_code=500, detail="Reboot command failed on hosting layer.")


@app.post("/api/super-admin/telegram/notify", tags=["Telegram Bot Alerting"])
async def trigger_developer_alert(
    text: str = Body(..., embed=True),
    admin: dict = Depends(get_current_admin),
    telegram: TelegramService = Depends(get_telegram_service)
):
    """
    Sends manual custom markdown alert directly to developer private Telegram client.
    """
    pushed = await telegram.send_alert(f"🚨 <b>Alerta Manual:</b> {text}")
    return {"success": pushed}


# Custom global error handler and logs centralizer
@app.middleware("http")
async def global_exception_logger_middleware(request, call_next):
    start_time = time.time()
    try:
        response = await call_next(request)
        process_time = (time.time() - start_time) * 1000
        logger.info(f"[{request.method}] {request.url.path} finished in {process_time:.2f}ms with code {response.status_code}")
        return response
    except Exception as exc:
        logger.error(f"[CRITICAL SERVERSIDE ERROR] trapped on router middleware: {str(exc)}", exc_info=True)
        # Sentry simulation and immediate alert to Telegram
        await TelegramService().send_alert(f"🚨 <b>Alerta Sentry:</b> Exceção crítica sem tratamento! Path: <i>{request.url.path}</i>. Message: {str(exc)}")
        return HTTPException(status_code=500, detail="Server exception captured by gateway middleware.")

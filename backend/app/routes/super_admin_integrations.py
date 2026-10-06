"""
Rotas do SuperAdmin para o Integration Registry e Control Plane Linear / PostHog.
Atende aos requisitos de KOM-8, KOM-9 e KOM-10.
"""
import asyncio
import datetime
import logging
import os
import time
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from ..database import SessionLocal, tenant_session_scope
from ..models import ExternalIssueLink, Restaurante, SuperAdminAuditLog
from .super_admin import get_current_admin
from ..integrations.linear_client import LinearClient
from ..integrations.posthog_client import PostHogClient
from ..integrations.sanitizer import sanitize_text

logger = logging.getLogger("SuperAdminIntegrations")

router = APIRouter(tags=["SuperAdmin - Integrations"])

linear_client = LinearClient()
posthog_client = PostHogClient()


class CreateIssueRequest(BaseModel):
    title: str = Field(..., min_length=3, max_length=200, description="Título conciso da tarefa ou problema")
    description: str = Field(..., min_length=5, max_length=4000, description="Descrição do comportamento ou contexto")
    type: str = Field(default="Bug", description="Tipo de issue: Bug, Feature, Improvement, Tech Debt, Ops")
    area: Optional[str] = Field(default=None, description="Área do produto (ex: Cardápio, Caixa, Pagamentos, Delivery, Fiscal, Impressão)")
    priority: int = Field(default=3, ge=0, le=4, description="Prioridade Linear: 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low")
    posthog_evidence_url: Optional[str] = Field(default=None, description="Link opcional de evidência no PostHog")


# --- PROBES DE SAÚDE ---

async def _probe_github() -> Dict[str, Any]:
    token = (os.getenv("GITHUB_TOKEN") or os.getenv("GH_TOKEN") or "").strip()
    repo = (os.getenv("GITHUB_REPOSITORY") or "Georlan/sistema-gourmet-bistro").strip()
    console_url = f"https://github.com/{repo}"
    start_time = time.perf_counter()

    if not token:
        # Repositório público ou sem token administrativo
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                resp = await client.get(f"https://api.github.com/repos/{repo}", headers={"User-Agent": "Koma-SuperAdmin"})
            elapsed = round((time.perf_counter() - start_time) * 1000, 2)
            if resp.status_code in (200, 301, 302):
                return {
                    "id": "github",
                    "name": "GitHub",
                    "category": "code_ci",
                    "purpose": "Repositório de código-fonte, CI/CD e governança de PRs",
                    "status": "connected",
                    "configured": True,
                    "latency_ms": elapsed,
                    "last_checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "console_url": console_url,
                    "detail": f"Repositório '{repo}' acessível.",
                }
            return {
                "id": "github",
                "name": "GitHub",
                "category": "code_ci",
                "purpose": "Repositório de código-fonte, CI/CD e governança de PRs",
                "status": "warning",
                "configured": True,
                "latency_ms": elapsed,
                "last_checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "console_url": console_url,
                "detail": f"Status HTTP {resp.status_code} na API pública.",
            }
        except Exception as exc:
            return {
                "id": "github",
                "name": "GitHub",
                "category": "code_ci",
                "purpose": "Repositório de código-fonte, CI/CD e governança de PRs",
                "status": "disconnected",
                "configured": False,
                "latency_ms": round((time.perf_counter() - start_time) * 1000, 2),
                "last_checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "console_url": console_url,
                "detail": f"Falha de probe: {exc}",
            }

    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(
                f"https://api.github.com/repos/{repo}",
                headers={"Authorization": f"Bearer {token}", "User-Agent": "Koma-SuperAdmin"},
            )
        elapsed = round((time.perf_counter() - start_time) * 1000, 2)
        if resp.status_code == 200:
            return {
                "id": "github",
                "name": "GitHub",
                "category": "code_ci",
                "purpose": "Repositório de código-fonte, CI/CD e governança de PRs",
                "status": "connected",
                "configured": True,
                "latency_ms": elapsed,
                "last_checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "console_url": console_url,
                "detail": f"Autenticado no repositório '{repo}'.",
            }
        return {
            "id": "github",
            "name": "GitHub",
            "category": "code_ci",
            "purpose": "Repositório de código-fonte, CI/CD e governança de PRs",
            "status": "warning",
            "configured": True,
            "latency_ms": elapsed,
            "last_checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "console_url": console_url,
            "detail": f"GitHub API retornou HTTP {resp.status_code}.",
        }
    except Exception as exc:
        return {
            "id": "github",
            "name": "GitHub",
            "category": "code_ci",
            "purpose": "Repositório de código-fonte, CI/CD e governança de PRs",
            "status": "disconnected",
            "configured": True,
            "latency_ms": round((time.perf_counter() - start_time) * 1000, 2),
            "last_checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "console_url": console_url,
            "detail": f"Falha ao conectar com GitHub: {exc}",
        }


async def _probe_railway() -> Dict[str, Any]:
    api_token = (os.getenv("RAILWAY_API_TOKEN") or "").strip()
    project_id = (os.getenv("RAILWAY_PROJECT_ID") or "").strip()
    console_url = f"https://railway.com/project/{project_id}" if project_id else "https://railway.com/dashboard"
    start_time = time.perf_counter()

    if not api_token or not project_id:
        return {
            "id": "railway",
            "name": "Railway",
            "category": "runtime_infra",
            "purpose": "Hospedagem de infraestrutura, contêiner backend e PostgreSQL",
            "status": "not_configured",
            "configured": False,
            "latency_ms": None,
            "last_checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "console_url": console_url,
            "detail": "Credenciais administrativas da Railway não configuradas.",
        }

    query = """query { me { id name } }"""
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.post(
                "https://backboard.railway.app/graphql/v2",
                json={"query": query},
                headers={"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"},
            )
        elapsed = round((time.perf_counter() - start_time) * 1000, 2)
        if resp.status_code == 200 and "data" in resp.json():
            return {
                "id": "railway",
                "name": "Railway",
                "category": "runtime_infra",
                "purpose": "Hospedagem de infraestrutura, contêiner backend e PostgreSQL",
                "status": "connected",
                "configured": True,
                "latency_ms": elapsed,
                "last_checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "console_url": console_url,
                "detail": f"Projeto {project_id[:8]}... conectado.",
            }
        return {
            "id": "railway",
            "name": "Railway",
            "category": "runtime_infra",
            "purpose": "Hospedagem de infraestrutura, contêiner backend e PostgreSQL",
            "status": "warning",
            "configured": True,
            "latency_ms": elapsed,
            "last_checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "console_url": console_url,
            "detail": f"Railway API retornou HTTP {resp.status_code}.",
        }
    except Exception as exc:
        return {
            "id": "railway",
            "name": "Railway",
            "category": "runtime_infra",
            "purpose": "Hospedagem de infraestrutura, contêiner backend e PostgreSQL",
            "status": "disconnected",
            "configured": True,
            "latency_ms": round((time.perf_counter() - start_time) * 1000, 2),
            "last_checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "console_url": console_url,
            "detail": f"Falha na API da Railway: {exc}",
        }


async def _probe_cloudflare() -> Dict[str, Any]:
    api_token = (os.getenv("CLOUDFLARE_API_TOKEN") or "").strip()
    zone_id = (os.getenv("CLOUDFLARE_ZONE_ID") or "").strip()
    console_url = f"https://dash.cloudflare.com/{zone_id}" if zone_id else "https://dash.cloudflare.com"
    start_time = time.perf_counter()

    if not api_token or not zone_id:
        return {
            "id": "cloudflare",
            "name": "Cloudflare",
            "category": "edge_dns",
            "purpose": "Roteamento de borda, CNAMEs de restaurantes e proteção SSL/DDoS",
            "status": "not_configured",
            "configured": False,
            "latency_ms": None,
            "last_checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "console_url": console_url,
            "detail": "CLOUDFLARE_API_TOKEN ou ZONE_ID não configurados.",
        }

    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(
                f"https://api.cloudflare.com/client/v4/zones/{zone_id}",
                headers={"Authorization": f"Bearer {api_token}"},
            )
        elapsed = round((time.perf_counter() - start_time) * 1000, 2)
        if resp.status_code == 200:
            return {
                "id": "cloudflare",
                "name": "Cloudflare",
                "category": "edge_dns",
                "purpose": "Roteamento de borda, CNAMEs de restaurantes e proteção SSL/DDoS",
                "status": "connected",
                "configured": True,
                "latency_ms": elapsed,
                "last_checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "console_url": console_url,
                "detail": "Zona Cloudflare verificada e ativa.",
            }
        return {
            "id": "cloudflare",
            "name": "Cloudflare",
            "category": "edge_dns",
            "purpose": "Roteamento de borda, CNAMEs de restaurantes e proteção SSL/DDoS",
            "status": "warning",
            "configured": True,
            "latency_ms": elapsed,
            "last_checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "console_url": console_url,
            "detail": f"Cloudflare API retornou status HTTP {resp.status_code}.",
        }
    except Exception as exc:
        return {
            "id": "cloudflare",
            "name": "Cloudflare",
            "category": "edge_dns",
            "purpose": "Roteamento de borda, CNAMEs de restaurantes e proteção SSL/DDoS",
            "status": "disconnected",
            "configured": True,
            "latency_ms": round((time.perf_counter() - start_time) * 1000, 2),
            "last_checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "console_url": console_url,
            "detail": f"Falha de conexão com Cloudflare: {exc}",
        }


async def _probe_resend() -> Dict[str, Any]:
    api_key = (os.getenv("RESEND_API_KEY") or "").strip()
    console_url = "https://resend.com/emails"
    start_time = time.perf_counter()

    if not api_key:
        return {
            "id": "resend",
            "name": "Resend",
            "category": "transactional_email",
            "purpose": "Envio transacional de convites de equipe e recibos de pagamento",
            "status": "not_configured",
            "configured": False,
            "latency_ms": None,
            "last_checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "console_url": console_url,
            "detail": "RESEND_API_KEY não configurada no servidor.",
        }

    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(
                "https://api.resend.com/api-keys",
                headers={"Authorization": f"Bearer {api_key}"},
            )
        elapsed = round((time.perf_counter() - start_time) * 1000, 2)
        if resp.status_code in (200, 201):
            return {
                "id": "resend",
                "name": "Resend",
                "category": "transactional_email",
                "purpose": "Envio transacional de convites de equipe e recibos de pagamento",
                "status": "connected",
                "configured": True,
                "latency_ms": elapsed,
                "last_checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "console_url": console_url,
                "detail": "Serviço de e-mails transacionais operacional.",
            }
        return {
            "id": "resend",
            "name": "Resend",
            "category": "transactional_email",
            "purpose": "Envio transacional de convites de equipe e recibos de pagamento",
            "status": "warning",
            "configured": True,
            "latency_ms": elapsed,
            "last_checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "console_url": console_url,
            "detail": f"Resend retornou HTTP {resp.status_code}.",
        }
    except Exception as exc:
        return {
            "id": "resend",
            "name": "Resend",
            "category": "transactional_email",
            "purpose": "Envio transacional de convites de equipe e recibos de pagamento",
            "status": "disconnected",
            "configured": True,
            "latency_ms": round((time.perf_counter() - start_time) * 1000, 2),
            "last_checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "console_url": console_url,
            "detail": f"Falha de conexão com Resend: {exc}",
        }


# --- ENDPOINTS DO REGISTRY & ISSUES ---

@router.get("/integrations/registry")
async def get_integration_registry(admin: dict = Depends(get_current_admin)):
    """
    KOM-8: Painel unificado de status das integrações no SuperAdmin.
    Executa testes assíncronos protegidos por timeout e expõe links diretos sem segredos.
    """
    # Probes assíncronos paralelos
    linear_task = linear_client.check_health()
    posthog_task = posthog_client.check_health()
    github_task = _probe_github()
    railway_task = _probe_railway()
    cf_task = _probe_cloudflare()
    resend_task = _probe_resend()

    linear_health, posthog_health, github_info, railway_info, cf_info, resend_info = await asyncio.gather(
        linear_task,
        posthog_task,
        github_task,
        railway_task,
        cf_task,
        resend_task,
        return_exceptions=True,
    )

    # Normalizar resultados caso alguma task tenha lançado exceção inesperada
    linear_entry = {
        "id": "linear",
        "name": "Linear",
        "category": "control_plane",
        "purpose": "Control Plane de engenharia, backlog, estados de trabalho e rastreabilidade",
        "status": linear_health.get("status", "disconnected") if isinstance(linear_health, dict) else "disconnected",
        "configured": linear_health.get("configured", False) if isinstance(linear_health, dict) else False,
        "latency_ms": linear_health.get("latency_ms") if isinstance(linear_health, dict) else None,
        "last_checked_at": linear_health.get("checked_at") if isinstance(linear_health, dict) else time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "console_url": "https://linear.app/komafood",
        "detail": linear_health.get("detail", "Falha de execução") if isinstance(linear_health, dict) else str(linear_health),
    }

    posthog_entry = {
        "id": "posthog",
        "name": "PostHog",
        "category": "product_analytics",
        "purpose": "Product analytics, conversão do cardápio público, sessões e observabilidade",
        "status": posthog_health.get("status", "disconnected") if isinstance(posthog_health, dict) else "disconnected",
        "configured": posthog_health.get("configured", False) if isinstance(posthog_health, dict) else False,
        "latency_ms": posthog_health.get("latency_ms") if isinstance(posthog_health, dict) else None,
        "last_checked_at": posthog_health.get("checked_at") if isinstance(posthog_health, dict) else time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "console_url": posthog_client.get_dashboard_url(),
        "detail": posthog_health.get("detail", "Falha de execução") if isinstance(posthog_health, dict) else str(posthog_health),
    }

    services = [
        linear_entry,
        posthog_entry,
        github_info if isinstance(github_info, dict) else {"id": "github", "name": "GitHub", "status": "disconnected", "detail": str(github_info)},
        railway_info if isinstance(railway_info, dict) else {"id": "railway", "name": "Railway", "status": "disconnected", "detail": str(railway_info)},
        cf_info if isinstance(cf_info, dict) else {"id": "cloudflare", "name": "Cloudflare", "status": "disconnected", "detail": str(cf_info)},
        resend_info if isinstance(resend_info, dict) else {"id": "resend", "name": "Resend", "status": "disconnected", "detail": str(resend_info)},
    ]

    return {
        "services": services,
        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


@router.get("/restaurantes/{restaurant_id}/issues")
async def list_restaurant_issues(
    restaurant_id: int,
    refresh_live: bool = Query(default=False, description="Tenta sincronizar o estado mais recente do Linear"),
    admin: dict = Depends(get_current_admin),
):
    """
    KOM-10: Retorna a lista de issues associadas a este restaurante específico.
    """
    with SessionLocal() as db:
        restaurante = db.query(Restaurante).filter(Restaurante.id == restaurant_id).first()
        if not restaurante:
            raise HTTPException(status_code=404, detail="Restaurante não encontrado.")

        with tenant_session_scope(db, restaurant_id):
            links = (
                db.query(ExternalIssueLink)
                .filter(ExternalIssueLink.restaurante_id == restaurant_id)
                .order_by(ExternalIssueLink.created_at.desc())
                .all()
            )

        results = []
        for link in links:
            current_status = link.status_snapshot
            if refresh_live and linear_client.is_configured:
                live = await linear_client.get_issue_status(link.external_identifier)
                if live and live.get("status"):
                    current_status = live["status"]
                    link.status_snapshot = current_status
                    db.add(link)

            results.append({
                "id": link.id,
                "provider": link.provider,
                "external_issue_id": link.external_issue_id,
                "external_identifier": link.external_identifier,
                "external_url": link.external_url,
                "title": link.title_snapshot,
                "status": current_status or "Backlog",
                "priority": link.priority_snapshot or "Normal",
                "actor": link.actor,
                "created_at": link.created_at.isoformat() if link.created_at else None,
            })

        if refresh_live:
            db.commit()

        return results


@router.post("/restaurantes/{restaurant_id}/issues", status_code=status.HTTP_201_CREATED)
async def create_restaurant_issue(
    restaurant_id: int,
    payload: CreateIssueRequest,
    admin: dict = Depends(get_current_admin),
):
    """
    KOM-9: Criação de issue no Linear server-side com sanitização de PII e rastreabilidade bidirecional.
    """
    with SessionLocal() as db:
        restaurante = db.query(Restaurante).filter(Restaurante.id == restaurant_id).first()
        if not restaurante:
            raise HTTPException(status_code=404, detail="Restaurante não encontrado.")
        restaurante_nome = restaurante.nome

    if not linear_client.is_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Integração Linear não configurada no servidor (LINEAR_API_KEY ausente).",
        )

    # 1. Sanitização rigorosa contra vazamento de PII
    clean_title = sanitize_text(payload.title.strip())
    clean_description = sanitize_text(payload.description.strip())

    # Formatar corpo da issue com contexto operacional explícito
    labels = ["SuperAdmin"]
    if payload.type:
        labels.append(payload.type.strip())
    if payload.area:
        labels.append(payload.area.strip())

    description_parts = [
        f"### Contexto Operacional",
        f"- **Restaurante:** {restaurante_nome} (Tenant ID: `{restaurant_id}`)",
        f"- **Área:** {payload.area or 'Geral'}",
        f"- **Origem:** KÔMA SuperAdmin Cockpit",
        f"- **Operador:** `{admin.get('user', 'superadmin')}`",
        f"",
        f"### Descrição",
        clean_description,
    ]

    if payload.posthog_evidence_url:
        clean_evidence = sanitize_text(payload.posthog_evidence_url.strip())
        description_parts.extend([
            f"",
            f"### Evidência / PostHog",
            f"[Visualizar evidência no PostHog]({clean_evidence})",
        ])

    description_parts.extend([
        f"",
        f"---",
        f"*Registrado via KÔMA SuperAdmin em {datetime.datetime.now(datetime.timezone.utc).strftime('%d/%m/%Y %H:%M:%S UTC')}*",
    ])

    final_description = "\n".join(description_parts)
    prefix_title = f"[{restaurante_nome}] {clean_title}"

    # 2. Despacho seguro para a API do Linear
    try:
        linear_res = await linear_client.create_issue(
            title=prefix_title,
            description=final_description,
            team_key="KOM",
            priority=payload.priority,
            labels=labels,
        )
    except Exception as exc:
        logger.error(f"Erro ao criar issue no Linear: {exc}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Falha na comunicação com o Linear: {exc}",
        )

    # 3. Persistência de rastreabilidade no banco do KÔMA
    with SessionLocal() as db:
        with tenant_session_scope(db, restaurant_id):
            issue_link = ExternalIssueLink(
                restaurante_id=restaurant_id,
                provider="linear",
                external_issue_id=str(linear_res.get("id") or ""),
                external_identifier=str(linear_res.get("identifier") or ""),
                external_url=str(linear_res.get("url") or ""),
                title_snapshot=clean_title,
                status_snapshot=linear_res.get("status") or "Todo",
                priority_snapshot=str(linear_res.get("priority") or payload.priority),
                actor=admin.get("user", "superadmin"),
            )
            db.add(issue_link)

            # Trilha de auditoria no KÔMA
            audit_log = SuperAdminAuditLog(
                restaurante_id=restaurant_id,
                actor=admin.get("user", "superadmin"),
                action="linear_issue_created",
                reason=f"Criação de issue {linear_res.get('identifier')} via cockpit SuperAdmin",
                before_data=None,
                after_data={
                    "external_identifier": linear_res.get("identifier"),
                    "external_url": linear_res.get("url"),
                    "title": clean_title,
                    "type": payload.type,
                    "area": payload.area,
                },
            )
            db.add(audit_log)
            db.commit()

    return {
        "success": True,
        "issue": {
            "id": linear_res.get("id"),
            "identifier": linear_res.get("identifier"),
            "title": clean_title,
            "url": linear_res.get("url"),
            "status": linear_res.get("status"),
        },
    }


@router.get("/restaurantes/{restaurant_id}/analytics")
async def get_restaurant_analytics_links(
    restaurant_id: int,
    admin: dict = Depends(get_current_admin),
):
    """
    KOM-10: Retorna deep links seguros de observabilidade no PostHog para este tenant.
    """
    with SessionLocal() as db:
        restaurante = db.query(Restaurante).filter(Restaurante.id == restaurant_id).first()
        if not restaurante:
            raise HTTPException(status_code=404, detail="Restaurante não encontrado.")

    return {
        "posthog": {
            "operational_dashboard_url": posthog_client.get_dashboard_url(),
            "tenant_group_url": posthog_client.get_tenant_group_url(restaurant_id),
            "events_url": posthog_client.get_events_url(restaurant_id),
            "project_id": posthog_client.project_id,
        }
    }

"""
Cliente e gerador de links para PostHog (Product Analytics & Observabilidade KÔMA).
Fornece health check e URLs profundas (deep links) para o SuperAdmin sem expor tokens.
"""
import logging
import os
import time
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger("PostHogClient")

POSTHOG_DEFAULT_PROJECT_ID = "648305"
POSTHOG_OPERATIONAL_DASHBOARD_ID = "2178362"
POSTHOG_US_APP_URL = "https://us.posthog.com"
POSTHOG_US_API_HOST = "https://us.i.posthog.com"


class PostHogClient:
    def __init__(
        self,
        project_id: Optional[str] = None,
        api_key: Optional[str] = None,
        project_token: Optional[str] = None,
        app_url: Optional[str] = None,
    ):
        self.project_id = (project_id or os.getenv("POSTHOG_PROJECT_ID") or POSTHOG_DEFAULT_PROJECT_ID).strip()
        self.api_key = (api_key or os.getenv("POSTHOG_API_KEY") or "").strip()
        self.project_token = (project_token or os.getenv("POSTHOG_PROJECT_TOKEN") or "").strip()
        self.app_url = (app_url or os.getenv("POSTHOG_APP_URL") or POSTHOG_US_APP_URL).strip().rstrip("/")

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key or self.project_token or self.project_id)

    def get_dashboard_url(self, dashboard_id: str = POSTHOG_OPERATIONAL_DASHBOARD_ID) -> str:
        """Gera URL direta para o Dashboard de Visão Diária do Produto."""
        return f"{self.app_url}/project/{self.project_id}/dashboard/{dashboard_id}"

    def get_events_url(self) -> str:
        """Gera deep link oficial para a lista de eventos brutos."""
        return f"{self.app_url}/project/{self.project_id}/events"

    async def check_health(self) -> Dict[str, Any]:
        """
        Executa probe de conectividade para o PostHog.
        Não expõe segredos.
        """
        start_time = time.perf_counter()

        # Se tiver API key pessoal/serviço, consulta os metadados do projeto
        if self.api_key:
            headers = {"Authorization": f"Bearer {self.api_key}"}
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    resp = await client.get(
                        f"{self.app_url}/api/projects/{self.project_id}/",
                        headers=headers,
                    )
                elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
                if resp.status_code == 200:
                    data = resp.json()
                    proj_name = data.get("name", "KÔMA Production")
                    return {
                        "status": "connected",
                        "configured": True,
                        "latency_ms": elapsed_ms,
                        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "detail": f"Projeto '{proj_name}' (ID {self.project_id}) conectado.",
                    }
                else:
                    return {
                        "status": "degraded",
                        "configured": True,
                        "latency_ms": elapsed_ms,
                        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "detail": f"PostHog API retornou HTTP {resp.status_code}.",
                    }
            except Exception as exc:
                return {
                    "status": "disconnected",
                    "configured": True,
                    "latency_ms": round((time.perf_counter() - start_time) * 1000, 2),
                    "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "detail": f"Falha ao conectar com API do PostHog: {exc}",
                }

        # Se tiver ao menos o project_token ou project_id configurado, testa probe HTTP no host de ingestão
        token = self.project_token
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{POSTHOG_US_API_HOST}/decide/?v=3", params={"token": token} if token else {})
            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
            if resp.status_code in (200, 400):  # 200 ou 400 confirma que o host está respondendo normalmente
                return {
                    "status": "connected",
                    "configured": True,
                    "latency_ms": elapsed_ms,
                    "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "detail": f"PostHog Cloud US operacional (Projeto {self.project_id}).",
                }
            return {
                "status": "degraded",
                "configured": True,
                "latency_ms": elapsed_ms,
                "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "detail": f"Ingestão PostHog retornou status {resp.status_code}.",
            }
        except Exception as exc:
            return {
                "status": "disconnected",
                "configured": True,
                "latency_ms": round((time.perf_counter() - start_time) * 1000, 2),
                "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "detail": f"Host PostHog inacessível: {exc}",
            }

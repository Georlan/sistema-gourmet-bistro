import os
import logging
import httpx
from typing import Any, Dict, List

# Central Logging Configuration
logger = logging.getLogger("SuperAdminOrchestrator")
logger.setLevel(logging.INFO)

class CloudflareService:
    """
    Automates dynamic CNAME domain routing.
    """
    def __init__(self, api_token: str = None, zone_id: str = None):
        self.api_token = api_token or os.getenv("CLOUDFLARE_API_TOKEN", "")
        self.zone_id = zone_id or os.getenv("CLOUDFLARE_ZONE_ID", "")
        self.base_url = f"https://api.cloudflare.com/client/v4/zones/{self.zone_id}/dns_records" if self.zone_id else ""

    async def create_cname_record(self, subdomain: str, target: str = "k-ingress-prod.railway.app") -> Dict[str, Any]:
        if not self.api_token or not self.zone_id:
            raise RuntimeError(
                "CloudflareService: CLOUDFLARE_API_TOKEN ou "
                "CLOUDFLARE_ZONE_ID não configurados."
            )

        headers = {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "type": "CNAME",
            "name": subdomain,
            "content": target,
            "ttl": 1,
            "proxied": True
        }

        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(self.base_url, json=payload, headers=headers, timeout=10.0)
                if response.status_code in (200, 201):
                    data = response.json()
                    logger.info("Registro DNS confirmado pela Cloudflare.")
                    return data.get("result", {})
                else:
                    logger.error("Cloudflare API falhou com HTTP %s.", response.status_code)
                    raise RuntimeError(
                        f"Cloudflare DNS creation failed with status {response.status_code}"
                    )
            except RuntimeError:
                raise
            except Exception as exc:
                logger.error("Exceção na conexão com Cloudflare")
                raise RuntimeError(
                    f"Cloudflare indisponível ({type(exc).__name__})."
                ) from None

    async def list_dns_records(self) -> List[Dict[str, Any]]:
        if not self.api_token or not self.zone_id:
            raise RuntimeError("Cloudflare não configurado no servidor.")
        headers = {"Authorization": f"Bearer {self.api_token}"}
        async with httpx.AsyncClient() as client:
            response = await client.get(self.base_url, headers=headers, timeout=10.0)
        if response.status_code != 200:
            raise RuntimeError(f"Cloudflare API respondeu HTTP {response.status_code}.")
        payload = response.json()
        if not payload.get("success"):
            raise RuntimeError("Cloudflare API não confirmou a consulta.")
        return payload.get("result", [])


class RailwayService:
    """
    Monitors host container resource usage and executes container management.
    """
    def __init__(self, api_token: str = None, project_id: str = None):
        self.api_token = api_token or os.getenv("RAILWAY_API_TOKEN", "")
        self.project_id = project_id or os.getenv("RAILWAY_PROJECT_ID", "")

    async def get_service_metrics(self) -> Dict[str, Any]:
        if not self.api_token or not self.project_id:
            raise RuntimeError("Railway não configurado no servidor.")
        raise RuntimeError(
            "Coleta de métricas Railway ainda não possui consulta real implementada."
        )

    async def trigger_emergency_restart(self) -> bool:
        if not self.api_token or not self.project_id:
            raise RuntimeError("Railway não configurado no servidor.")
        raise RuntimeError(
            "Restart Railway ainda não possui mutação real implementada; nada foi executado."
        )

    async def update_environment_variables(self, variables: Dict[str, str]) -> bool:
        environment_id = os.getenv("RAILWAY_ENVIRONMENT_ID", "")
        if not self.api_token or not self.project_id or not environment_id:
            raise RuntimeError("RailwayService: parâmetros de atualização ausentes.")

        service_id = os.getenv("RAILWAY_SERVICE_ID", "")

        query = """
        mutation variableCollectionUpsert($input: VariableCollectionUpsertInput!) {
          variableCollectionUpsert(input: $input)
        }
        """
        
        variables_payload = {
            "input": {
                "projectId": self.project_id,
                "environmentId": environment_id,
                "variables": variables
            }
        }
        if service_id:
            variables_payload["input"]["serviceId"] = service_id

        headers = {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json"
        }

        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    "https://backboard.railway.app/graphql/v2",
                    json={"query": query, "variables": variables_payload},
                    headers=headers,
                    timeout=15.0
                )
                if response.status_code == 200:
                    res_json = response.json()
                    if "errors" in res_json:
                        logger.error("Erros retornados pela API GraphQL do Railway")
                        return False
                    logger.info("Variáveis do Railway atualizadas com sucesso.")
                    return True
                else:
                    logger.error(f"API Railway retornou status {response.status_code}")
                    return False
            except Exception as e:
                logger.error("Falha ao conectar com API GraphQL do Railway")
                return False


class TelegramService:
    """
    Instant alert engine for system events.
    """
    def __init__(self, bot_token: str = None, chat_id: str = None):
        self.bot_token = bot_token or os.getenv("TELEGRAM_BOT_TOKEN", "")
        self.chat_id = chat_id or os.getenv("TELEGRAM_CHAT_ID", "")
        self.base_url = f"https://api.telegram.org/bot{self.bot_token}/sendMessage" if self.bot_token else ""

    async def send_alert(self, text: str) -> bool:
        if not self.bot_token or not self.chat_id:
            raise RuntimeError(
                "TelegramService: TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID não configurados."
            )

        payload = {
            "chat_id": self.chat_id,
            "text": text,
            "parse_mode": "HTML"
        }

        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(self.base_url, json=payload, timeout=8.0)
                if response.status_code == 200:
                    logger.info("Alerta enviado via Telegram com sucesso.")
                    return True
                logger.error("Erro na API do Telegram: HTTP %s.", response.status_code)
                raise RuntimeError(
                    f"Telegram API respondeu HTTP {response.status_code}."
                )
            except RuntimeError:
                raise
            except Exception as exc:
                logger.error("Falha na conexão com API do Telegram")
                raise RuntimeError(
                    f"Telegram indisponível ({type(exc).__name__})."
                ) from None

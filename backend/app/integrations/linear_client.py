"""
Cliente GraphQL assíncrono para o Linear (Control Plane KÔMA).
Responsável por probes de saúde, consulta de issues e criação de issues
a partir do SuperAdmin com sanitização e proteção contra vazamento de credenciais.
"""
import logging
import os
import time
from typing import Any, Dict, List, Optional

import httpx

from .sanitizer import sanitize_text

logger = logging.getLogger("LinearClient")

LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql"
DEFAULT_TIMEOUT_SECONDS = 8.0


class LinearClient:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = (api_key or os.getenv("LINEAR_API_KEY") or "").strip()

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key)

    def _get_headers(self) -> Dict[str, str]:
        if not self.api_key:
            return {}
        # Linear aceita API key com ou sem prefixo Bearer
        auth_header = self.api_key if self.api_key.startswith("Bearer ") else self.api_key
        return {
            "Authorization": auth_header,
            "Content-Type": "application/json",
        }

    async def _execute_query(
        self, query: str, variables: Optional[Dict[str, Any]] = None, timeout: float = DEFAULT_TIMEOUT_SECONDS
    ) -> Dict[str, Any]:
        if not self.is_configured:
            raise RuntimeError("LINEAR_API_KEY não configurada no servidor.")

        payload = {"query": query}
        if variables:
            payload["variables"] = variables

        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                response = await client.post(
                    LINEAR_GRAPHQL_URL,
                    json=payload,
                    headers=self._get_headers(),
                )
            except httpx.TimeoutException:
                logger.warning("Timeout na comunicação com a API do Linear.")
                raise TimeoutError("Linear API timeout")
            except httpx.RequestError as exc:
                logger.warning(f"Erro de transporte ao conectar com o Linear: {exc}")
                raise RuntimeError(f"Linear API connection error: {exc}")

            if response.status_code != 200:
                logger.error(f"Linear GraphQL respondeu status HTTP {response.status_code}")
                raise RuntimeError(f"Linear HTTP {response.status_code}")

            data = response.json()
            if "errors" in data and data["errors"]:
                first_msg = data["errors"][0].get("message", "Erro GraphQL desconhecido")
                logger.error(f"Linear GraphQL error: {first_msg}")
                raise RuntimeError(f"Linear error: {first_msg}")

            return data.get("data", {})

    async def check_health(self) -> Dict[str, Any]:
        """
        Executa probe leve no Linear para conferir autenticação e latência.
        Nunca propaga exceções que interrompam a inicialização ou a resposta do SuperAdmin.
        """
        if not self.is_configured:
            return {
                "status": "not_configured",
                "configured": False,
                "latency_ms": None,
                "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "detail": "LINEAR_API_KEY não informada no ambiente.",
            }

        start_time = time.perf_counter()
        query = """
        query ViewerHealth {
            viewer {
                id
                name
            }
        }
        """
        try:
            data = await self._execute_query(query, timeout=5.0)
            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
            viewer_name = data.get("viewer", {}).get("name", "Connected")
            return {
                "status": "connected",
                "configured": True,
                "latency_ms": elapsed_ms,
                "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "detail": f"Autenticado como {viewer_name}.",
            }
        except TimeoutError:
            return {
                "status": "degraded",
                "configured": True,
                "latency_ms": round((time.perf_counter() - start_time) * 1000, 2),
                "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "detail": "Timeout ao consultar API do Linear.",
            }
        except Exception as exc:
            return {
                "status": "disconnected",
                "configured": True,
                "latency_ms": round((time.perf_counter() - start_time) * 1000, 2),
                "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "detail": f"Falha de autenticação ou conectividade: {exc}",
            }

    async def get_team_id(self, team_key: str = "KOM") -> Optional[str]:
        """Obtém o UUID de um time pelo seu team_key."""
        query = """
        query Teams {
            teams {
                nodes {
                    id
                    key
                    name
                }
            }
        }
        """
        data = await self._execute_query(query)
        teams = data.get("teams", {}).get("nodes", [])
        for team in teams:
            if team.get("key") == team_key or team.get("name") == team_key:
                return team.get("id")
        if teams:
            return teams[0].get("id")
        return None

    async def get_label_ids(self, label_names: List[str], team_id: Optional[str] = None) -> List[str]:
        """Busca os IDs das labels solicitadas."""
        query = """
        query IssueLabels {
            issueLabels {
                nodes {
                    id
                    name
                }
            }
        }
        """
        try:
            data = await self._execute_query(query)
            all_labels = data.get("issueLabels", {}).get("nodes", [])
            normalized_targets = {lbl.lower().strip() for lbl in label_names}
            return [
                lbl["id"]
                for lbl in all_labels
                if lbl.get("name", "").lower().strip() in normalized_targets
            ]
        except Exception:
            return []

    async def create_issue(
        self,
        title: str,
        description: str,
        team_id: Optional[str] = None,
        team_key: str = "KOM",
        priority: int = 0,
        labels: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Cria uma nova issue no Linear com título e descrição sanitizados.
        """
        if not self.is_configured:
            raise RuntimeError("LINEAR_API_KEY não configurada no servidor.")

        # Sanitização de segurança de PII
        clean_title = sanitize_text(title.strip())
        clean_desc = sanitize_text(description.strip())

        resolved_team_id = team_id or await self.get_team_id(team_key)
        if not resolved_team_id:
            raise RuntimeError(f"Time Linear '{team_key}' não encontrado.")

        label_ids = []
        if labels:
            label_ids = await self.get_label_ids(labels, resolved_team_id)

        mutation = """
        mutation IssueCreate($input: IssueCreateInput!) {
            issueCreate(input: $input) {
                success
                issue {
                    id
                    identifier
                    title
                    url
                    priority
                    state {
                        id
                        name
                    }
                    createdAt
                }
            }
        }
        """

        input_payload: Dict[str, Any] = {
            "title": clean_title,
            "description": clean_desc,
            "teamId": resolved_team_id,
            "priority": priority,
        }
        if label_ids:
            input_payload["labelIds"] = label_ids

        data = await self._execute_query(mutation, variables={"input": input_payload})
        result = data.get("issueCreate", {})
        if not result.get("success"):
            raise RuntimeError("Linear issueCreate não confirmou sucesso.")

        issue = result.get("issue", {})
        return {
            "id": issue.get("id"),
            "identifier": issue.get("identifier"),
            "title": issue.get("title"),
            "url": issue.get("url"),
            "priority": issue.get("priority"),
            "status": issue.get("state", {}).get("name"),
            "created_at": issue.get("createdAt"),
        }

    async def get_issue_status(self, issue_id_or_identifier: str) -> Optional[Dict[str, Any]]:
        """Consulta dados e status atual de uma issue no Linear."""
        if not self.is_configured:
            return None

        query = """
        query IssueLookup($id: String!) {
            issue(id: $id) {
                id
                identifier
                title
                url
                priority
                state {
                    id
                    name
                }
                updatedAt
            }
        }
        """
        try:
            data = await self._execute_query(query, variables={"id": issue_id_or_identifier})
            issue = data.get("issue")
            if not issue:
                return None
            return {
                "id": issue.get("id"),
                "identifier": issue.get("identifier"),
                "title": issue.get("title"),
                "url": issue.get("url"),
                "priority": issue.get("priority"),
                "status": issue.get("state", {}).get("name"),
                "updated_at": issue.get("updatedAt"),
            }
        except Exception as exc:
            logger.warning(f"Não foi possível obter status atual da issue {issue_id_or_identifier}: {exc}")
            return None

"""
Cliente HTTP para comunicação com a API de impressão do Kôma Bistrô (/api/print-agents).
"""

import logging
from typing import Any, Dict, Iterable, List, Optional, Set
import requests

log = logging.getLogger("print-agent.api")
AGENT_CAPABILITIES = ["connect_usb"]
AGENT_VERSION = "2026.09.05.1"


class AgentAuthenticationError(RuntimeError):
    """A credencial persistida foi revogada e precisa de novo pareamento."""


def _diagnostics_with_capabilities(
    diagnostics: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    if not diagnostics:
        return diagnostics
    return {
        **diagnostics,
        "capabilities": AGENT_CAPABILITIES,
        "agent_version": AGENT_VERSION,
    }


class KomaApiClient:
    def __init__(self, api_url: str, agent_token: str):
        self.api_url = api_url.rstrip("/")
        self.agent_token = agent_token
        # Mantém a conexão HTTP/TLS aberta entre os ciclos de polling. Além de
        # reduzir a latência, evita um novo handshake para cada job consultado.
        self.session = requests.Session()
        self.headers = {
            "Content-Type": "application/json",
            "X-Agent-Token": agent_token,
        }

    @staticmethod
    def _check_auth(response):
        if response.status_code in (401, 403):
            raise AgentAuthenticationError("A autorização deste computador foi revogada.")

    def register(self, agent_id: str, jwt_token: str) -> Optional[str]:
        """Registra um novo agente na API via JWT de admin e obtém o token permanente do agente."""
        url = f"{self.api_url}/api/print-agents/register"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {jwt_token}",
        }
        try:
            resp = self.session.post(
                url,
                json={"agent_id": agent_id},
                headers=headers,
                timeout=10,
            )
            if resp.status_code == 200:
                data = resp.json()
                token = data.get("agent_token")
                if token:
                    self.agent_token = token
                    self.headers["X-Agent-Token"] = token
                    log.info(f"Agente '{agent_id}' registrado com sucesso na API!")
                    return token
            log.error(f"Falha ao registrar agente (HTTP {resp.status_code}): {resp.text}")
        except Exception as e:
            log.error(f"Erro ao conectar na API para registrar agente: {e}")
        return None

    def heartbeat(
        self,
        diagnostics: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Envia o heartbeat e recebe um eventual comando do painel."""
        if not self.agent_token:
            return None
        url = f"{self.api_url}/api/print-agents/heartbeat"
        try:
            resp = self.session.post(
                url,
                json={
                    "diagnostics": _diagnostics_with_capabilities(
                        diagnostics
                    )
                } if diagnostics else {},
                headers=self.headers,
                timeout=5,
            )
            self._check_auth(resp)
            if resp.status_code == 200:
                payload = resp.json()
                return payload if isinstance(payload, dict) else {}
            if resp.status_code in (401, 403):
                raise AgentAuthenticationError(
                    "A autorização deste computador expirou ou foi revogada."
                )
            return None
        except AgentAuthenticationError:
            raise
        except Exception as e:
            log.debug(f"Erro ao enviar heartbeat: {e}")
            return None

    def complete_command(
        self,
        command_id: str,
        result: Dict[str, Any],
    ) -> bool:
        """Confirma o comando USB e atualiza o diagnóstico em uma chamada."""
        if not self.agent_token or not command_id:
            return False
        url = (
            f"{self.api_url}/api/print-agents/actions/"
            f"{command_id}/complete"
        )
        body = {
            "success": bool(result.get("success")),
            "code": str(result.get("code") or "unknown")[:80],
            "message": str(
                result.get("message") or "Comando concluído."
            )[:300],
            "printer_name": result.get("printer_name"),
            "diagnostics": _diagnostics_with_capabilities(
                result.get("diagnostics")
            ),
        }
        try:
            resp = self.session.post(
                url,
                json=body,
                headers=self.headers,
                timeout=10,
            )
            self._check_auth(resp)
            return resp.status_code == 200
        except AgentAuthenticationError:
            raise
        except Exception as exc:
            log.error(
                "Erro ao confirmar comando local '%s': %s",
                command_id,
                exc,
            )
            return False

    def get_next_job(self) -> Optional[Dict[str, Any]]:
        """Consulta o próximo job sem reservá-lo (compatibilidade legada)."""
        if not self.agent_token:
            return None
        url = f"{self.api_url}/api/print-agents/jobs/next"
        try:
            resp = self.session.get(url, headers=self.headers, timeout=5)
            self._check_auth(resp)
            if resp.status_code == 200:
                data = resp.json()
                return data if data else None
        except AgentAuthenticationError:
            raise
        except Exception as e:
            log.debug(f"Erro ao consultar próximo job: {e}")
        return None

    def claim_next_job(self) -> Optional[Dict[str, Any]]:
        """Busca e reserva atomicamente o próximo job em uma única chamada."""
        if not self.agent_token:
            return None
        url = f"{self.api_url}/api/print-agents/jobs/claim-next"
        try:
            resp = self.session.post(url, headers=self.headers, timeout=5)
            self._check_auth(resp)
            if resp.status_code == 200:
                data = resp.json()
                return data if data else None
            if resp.status_code not in (404, 405):
                log.warning(
                    "Falha ao buscar e reservar próximo job "
                    f"(HTTP {resp.status_code}): {resp.text}"
                )
                return None
        except AgentAuthenticationError:
            raise
        except Exception as e:
            log.debug(f"Erro ao buscar e reservar próximo job: {e}")
            return None

        # Compatibilidade durante a atualização: o backend antigo ainda usa
        # GET /jobs/next seguido de POST /jobs/{id}/claim.
        next_job = self.get_next_job()
        if not next_job:
            return None
        if self.claim_job(next_job["id"]):
            return next_job
        return None

    def claim_jobs(self, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Reserva um lote curto em uma única chamada.

        Durante a atualização gradual, volta automaticamente ao endpoint
        unitário sem interromper instalações com backend antigo.
        """
        if not self.agent_token:
            return []
        safe_limit = max(1, min(int(limit), 10))
        url = (
            f"{self.api_url}/api/print-agents/jobs/claim-batch"
            f"?limit={safe_limit}"
        )
        try:
            resp = self.session.post(
                url,
                headers=self.headers,
                timeout=5,
            )
            self._check_auth(resp)
            if resp.status_code == 200:
                data = resp.json()
                return data if isinstance(data, list) else []
            if resp.status_code not in (404, 405):
                log.warning(
                    "Falha ao reservar lote de impressão "
                    f"(HTTP {resp.status_code}): {resp.text}"
                )
                return []
        except AgentAuthenticationError:
            raise
        except Exception as exc:
            log.debug(f"Erro ao reservar lote de impressão: {exc}")
            return []

        legacy_job = self.claim_next_job()
        return [legacy_job] if legacy_job else []

    def claim_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Reserva atomicamente o job com ID informado."""
        if not self.agent_token:
            return None
        url = f"{self.api_url}/api/print-agents/jobs/{job_id}/claim"
        try:
            resp = self.session.post(url, headers=self.headers, timeout=5)
            self._check_auth(resp)
            if resp.status_code == 200:
                return resp.json()
            elif resp.status_code in (409, 404):
                log.warning(f"Claim do job '{job_id}' recusado (HTTP {resp.status_code}): {resp.text}")
        except AgentAuthenticationError:
            raise
        except Exception as e:
            log.error(f"Erro ao reivindicar job '{job_id}': {e}")
        return None

    def complete_job(self, job_id: str, printer_name: str = "Padrão") -> bool:
        """Confirma a conclusão da impressão do job no backend."""
        if not self.agent_token:
            return False
        url = f"{self.api_url}/api/print-agents/jobs/{job_id}/complete"
        try:
            resp = self.session.post(
                url,
                json={"printer_name": printer_name},
                headers=self.headers,
                timeout=10,
            )
            self._check_auth(resp)
            return resp.status_code == 200
        except AgentAuthenticationError:
            raise
        except Exception as e:
            log.error(f"Erro ao confirmar conclusão do job '{job_id}': {e}")
            return False

    def complete_jobs(
        self,
        jobs: Iterable[Dict[str, str]],
    ) -> Set[str]:
        """
        Confirma várias entregas ao spooler em uma chamada.

        Retorna somente os IDs aceitos pelo backend. Se o endpoint em lote
        ainda não existir, confirma um por um para manter compatibilidade.
        """
        items = [
            {
                "job_id": str(item["job_id"]),
                "printer_name": item.get("printer_name") or "Padrão",
            }
            for item in jobs
        ]
        if not self.agent_token or not items:
            return set()
        url = f"{self.api_url}/api/print-agents/jobs/complete-batch"
        try:
            resp = self.session.post(
                url,
                json={"jobs": items},
                headers=self.headers,
                timeout=10,
            )
            self._check_auth(resp)
            if resp.status_code == 200:
                data = resp.json()
                return {
                    str(job_id)
                    for job_id in data.get("confirmed_job_ids", [])
                }
            if resp.status_code not in (404, 405):
                log.warning(
                    "Falha ao confirmar lote de impressão "
                    f"(HTTP {resp.status_code}): {resp.text}"
                )
                return set()
        except AgentAuthenticationError:
            raise
        except Exception as exc:
            log.error(f"Erro ao confirmar lote de impressão: {exc}")
            return set()

        confirmed: Set[str] = set()
        for item in items:
            if self.complete_job(
                item["job_id"],
                printer_name=item["printer_name"],
            ):
                confirmed.add(item["job_id"])
        return confirmed

    def release_jobs(self, job_ids: Iterable[str]) -> Set[str]:
        """Devolve ao backend os jobs reservados mas ainda não impressos."""
        unique_ids = list(dict.fromkeys(str(job_id) for job_id in job_ids))
        if not self.agent_token or not unique_ids:
            return set()
        url = f"{self.api_url}/api/print-agents/jobs/release-batch"
        try:
            resp = self.session.post(
                url,
                json={"job_ids": unique_ids[:10]},
                headers=self.headers,
                timeout=5,
            )
            self._check_auth(resp)
            if resp.status_code == 200:
                data = resp.json()
                return {
                    str(job_id)
                    for job_id in data.get("released_job_ids", [])
                }
            log.warning(
                "Falha ao devolver lote não impresso "
                f"(HTTP {resp.status_code}): {resp.text}"
            )
        except AgentAuthenticationError:
            raise
        except Exception as exc:
            log.error(f"Erro ao devolver lote não impresso: {exc}")
        return set()

    def fail_job(self, job_id: str, error_msg: str) -> bool:
        """Notifica o backend sobre falha na impressão do job."""
        if not self.agent_token:
            return False
        url = f"{self.api_url}/api/print-agents/jobs/{job_id}/fail"
        try:
            resp = self.session.post(
                url,
                json={"error": error_msg[:500]},
                headers=self.headers,
                timeout=10,
            )
            self._check_auth(resp)
            return resp.status_code == 200
        except AgentAuthenticationError:
            raise
        except Exception as e:
            log.error(f"Erro ao reportar falha do job '{job_id}': {e}")
            return False

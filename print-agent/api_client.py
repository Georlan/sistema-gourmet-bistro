"""
Cliente HTTP para comunicação com a API de impressão do Kôma Bistrô (/api/print-agents).
"""

import logging
from typing import Any, Dict, Optional
import requests

log = logging.getLogger("print-agent.api")


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

    def heartbeat(self) -> bool:
        """Envia sinal periódico de vida (heartbeat) para o backend."""
        if not self.agent_token:
            return False
        url = f"{self.api_url}/api/print-agents/heartbeat"
        try:
            resp = self.session.post(url, headers=self.headers, timeout=5)
            return resp.status_code == 200
        except Exception as e:
            log.debug(f"Erro ao enviar heartbeat: {e}")
            return False

    def get_next_job(self) -> Optional[Dict[str, Any]]:
        """Consulta o próximo job pendente na fila do restaurante."""
        if not self.agent_token:
            return None
        url = f"{self.api_url}/api/print-agents/jobs/next"
        try:
            resp = self.session.get(url, headers=self.headers, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                return data if data else None
        except Exception as e:
            log.debug(f"Erro ao consultar próximo job: {e}")
        return None

    def claim_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Reserva atomicamente o job com ID informado."""
        if not self.agent_token:
            return None
        url = f"{self.api_url}/api/print-agents/jobs/{job_id}/claim"
        try:
            resp = self.session.post(url, headers=self.headers, timeout=5)
            if resp.status_code == 200:
                return resp.json()
            elif resp.status_code in (409, 404):
                log.warning(f"Claim do job '{job_id}' recusado (HTTP {resp.status_code}): {resp.text}")
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
            return resp.status_code == 200
        except Exception as e:
            log.error(f"Erro ao confirmar conclusão do job '{job_id}': {e}")
            return False

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
            return resp.status_code == 200
        except Exception as e:
            log.error(f"Erro ao reportar falha do job '{job_id}': {e}")
            return False

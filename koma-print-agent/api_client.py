from typing import Optional, Dict, Any
import requests

class KomaApiClient:
    """Cliente HTTP leve para comunicação do Agent local com a API FastAPI do Kôma."""

    def __init__(self, api_url: str, agent_token: str):
        self.api_url = api_url.rstrip("/")
        self.agent_token = agent_token
        self.session = requests.Session()
        self.session.headers.update({
            "X-Agent-Token": self.agent_token,
            "Content-Type": "application/json"
        })

    def heartbeat(self) -> bool:
        try:
            resp = self.session.post(f"{self.api_url}/api/print-agents/heartbeat", timeout=5)
            return resp.status_code == 200
        except Exception:
            return False

    def get_next_job(self) -> Optional[Dict[str, Any]]:
        try:
            resp = self.session.get(f"{self.api_url}/api/print-agents/jobs/next", timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                return data if data else None
            return None
        except Exception:
            return None

    def claim_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        try:
            resp = self.session.post(f"{self.api_url}/api/print-agents/jobs/{job_id}/claim", timeout=5)
            if resp.status_code == 200:
                return resp.json()
            return None
        except Exception:
            return None

    def complete_job(self, job_id: str, printer_name: str = "Padrão") -> bool:
        try:
            payload = {"printer_name": printer_name}
            resp = self.session.post(f"{self.api_url}/api/print-agents/jobs/{job_id}/complete", json=payload, timeout=5)
            return resp.status_code == 200
        except Exception:
            return False

    def fail_job(self, job_id: str, error_msg: str) -> bool:
        try:
            payload = {"error": error_msg}
            resp = self.session.post(f"{self.api_url}/api/print-agents/jobs/{job_id}/fail", json=payload, timeout=5)
            return resp.status_code == 200
        except Exception:
            return False

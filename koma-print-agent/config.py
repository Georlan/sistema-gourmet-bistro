import os
import json

class AgentConfig:
    """Carrega as configurações locais do agente a partir do config.json."""
    def __init__(self, config_path: str = "config.json"):
        if not os.path.isabs(config_path):
            base_dir = os.path.dirname(os.path.abspath(__file__))
            full_path = os.path.join(base_dir, config_path)
            if not os.path.exists(full_path):
                full_path = os.path.join(base_dir, "config.example.json")
        else:
            full_path = config_path

        with open(full_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        self.api_url = data.get("api_url", "http://localhost:8000").rstrip("/")
        self.agent_token = data.get("agent_token", "")
        self.agent_id = data.get("agent_id", "caixa-principal")
        self.poll_interval_seconds = int(data.get("poll_interval_seconds", 2))
        self.adapter = data.get("adapter", "dummy").lower()
        self.printers = data.get("printers", {})

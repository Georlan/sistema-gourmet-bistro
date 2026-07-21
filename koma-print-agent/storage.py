import os
import json

class AgentLocalStorage:
    """Gerencia armazenamento local secundário do agente se necessário."""
    def __init__(self, storage_dir: str = "agent_data"):
        self.storage_dir = storage_dir
        os.makedirs(self.storage_dir, exist_ok=True)

    def save_state(self, key: str, data: dict):
        filepath = os.path.join(self.storage_dir, f"{key}.json")
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def load_state(self, key: str) -> dict:
        filepath = os.path.join(self.storage_dir, f"{key}.json")
        if os.path.exists(filepath):
            with open(filepath, "r", encoding="utf-8") as f:
                return json.load(f)
        return {}

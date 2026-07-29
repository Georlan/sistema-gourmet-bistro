"""
Configuração do Kôma Print Agent.
Lê argumentos da linha de comando, variáveis de ambiente e arquivo config.json local.
"""

import argparse
import json
import os
from dataclasses import dataclass, field
from typing import Dict, Optional


@dataclass
class AgentConfig:
    api_url: str = "https://sistema-gourmet-bistro-production.up.railway.app"
    agent_token: str = ""
    agent_id: str = "agent-local"
    adapter: str = "auto"  # 'auto', 'file', 'linux', 'windows'
    output_dir: str = "print_output"
    poll_interval_seconds: float = 0.5
    heartbeat_interval_seconds: float = 30.0
    claim_batch_size: int = 10
    printers: Dict[str, str] = field(default_factory=lambda: {"PADRAO": "Padrão"})
    pair_only: bool = False

    @classmethod
    def load(cls, config_path: Optional[str] = None) -> "AgentConfig":
        config = cls()

        # 1. Carregar arquivo JSON se existir
        target_json = config_path or os.getenv("KOMA_CONFIG_FILE", "config.json")
        if os.path.exists(target_json):
            try:
                with open(target_json, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    config.api_url = data.get("api_url", config.api_url)
                    config.agent_token = data.get("agent_token", config.agent_token)
                    config.agent_id = data.get("agent_id", config.agent_id)
                    config.adapter = data.get("adapter", config.adapter)
                    config.output_dir = data.get("output_dir", config.output_dir)
                    config.poll_interval_seconds = float(
                        data.get(
                            "poll_interval_seconds",
                            config.poll_interval_seconds,
                        )
                    )
                    config.heartbeat_interval_seconds = float(
                        data.get(
                            "heartbeat_interval_seconds",
                            config.heartbeat_interval_seconds,
                        )
                    )
                    config.claim_batch_size = int(
                        data.get(
                            "claim_batch_size",
                            config.claim_batch_size,
                        )
                    )
                    config.printers = data.get("printers", config.printers)
            except Exception as exc:
                print(f"[CONFIG WARNING] Erro ao ler '{target_json}': {exc}")

        # 2. Sobrescrever por variáveis de ambiente se definidas
        config.api_url = os.getenv("KOMA_API_URL", config.api_url)
        config.agent_token = (
            os.getenv("KOMA_AGENT_TOKEN", config.agent_token)
            or os.getenv("KOMA_TOKEN", config.agent_token)
        )
        config.agent_id = os.getenv("KOMA_AGENT_ID", config.agent_id)
        config.adapter = os.getenv("KOMA_ADAPTER", config.adapter)
        config.output_dir = os.getenv("KOMA_OUTPUT_DIR", config.output_dir)
        try:
            config.poll_interval_seconds = max(
                0.1,
                float(
                    os.getenv(
                        "KOMA_POLL_SEC",
                        str(config.poll_interval_seconds),
                    )
                ),
            )
            config.heartbeat_interval_seconds = max(
                5.0,
                float(
                    os.getenv(
                        "KOMA_HB_SEC",
                        str(config.heartbeat_interval_seconds),
                    )
                ),
            )
            config.claim_batch_size = max(
                1,
                min(
                    10,
                    int(
                        os.getenv(
                            "KOMA_CLAIM_BATCH_SIZE",
                            str(config.claim_batch_size),
                        )
                    ),
                ),
            )
        except ValueError:
            print(
                "[CONFIG WARNING] Intervalo ou lote inválido; "
                "mantendo os valores configurados."
            )

        # 3. Reutilizar a credencial pareada localmente, sem exigir cópia manual.
        if not config.agent_token:
            try:
                from pairing import load_stored_token

                config.agent_token = load_stored_token()
            except ImportError:
                pass

        return config


def parse_cli_args(config: AgentConfig) -> AgentConfig:
    parser = argparse.ArgumentParser(
        description="Agente de Impressão Local Multiplataforma Kôma Bistrô"
    )
    parser.add_argument("--api-url", default=config.api_url, help="URL base do backend")
    parser.add_argument(
        "--token",
        default=config.agent_token,
        help="Token do agente (X-Agent-Token)",
    )
    parser.add_argument(
        "--agent-id",
        default=config.agent_id,
        help="Identificador do agente local",
    )
    parser.add_argument(
        "--adapter",
        default=config.adapter,
        choices=["auto", "file", "linux", "windows"],
        help="Adaptador de impressão ('auto', 'file', 'linux', 'windows')",
    )
    parser.add_argument(
        "--output-dir",
        default=config.output_dir,
        help="Diretório para salvar arquivos no adaptador 'file'",
    )
    parser.add_argument(
        "--poll-sec",
        type=float,
        default=config.poll_interval_seconds,
        help="Intervalo de polling em segundos",
    )
    parser.add_argument(
        "--hb-sec",
        type=float,
        default=config.heartbeat_interval_seconds,
        help="Intervalo de heartbeat em segundos",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=config.claim_batch_size,
        help="Quantidade máxima de trabalhos reservados por chamada (1–10)",
    )
    parser.add_argument(
        "--pair-only",
        action="store_true",
        help="Conclui o pareamento automático e encerra",
    )

    args = parser.parse_args()
    config.api_url = args.api_url.rstrip("/")
    config.agent_token = args.token
    config.agent_id = args.agent_id
    config.adapter = args.adapter
    config.output_dir = args.output_dir
    config.poll_interval_seconds = max(0.1, args.poll_sec)
    config.heartbeat_interval_seconds = max(5.0, args.hb_sec)
    config.claim_batch_size = max(1, min(10, args.batch_size))
    config.pair_only = args.pair_only

    return config

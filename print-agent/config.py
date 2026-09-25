"""
Configuração do Kôma Print Agent.
Lê argumentos da linha de comando, variáveis de ambiente e arquivo config.json local.
"""

import argparse
import json
import os
from pathlib import Path
import re
import sys
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from endpoints import (
    PrinterEndpoint,
    infer_transport_from_target,
    SUPPORTED_TRANSPORTS,
)


AUTOMATIC_PRINTER_NAMES = {
    "",
    "padrão",
    "padrao",
    "default",
    "auto",
    "automática",
    "automatica",
}


def is_automatic_printer_name(value: str) -> bool:
    return (value or "").strip().casefold() in AUTOMATIC_PRINTER_NAMES


@dataclass
class AgentConfig:
    api_url: str = "https://sistema-gourmet-bistro-production.up.railway.app"
    agent_token: str = ""
    agent_id: str = "agent-local"
    adapter: str = "auto"  # 'auto', 'file', 'linux', 'windows'
    output_dir: str = "print_output"
    poll_interval_seconds: float = 0.5
    heartbeat_interval_seconds: float = 5.0
    claim_batch_size: int = 10
    max_parallel_printers: int = 2
    printers: Dict[str, str] = field(default_factory=lambda: {"PADRAO": "Padrão"})
    endpoints: List[PrinterEndpoint] = field(default_factory=list)
    destinations: Dict[str, str] = field(default_factory=dict)
    pair_only: bool = False
    config_path: str = "config.json"

    @classmethod
    def load(cls, config_path: Optional[str] = None) -> "AgentConfig":
        config = cls()

        # 1. Carregar arquivo JSON se existir
        legacy_directory = Path("config.json").exists() or Path("journal.db").exists()
        default_path = Path("config.json") if legacy_directory else Path(__file__).with_name("config.json")
        target_json = config_path or os.getenv("KOMA_CONFIG_FILE", str(default_path))
        config.config_path = target_json
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
                    config.max_parallel_printers = int(
                        data.get(
                            "max_parallel_printers",
                            config.max_parallel_printers,
                        )
                    )

                    # Carregar endpoints estruturados se definidos
                    raw_endpoints = data.get("endpoints")
                    if isinstance(raw_endpoints, list):
                        config.endpoints = [
                            PrinterEndpoint.from_dict(ep) if isinstance(ep, dict) else ep
                            for ep in raw_endpoints
                            if isinstance(ep, (dict, PrinterEndpoint))
                        ]

                    # Carregar destinos mapeados se definidos
                    raw_destinations = data.get("destinations")
                    if isinstance(raw_destinations, dict):
                        config.destinations = {
                            str(dest).strip().upper(): str(ep_id).strip()
                            for dest, ep_id in raw_destinations.items()
                            if str(dest).strip() and str(ep_id).strip()
                        }

                    # Retrocompatibilidade com 'printers':
                    stored_printers = data.get("printers")
                    if isinstance(stored_printers, dict):
                        config.printers = {
                            str(destination).strip().upper(): str(name).strip()
                            for destination, name in stored_printers.items()
                            if str(destination).strip() and str(name).strip()
                        } or config.printers

                    # Migração transparente: sintetizar endpoints a partir de printers legados
                    if not config.endpoints and config.printers:
                        for dest, name in config.printers.items():
                            dest_clean = dest.strip().upper()
                            name_clean = name.strip()
                            t, addr = infer_transport_from_target(name_clean, config.adapter)
                            safe_name = re.sub(r"[^a-zA-Z0-9_-]+", "-", name_clean).strip("-").lower()
                            ep = PrinterEndpoint(
                                id=f"ep-{t}-{safe_name}" if safe_name else f"ep-{dest_clean.lower()}",
                                name=name_clean,
                                display_name=name_clean,
                                transport=t,
                                address=addr,
                            )
                            config.endpoints.append(ep)
                            if dest_clean not in config.destinations:
                                config.destinations[dest_clean] = ep.id

                    # Se existiam endpoints mas não destinos explícitos
                    if config.endpoints and not config.destinations:
                        config.destinations["PADRAO"] = config.endpoints[0].id

                    # Sincroniza config.printers a partir de destinations/endpoints
                    endpoints_by_id = {ep.id: ep for ep in config.endpoints}
                    for dest, ep_id in config.destinations.items():
                        if ep_id in endpoints_by_id:
                            config.printers[dest] = endpoints_by_id[ep_id].name
                        elif dest not in config.printers:
                            config.printers[dest] = ep_id
            except Exception as exc:
                print(f"[CONFIG WARNING] Erro ao ler '{target_json}': {exc}")

        # Garantir fallback estruturado mesmo sem config.json
        if not config.endpoints:
            platform_transport = "cups" if sys.platform.startswith("linux") else "windows_spooler"
            padrao_name = config.printers.get("PADRAO") or "Padrão"
            default_ep = PrinterEndpoint(
                id=f"ep-{platform_transport}-padrao",
                name=padrao_name,
                display_name=padrao_name,
                transport=platform_transport,
                address=padrao_name,
            )
            config.endpoints.append(default_ep)
            config.destinations["PADRAO"] = default_ep.id

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
            config.max_parallel_printers = max(
                1,
                min(
                    4,
                    int(
                        os.getenv(
                            "KOMA_MAX_PARALLEL_PRINTERS",
                            str(config.max_parallel_printers),
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

    def get_endpoint_by_id(self, endpoint_id: str) -> Optional[PrinterEndpoint]:
        for ep in self.endpoints:
            if ep.id == endpoint_id:
                return ep
        return None

    def resolve_destination(self, destination: str) -> Optional[PrinterEndpoint]:
        """
        Resolve o PrinterEndpoint associado ao destino (ex: 'COZINHA', 'PADRAO', 'BAR').
        Retorna o endpoint mapeado, ou o endpoint do destino 'PADRAO' caso não haja mapeamento específico.
        """
        dest_norm = (destination or "PADRAO").strip().upper()
        endpoints_by_id = {ep.id: ep for ep in self.endpoints}
        endpoints_by_name = {ep.name.casefold(): ep for ep in self.endpoints}

        # 1. Busca direta pelo mapeamento de destinos
        target_id = self.destinations.get(dest_norm)
        if target_id:
            if target_id in endpoints_by_id:
                return endpoints_by_id[target_id]
            if target_id.casefold() in endpoints_by_name:
                return endpoints_by_name[target_id.casefold()]

        # 2. Fallback para PADRAO
        if dest_norm != "PADRAO":
            padrao_id = self.destinations.get("PADRAO")
            if padrao_id:
                if padrao_id in endpoints_by_id:
                    return endpoints_by_id[padrao_id]
                if padrao_id.casefold() in endpoints_by_name:
                    return endpoints_by_name[padrao_id.casefold()]

        # 3. Fallback para config.printers legado
        legacy_name = self.printers.get(dest_norm) or self.printers.get("PADRAO")
        if legacy_name:
            if legacy_name.casefold() in endpoints_by_name:
                return endpoints_by_name[legacy_name.casefold()]
            t, addr = infer_transport_from_target(legacy_name, self.adapter)
            return PrinterEndpoint(
                id=f"legacy-{dest_norm.lower()}",
                name=legacy_name,
                display_name=legacy_name,
                transport=t,
                address=addr,
            )

        if self.endpoints:
            return self.endpoints[0]

        return None

    def remember_printer(
        self,
        printer_name: str,
        endpoint: Optional[PrinterEndpoint] = None,
    ) -> None:
        """
        Memoriza a impressora padrão do Kôma, atualizando destinos e endpoints
        estruturados sem perder qualquer configuração existente.
        """
        selected = (printer_name or "").strip()
        if not selected and not endpoint:
            raise ValueError("Nome da impressora ausente.")

        target = Path(self.config_path or "config.json")
        data = {}
        if target.exists():
            try:
                loaded = json.loads(target.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    data = loaded
            except (OSError, ValueError, TypeError):
                data = {}

        # 1. Carrega endpoints existentes do arquivo
        raw_endpoints = data.get("endpoints") or []
        endpoints_list = [
            PrinterEndpoint.from_dict(ep) if isinstance(ep, dict) else ep
            for ep in raw_endpoints
            if isinstance(ep, (dict, PrinterEndpoint))
        ]

        if endpoint is not None:
            new_ep = endpoint
        else:
            t, addr = infer_transport_from_target(selected, self.adapter)
            safe_name = re.sub(r"[^a-zA-Z0-9_-]+", "-", selected).strip("-").lower()
            new_ep = PrinterEndpoint(
                id=f"ep-{t}-{safe_name}" if safe_name else f"ep-padrao",
                name=selected,
                display_name=selected,
                transport=t,
                address=addr,
            )

        # Atualiza ou adiciona endpoint na lista
        found_idx = next(
            (
                i for i, ep in enumerate(endpoints_list)
                if ep.id == new_ep.id or (ep.name == new_ep.name and ep.transport == new_ep.transport)
            ),
            None,
        )
        if found_idx is not None:
            endpoints_list[found_idx] = new_ep
        else:
            endpoints_list.append(new_ep)

        # 2. Carrega destinos e printers legados
        stored_destinations = data.get("destinations")
        if not isinstance(stored_destinations, dict):
            stored_destinations = {}

        stored_printers = data.get("printers")
        if not isinstance(stored_printers, dict):
            stored_printers = {}

        for destination, current_name in list(stored_printers.items()):
            if is_automatic_printer_name(str(current_name)):
                stored_printers[destination] = new_ep.name
                stored_destinations[destination] = new_ep.id

        stored_destinations["PADRAO"] = new_ep.id
        stored_printers["PADRAO"] = new_ep.name

        data["endpoints"] = [ep.to_dict() for ep in endpoints_list]
        data["destinations"] = stored_destinations
        data["printers"] = stored_printers

        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(f"{target.suffix}.tmp")
        temporary.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        os.replace(temporary, target)

        self.endpoints = endpoints_list
        self.destinations = stored_destinations
        self.printers = stored_printers

    def register_endpoint(
        self,
        endpoint: PrinterEndpoint,
        destination: Optional[str] = None,
    ) -> None:
        """Registra um endpoint estruturado e opcionalmente o vincula a um destino."""
        target = Path(self.config_path or "config.json")
        data = {}
        if target.exists():
            try:
                loaded = json.loads(target.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    data = loaded
            except (OSError, ValueError, TypeError):
                data = {}

        raw_endpoints = data.get("endpoints") or []
        endpoints_list = [
            PrinterEndpoint.from_dict(ep) if isinstance(ep, dict) else ep
            for ep in raw_endpoints
            if isinstance(ep, (dict, PrinterEndpoint))
        ]

        found_idx = next((i for i, ep in enumerate(endpoints_list) if ep.id == endpoint.id), None)
        if found_idx is not None:
            endpoints_list[found_idx] = endpoint
        else:
            endpoints_list.append(endpoint)

        stored_destinations = data.get("destinations")
        if not isinstance(stored_destinations, dict):
            stored_destinations = {}

        stored_printers = data.get("printers")
        if not isinstance(stored_printers, dict):
            stored_printers = {}

        if destination:
            dest_key = destination.strip().upper()
            stored_destinations[dest_key] = endpoint.id
            stored_printers[dest_key] = endpoint.name

        data["endpoints"] = [ep.to_dict() for ep in endpoints_list]
        data["destinations"] = stored_destinations
        data["printers"] = stored_printers

        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(f"{target.suffix}.tmp")
        temporary.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        os.replace(temporary, target)

        self.endpoints = endpoints_list
        self.destinations = stored_destinations
        self.printers = stored_printers


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
        "--parallel-printers",
        type=int,
        default=config.max_parallel_printers,
        help="Quantidade de impressoras processadas em paralelo (1–4)",
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
    config.max_parallel_printers = max(1, min(4, args.parallel_printers))
    config.pair_only = args.pair_only

    return config

#!/usr/bin/env python3
"""
Ponto de entrada do Kôma Print Agent Multiplataforma.
"""

import sys
import logging
from config import AgentConfig, parse_cli_args
from worker import run_agent_loop

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

def main():
    config = AgentConfig.load()
    config = parse_cli_args(config)

    if not config.agent_token:
        print("[ERRO] Token do agente não informado. Forneça via --token, variável KOMA_AGENT_TOKEN ou arquivo config.json.")
        sys.exit(1)

    run_agent_loop(config)

if __name__ == "__main__":
    main()

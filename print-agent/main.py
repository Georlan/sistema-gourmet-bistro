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
        from pairing import pair_agent

        print("[PAREAMENTO] Nenhuma credencial local encontrada. Abrindo o Kôma...")
        paired_token = pair_agent()
        if not paired_token:
            print("[ERRO] Pareamento não concluído. Entre no Kôma e tente novamente.")
            sys.exit(1)
        config.agent_token = paired_token
        print("[PAREAMENTO] Computador conectado com sucesso.")

    run_agent_loop(config)

if __name__ == "__main__":
    main()

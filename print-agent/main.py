#!/usr/bin/env python3
"""Ponto de entrada do Kôma Print Agent multiplataforma."""

import logging
import sys

from config import AgentConfig, parse_cli_args
from worker import run_agent_loop
from server import start_local_print_server

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)


def main() -> int:
    config = parse_cli_args(AgentConfig.load())

    # Inicia o servidor HTTP nativo local na porta 9123 para impressão instantânea USB
    try:
        start_local_print_server()
    except Exception as err:
        print(f"[AVISO] Não foi possível iniciar o servidor HTTP local na porta 9123: {err}")

    if not config.agent_token:
        from pairing import pair_agent

        print("[PAREAMENTO] Nenhuma credencial local encontrada. Abrindo o Kôma...")
        paired_token = pair_agent()
        if not paired_token:
            print(
                "[ERRO] Pareamento não concluído. "
                "Entre no Kôma e execute o instalador novamente."
            )
            return 1
        config.agent_token = paired_token
        print("[PAREAMENTO] Computador conectado com sucesso.")

    if config.pair_only:
        print("[PAREAMENTO] Credencial local pronta. Nenhum token precisa ser copiado.")
        return 0

    run_agent_loop(config)
    return 0


if __name__ == "__main__":
    sys.exit(main())

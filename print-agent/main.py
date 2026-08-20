#!/usr/bin/env python3
"""Ponto de entrada do Kôma Print Agent multiplataforma."""

import logging
import sys

from config import AgentConfig, parse_cli_args
from api_client import AgentAuthenticationError, KomaApiClient
from worker import run_agent_loop

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)


def main() -> int:
    config = parse_cli_args(AgentConfig.load())

    while True:
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

        try:
            # Valida inclusive no modo --pair-only. Assim o instalador não
            # declara pronta uma credencial que o backend já revogou.
            KomaApiClient(config.api_url, config.agent_token).heartbeat()
        except AgentAuthenticationError:
            from pairing import clear_stored_token

            clear_stored_token()
            config.agent_token = ""
            print(
                "[PAREAMENTO] A autorização anterior foi revogada. "
                "Solicitando uma nova conexão segura..."
            )
            continue

        if config.pair_only:
            print("[PAREAMENTO] Credencial local pronta. Nenhum token precisa ser copiado.")
            return 0

        try:
            run_agent_loop(config)
            return 0
        except AgentAuthenticationError:
            from pairing import clear_stored_token

            clear_stored_token()
            config.agent_token = ""
            print(
                "[PAREAMENTO] A autorização anterior foi revogada. "
                "Reconectando este computador sem apagar a fila local..."
            )


if __name__ == "__main__":
    sys.exit(main())

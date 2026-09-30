#!/usr/bin/env python3
"""Ponto de entrada do Kôma Print Agent multiplataforma."""

import logging
import sys

from config import AgentConfig, parse_cli_args
from api_client import AgentAuthenticationError, KomaApiClient
from worker import run_agent_loop
from agent_runtime import AgentAlreadyRunning, single_instance, configure_file_logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

# EX_TEMPFAIL: o pareamento exige uma ação humana. O serviço systemd usa este
# código para encerrar sem entrar em um ciclo que reabre o navegador a cada
# poucos segundos quando a autorização não é concluída.
PAIRING_REQUIRED_EXIT = 2


def main() -> int:
    config = parse_cli_args(AgentConfig.load())
    try:
        with single_instance():
            configure_file_logging()
            return run(config)
    except AgentAlreadyRunning:
        print("[KÔMA] O conector já está aberto neste computador.")
        return 0


def rudef run(config: AgentConfig) -> int:

    while True:
        if not config.agent_token:
            if not config.pair_only:
                print(
                    "[PAREAMENTO] Este computador precisa ser autorizado. "
                    "Use 'Preparar impressão' no Kôma para iniciar uma única conexão segura."
                )
                return PAIRING_REQUIRED_EXIT

            from pairing import pair_agent

            print("[PAREAMENTO] Nenhuma credencial local encontrada. Abrindo o Kôma...")
            paired_token = pair_agent()
            if not paired_token:
                print(
                    "[PAREAMENTO] Autorização não concluída. "
                    "Tente novamente por 'Preparar impressão' quando estiver pronto."
                )
                return 1
            config.agent_token = paired_token
            print("[PAREAMENTO] Computador conectado com sucesso.")

        try:
            # Valida inclusive no modo --pair-only. Assim o instalador não
            # declara pronta uma credencial que o backend já revogou.
            probe = KomaApiClient(config.api_url, config.agent_token)
            try:
                probe.heartbeat()
            finally:
                probe.session.close()
        except AgentAuthenticationError:
            from pairing import clear_stored_token

            clear_stored_token()
            config.agent_token = ""
            if config.pair_only:
                print(
                    "[PAREAMENTO] A autorização anterior foi revogada. "
                    "Solicitando uma nova conexão segura..."
                )
                continue
            print(
                "[PAREAMENTO] A autorização anterior foi revogada. "
                "Use 'Preparar impressão' para autorizar este computador novamente."
            )
            return PAIRING_REQUIRED_EXIT

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
                "[PAREAMENTO] A autorização deste computador foi revogada. "
                "O serviço foi pausado sem abrir navegador; use 'Preparar impressão'."
            )
            return PAIRING_REQUIRED_EXIT_name__ == "__main__":
    sys.exit(main())

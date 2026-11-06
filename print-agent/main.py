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

# O código 2 significa "pareamento explícito necessário". No Linux, a unit
# systemd usa RestartPreventExitStatus=2 para não abrir/reabrir o navegador em
# loop quando a autorização precisa de ação humana.
PAIRING_REQUIRED_EXIT = 2


def pairing_exit_code() -> int:
    """Retorna o código de saída apropriado quando pareamento é necessário.

    No Linux, a unit systemd usa RestartPreventExitStatus=2 para não reiniciar.
    No Windows, o Agendador de Tarefas interpreta qualquer código diferente de 0 como falha
    e dispara a contagem de reinícios (RestartCount 999 a cada 1 minuto). Encerrar com 0
    informa conclusão normal ao Windows e impede o loop infinito de reinícios.
    """
    if sys.platform == "win32":
        return 0
    return PAIRING_REQUIRED_EXIT


def main() -> int:
    config = parse_cli_args(AgentConfig.load())
    try:
        with single_instance():
            configure_file_logging()
            return run(config)
    except AgentAlreadyRunning:
        print("[KÔMA] O conector já está aberto neste computador.")
        return 0


def run(config: AgentConfig) -> int:

    while True:
        if not config.agent_token:
            if not config.pair_only:
                print(
                    "[PAREAMENTO] Este computador precisa ser autorizado. "
                    "Use 'Preparar impressão' no Kôma para iniciar uma única conexão segura."
                )
                return pairing_exit_code()

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
            config.agent_token_source = "credentials"
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

            clear_stored_token(config.agent_token, config.config_path)
            config.agent_token = ""
            config.agent_token_source = ""
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
            return pairing_exit_code()

        if config.pair_only:
            print("[PAREAMENTO] Credencial local pronta. Nenhum token precisa ser copiado.")
            return 0

        try:
            run_agent_loop(config)
            return 0
        except AgentAuthenticationError:
            from pairing import clear_stored_token

            clear_stored_token(config.agent_token, config.config_path)
            config.agent_token = ""
            config.agent_token_source = ""
            print(
                "[PAREAMENTO] A autorização deste computador foi revogada. "
                "O serviço foi pausado sem abrir navegador; use 'Preparar impressão'."
            )
            return pairing_exit_code()


if __name__ == "__main__":
    sys.exit(main())

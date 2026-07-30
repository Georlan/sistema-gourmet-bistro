#!/usr/bin/env bash
set -euo pipefail

# Manipulador do protocolo koma-print://. A página usa este atalho apenas para
# reativar o serviço já instalado; nenhuma janela do agente precisa ficar aberta.
systemctl --user start koma-print-agent.service

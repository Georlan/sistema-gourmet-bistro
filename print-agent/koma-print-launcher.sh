#!/usr/bin/env bash
set -euo pipefail

# Manipulador do protocolo koma-print://.
#
# O launcher é deliberadamente idempotente: clicar várias vezes em
# "Preparar impressão", inclusive a partir de abas diferentes, nunca deve abrir
# vários pareamentos/navegadores ao mesmo tempo.
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
INSTALL_DIR="$DATA_HOME/koma-print-agent"
VENV_DIR="$INSTALL_DIR/.venv"
CREDENTIALS_FILE="$CONFIG_HOME/koma-print-agent/credentials.json"
LOCK_FILE="${XDG_RUNTIME_DIR:-/tmp}/koma-print-pairing-${UID}.lock"

service_state="$(systemctl --user show koma-print-agent.service -p ActiveState --value 2>/dev/null || true)"
if [[ "$service_state" == "active" || "$service_state" == "activating" ]]; then
    exit 0
fi

# Com credencial local, nunca abrimos navegador: apenas reativamos o worker.
if [[ -s "$CREDENTIALS_FILE" ]]; then
    systemctl --user start koma-print-agent.service
    exit 0
fi

if ! command -v flock >/dev/null 2>&1; then
    echo "[KÔMA] Não foi possível iniciar o pareamento: comando 'flock' ausente." >&2
    exit 1
fi

# Single-flight entre cliques, abas e processos diferentes.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    exit 0
fi

# Revalida depois do lock para fechar a corrida entre duas chamadas quase
# simultâneas: a primeira pode já ter concluído enquanto a segunda esperava.
service_state="$(systemctl --user show koma-print-agent.service -p ActiveState --value 2>/dev/null || true)"
if [[ "$service_state" == "active" || "$service_state" == "activating" ]]; then
    exit 0
fi
if [[ -s "$CREDENTIALS_FILE" ]]; then
    systemctl --user start koma-print-agent.service
    exit 0
fi

if [[ ! -x "$VENV_DIR/bin/python" || ! -f "$INSTALL_DIR/main.py" ]]; then
    echo "[KÔMA] Agente local incompleto. Execute o instalador novamente." >&2
    exit 1
fi

# pairing.py reconhece esta flag e não tenta adquirir um segundo flock dentro
# do processo filho. O fd 9 permanece aberto durante todo o pareamento.
export KOMA_PAIRING_LOCK_HELD=1
(
    cd "$INSTALL_DIR"
    "$VENV_DIR/bin/python" main.py --pair-only
)

if [[ -s "$CREDENTIALS_FILE" ]]; then
    systemctl --user start koma-print-agent.service
fi

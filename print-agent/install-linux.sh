#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
INSTALL_DIR="$DATA_HOME/koma-print-agent"
ADAPTER_DIR="$INSTALL_DIR/adapters"
VENV_DIR="$INSTALL_DIR/.venv"
UNIT_DIR="$CONFIG_HOME/systemd/user"
UNIT_FILE="$UNIT_DIR/koma-print-agent.service"

required_commands=("$PYTHON_BIN" systemctl install)
for command_name in "${required_commands[@]}"; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "[ERRO] Comando obrigatório não encontrado: $command_name" >&2
        exit 1
    fi
done

required_files=(
    main.py
    config.py
    pairing.py
    worker.py
    api_client.py
    journal.py
    requirements.txt
)
adapter_files=(
    __init__.py
    base.py
    escpos.py
    file.py
    linux.py
    windows.py
)

for source_file in "${required_files[@]}"; do
    if [[ ! -f "$SCRIPT_DIR/$source_file" ]]; then
        echo "[ERRO] Arquivo do agente ausente: $source_file" >&2
        exit 1
    fi
done
for source_file in "${adapter_files[@]}"; do
    if [[ ! -f "$SCRIPT_DIR/adapters/$source_file" ]]; then
        echo "[ERRO] Adaptador ausente: adapters/$source_file" >&2
        exit 1
    fi
done

echo "[KÔMA] Instalando o agente local em $INSTALL_DIR"
systemctl --user stop koma-print-agent.service >/dev/null 2>&1 || true
mkdir -p "$INSTALL_DIR" "$ADAPTER_DIR" "$UNIT_DIR"

for source_file in "${required_files[@]}"; do
    install -m 0644 "$SCRIPT_DIR/$source_file" "$INSTALL_DIR/$source_file"
done
for source_file in "${adapter_files[@]}"; do
    install -m 0644 "$SCRIPT_DIR/adapters/$source_file" "$ADAPTER_DIR/$source_file"
done

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
    "$PYTHON_BIN" -m venv "$VENV_DIR"
fi
"$VENV_DIR/bin/python" -m pip install \
    --disable-pip-version-check \
    --quiet \
    -r "$INSTALL_DIR/requirements.txt"

echo "[KÔMA] Conectando este computador ao restaurante..."
(
    cd "$INSTALL_DIR"
    "$VENV_DIR/bin/python" main.py --pair-only
)

{
    printf '%s\n' \
        '[Unit]' \
        'Description=Kôma Print Agent' \
        'Wants=network-online.target' \
        'After=network-online.target' \
        '' \
        '[Service]' \
        'Type=simple' \
        "WorkingDirectory=$INSTALL_DIR" \
        'Environment=PYTHONUNBUFFERED=1' \
        'Environment=KOMA_ADAPTER=auto' \
        'Environment=PATH=/usr/local/bin:/usr/bin:/bin' \
        "ExecStart=$VENV_DIR/bin/python $INSTALL_DIR/main.py" \
        'Restart=always' \
        'RestartSec=5' \
        'TimeoutStopSec=15' \
        'NoNewPrivileges=true' \
        'PrivateTmp=true' \
        'UMask=0077' \
        '' \
        '[Install]' \
        'WantedBy=default.target'
} > "$UNIT_FILE"
chmod 0644 "$UNIT_FILE"

systemctl --user daemon-reload
systemctl --user enable --now koma-print-agent.service

if ! systemctl --user is-active --quiet koma-print-agent.service; then
    echo "[ERRO] O serviço não permaneceu ativo. Últimos registros:" >&2
    journalctl --user -u koma-print-agent.service -n 30 --no-pager >&2 || true
    exit 1
fi

echo
echo "[OK] Kôma Print Agent instalado e ativo."
echo "[OK] Ele iniciará automaticamente com sua sessão e não depende do navegador."
if command -v lpstat >/dev/null 2>&1; then
    echo "[KÔMA] Impressoras CUPS detectadas:"
    lpstat -e 2>/dev/null || echo "  nenhuma fila CUPS encontrada"
fi
echo "[KÔMA] Diagnóstico: journalctl --user -u koma-print-agent.service -f"

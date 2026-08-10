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
APPLICATION_DIR="$DATA_HOME/applications"
DESKTOP_FILE="$APPLICATION_DIR/koma-print-agent.desktop"

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
    dispatcher.py
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
        echo "[ERRO] Arquivo de impressão ausente: $source_file" >&2
        exit 1
    fi
done
for source_file in "${adapter_files[@]}"; do
    if [[ ! -f "$SCRIPT_DIR/adapters/$source_file" ]]; then
        echo "[ERRO] Adaptador ausente: adapters/$source_file" >&2
        exit 1
    fi
done

echo "[KÔMA] Preparando a impressão neste computador..."
systemctl --user stop koma-print-agent.service >/dev/null 2>&1 || true
mkdir -p "$INSTALL_DIR" "$ADAPTER_DIR" "$UNIT_DIR"

for source_file in "${required_files[@]}"; do
    install -m 0644 "$SCRIPT_DIR/$source_file" "$INSTALL_DIR/$source_file"
done
for source_file in "${adapter_files[@]}"; do
    install -m 0644 "$SCRIPT_DIR/adapters/$source_file" "$ADAPTER_DIR/$source_file"
done
install -m 0755 \
    "$SCRIPT_DIR/koma-print-launcher.sh" \
    "$INSTALL_DIR/koma-print-launcher.sh"

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
        'Description=Integração de impressão do Kôma' \
        'Wants=network-online.target' \
        'After=network-online.target' \
        '' \
        '[Service]' \
        'Type=simple' \
        "WorkingDirectory=$INSTALL_DIR" \
        'Environment=PYTHONUNBUFFERED=1' \
        'Environment=KOMA_ADAPTER=auto' \
        'Environment=KOMA_HB_SEC=5' \
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

mkdir -p "$APPLICATION_DIR"
{
    printf '%s\n' \
        '[Desktop Entry]' \
        'Name=Kôma Impressão' \
        'Comment=Prepara a impressão USB do Kôma' \
        'Type=Application' \
        'NoDisplay=true' \
        "Exec=\"$INSTALL_DIR/koma-print-launcher.sh\" %u" \
        'MimeType=x-scheme-handler/koma-print;' \
        'Terminal=false'
} > "$DESKTOP_FILE"
chmod 0644 "$DESKTOP_FILE"
if command -v xdg-mime >/dev/null 2>&1; then
    xdg-mime default \
        koma-print-agent.desktop \
        x-scheme-handler/koma-print >/dev/null 2>&1 || true
fi

if ! systemctl --user is-active --quiet koma-print-agent.service; then
    echo "[ERRO] O serviço não permaneceu ativo. Últimos registros:" >&2
    journalctl --user -u koma-print-agent.service -n 30 --no-pager >&2 || true
    exit 1
fi

echo
echo "[OK] Impressão configurada e pronta para iniciar automaticamente."
echo "[OK] Agora conecte a impressora USB e use o botão de busca no Kôma."
if command -v lpstat >/dev/null 2>&1; then
    echo "[KÔMA] Impressoras CUPS detectadas:"
    lpstat -e 2>/dev/null || echo "  nenhuma fila CUPS encontrada"
fi
echo "[KÔMA] Diagnóstico: journalctl --user -u koma-print-agent.service -f"

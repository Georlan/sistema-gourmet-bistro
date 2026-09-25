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

ACTION="install"
for arg in "$@"; do
    case "$arg" in
        --update) ACTION="update" ;;
        --uninstall) ACTION="uninstall" ;;
        --purge) ACTION="purge" ;;
        -h|--help)
            echo "Uso: $0 [--update | --uninstall | --purge]"
            exit 0
            ;;
    esac
done

if [[ "$ACTION" == "uninstall" || "$ACTION" == "purge" ]]; then
    echo "[KÔMA] Desinstalando o Kôma Print Agent..."
    systemctl --user stop koma-print-agent.service >/dev/null 2>&1 || true
    systemctl --user disable koma-print-agent.service >/dev/null 2>&1 || true
    rm -f "$UNIT_FILE"
    systemctl --user daemon-reload >/dev/null 2>&1 || true
    rm -f "$DESKTOP_FILE"
    if command -v xdg-mime >/dev/null 2>&1; then
        xdg-mime uninstall "$DESKTOP_FILE" >/dev/null 2>&1 || true
    fi
    if [[ "$ACTION" == "purge" ]]; then
        rm -rf "$INSTALL_DIR"
        rm -rf "$CONFIG_HOME/koma-print-agent"
        echo "[OK] Kôma Print Agent e todas as configurações foram removidos."
    else
        echo "[OK] Kôma Print Agent desinstalado com sucesso."
        echo "[INFO] Tokens e configurações preservados em $CONFIG_HOME/koma-print-agent e $INSTALL_DIR."
    fi
    exit 0
fi

# Se executado via curl em comando único direto, baixa o pacote automaticamente
if [[ ! -f "$SCRIPT_DIR/main.py" ]]; then
    echo "[KÔMA] Baixando a versão correta do Kôma Print Agent..."
    DOWNLOAD_TMP="$(mktemp -d)"
    trap 'rm -rf "$DOWNLOAD_TMP"' EXIT
    curl -fsSL "https://github.com/Georlan/sistema-gourmet-bistro/tarball/main" | tar -xz -C "$DOWNLOAD_TMP" --strip-components=1
    SCRIPT_DIR="$DOWNLOAD_TMP/print-agent"
fi

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
    wake_listener.py
    simulator.py
    dispatcher.py
    api_client.py
    journal.py
    requirements.txt
    requirements.lock
    agent_runtime.py
    endpoints.py
)
adapter_files=(
    __init__.py
    base.py
    escpos.py
    file.py
    linux.py
    windows.py
    transports.py
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

if [[ "$ACTION" == "update" ]]; then
    echo "[KÔMA] Atualizando o Kôma Print Agent..."
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

    if [[ -x "$VENV_DIR/bin/python" ]]; then
        "$VENV_DIR/bin/python" -m pip install \
            --disable-pip-version-check \
            --quiet \
            -r "$INSTALL_DIR/requirements.txt"
    fi
    systemctl --user daemon-reload
    systemctl --user restart koma-print-agent.service
    echo "[OK] Kôma Print Agent atualizado com sucesso."
    exit 0
fi

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

# Preserva credencial existente se já estiver pareado
CREDENTIALS_FILE="$CONFIG_HOME/koma-print-agent/credentials.json"
if [[ -f "$INSTALL_DIR/config.json" ]] || [[ -f "$CREDENTIALS_FILE" ]]; then
    echo "[KÔMA] Credencial local detectada; validando conexão..."
    (
        cd "$INSTALL_DIR"
        "$VENV_DIR/bin/python" main.py --pair-only || true
    )
else
    echo "[KÔMA] Conectando este computador ao restaurante..."
    (
        cd "$INSTALL_DIR"
        "$VENV_DIR/bin/python" main.py --pair-only
    )
fi

{
    printf '%s\n' \
        '[Unit]' \
        'Description=Integração de impressão do Kôma (Kôma Print Agent)' \
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
        'RestartSec=3' \
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

# Garante persistência após reboot mesmo sem sessão gráfica aberta
loginctl enable-linger "$USER" >/dev/null 2>&1 || true

mkdir -p "$APPLICATION_DIR"
{
    printf '%s\n' \
        '[Desktop Entry]' \
        'Name=Kôma Impressão' \
        'Comment=Prepara a impressão do Kôma' \
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
echo "[OK] Impressão configurada e pronta para iniciar automaticamente em segundo plano."
echo "[OK] O serviço reiniciará automaticamente e continuará ativo após reinicializações."
if command -v lpstat >/dev/null 2>&1; then
    echo "[KÔMA] Impressoras CUPS detectadas:"
    lpstat -e 2>/dev/null || echo "  nenhuma fila CUPS encontrada"
fi
echo "[KÔMA] Diagnóstico: journalctl --user -u koma-print-agent.service -f"

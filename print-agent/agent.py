#!/usr/bin/env python3
"""
Agente de Impressão Local — Kôma Bistrô
=========================================
Roda em loop infinito na máquina do restaurante.
Consulta periodicamente a API do backend em busca de jobs de impressão
pendentes e os despacha diretamente para a impressora física via Spooler
(Windows) ou simulação ESC/POS no terminal (Linux/macOS).

Uso:
    # Windows
    python agent.py --api-url https://seu-backend.com --token SEU_TOKEN --printer "EPSON TM-T20III"

    # Linux (desenvolvimento / simulação)
    python agent.py --api-url http://localhost:8000 --token SEU_TOKEN

Variáveis de ambiente (alternativa a argumentos):
    KOMA_API_URL   — URL base da API (sem barra final)
    KOMA_TOKEN     — Bearer token de autenticação
    KOMA_PRINTER   — Nome exato da impressora no Spooler do SO
    KOMA_POLL_SEC  — Intervalo de polling em segundos (padrão: 2)
    KOMA_HB_SEC    — Intervalo de heartbeat em segundos (padrão: 30)
"""

import argparse
import logging
import os
import platform
import sys
import time
from datetime import datetime, timezone

import requests

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("print-agent")

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------
IS_WINDOWS = platform.system() == "Windows"
DEFAULT_POLL_SEC = 2
DEFAULT_HB_SEC = 30

# ---------------------------------------------------------------------------
# Argumentos / configuração
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Agente de impressão local Kôma Bistrô")
    parser.add_argument(
        "--api-url",
        default=os.getenv("KOMA_API_URL", "http://localhost:8000"),
        help="URL base da API do backend (sem barra final)",
    )
    parser.add_argument(
        "--token",
        default=os.getenv("KOMA_TOKEN", ""),
        help="Bearer token de autenticação (obrigatório)",
    )
    parser.add_argument(
        "--printer",
        default=os.getenv("KOMA_PRINTER", ""),
        help="Nome exato da impressora no Spooler do SO",
    )
    parser.add_argument(
        "--poll-sec",
        type=float,
        default=float(os.getenv("KOMA_POLL_SEC", DEFAULT_POLL_SEC)),
        help="Intervalo de polling em segundos (padrão: 2)",
    )
    parser.add_argument(
        "--hb-sec",
        type=float,
        default=float(os.getenv("KOMA_HB_SEC", DEFAULT_HB_SEC)),
        help="Intervalo de heartbeat em segundos (padrão: 30)",
    )
    return parser.parse_args()


# ---------------------------------------------------------------------------
# Impressão
# ---------------------------------------------------------------------------

def imprimir_raw(printer_name: str, raw_data: bytes) -> None:
    """
    Envia bytes ESC/POS diretamente para a impressora.

    Windows: usa win32print → envia via Spooler em modo RAW (sem processamento GDI).
    Linux/macOS: exibe log simulado dos bytes recebidos no terminal.
    """
    if IS_WINDOWS:
        _imprimir_windows(printer_name, raw_data)
    else:
        _imprimir_linux_simulacao(printer_name, raw_data)


def _imprimir_windows(printer_name: str, raw_data: bytes) -> None:
    """Envia dados ESC/POS em modo RAW para o Spooler do Windows."""
    try:
        import win32print  # type: ignore
    except ImportError:
        raise RuntimeError(
            "win32print não encontrado. Execute: pip install pywin32"
        )

    if not printer_name:
        # Usa a impressora padrão do sistema se nenhuma foi especificada
        printer_name = win32print.GetDefaultPrinter()
        log.warning("Impressora não especificada. Usando padrão do sistema: %s", printer_name)

    log.info("Windows › enviando %d bytes para '%s' via RAW Spooler...", len(raw_data), printer_name)

    handle = win32print.OpenPrinter(printer_name)
    try:
        job_id = win32print.StartDocPrinter(
            handle,
            1,
            (
                f"Kôma-Job-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
                None,
                "RAW",
            ),
        )
        win32print.StartPagePrinter(handle)
        win32print.WritePrinter(handle, raw_data)
        win32print.EndPagePrinter(handle)
        win32print.EndDocPrinter(handle)
        log.info("Windows › job %d enviado com sucesso (%d bytes).", job_id, len(raw_data))
    finally:
        win32print.ClosePrinter(handle)


def _imprimir_linux_simulacao(printer_name: str, raw_data: bytes) -> None:
    """
    Linux / macOS — modo de simulação/desenvolvimento.

    Interpreta os bytes ESC/POS recebidos e exibe comandos
    decodificados no terminal para facilitar depuração.
    """
    destino = printer_name or "SIMULADOR"
    log.info("Linux › simulando impressão em '%s' (%d bytes)", destino, len(raw_data))

    # Tenta exibir o conteúdo de texto embutido nos bytes
    linhas = []
    buffer_texto = []

    i = 0
    while i < len(raw_data):
        byte = raw_data[i]

        # ESC (0x1B) — início de sequência de comando
        if byte == 0x1B:
            if buffer_texto:
                linhas.append("".join(buffer_texto))
                buffer_texto = []
            # Identifica comandos ESC comuns
            if i + 1 < len(raw_data):
                next_byte = raw_data[i + 1]
                if next_byte == ord("@"):
                    linhas.append("[CMD: ESC @ — Reset da impressora]")
                    i += 2
                    continue
                elif next_byte == ord("!"):
                    linhas.append("[CMD: ESC ! — Seleção de modo de impressão]")
                    i += 3
                    continue
                elif next_byte == ord("a"):
                    alinhamento = {0: "ESQUERDA", 1: "CENTRO", 2: "DIREITA"}.get(
                        raw_data[i + 2] if i + 2 < len(raw_data) else 0, "?"
                    )
                    linhas.append(f"[CMD: ESC a — Alinhamento: {alinhamento}]")
                    i += 3
                    continue
                elif next_byte == ord("E"):
                    negrito = raw_data[i + 2] if i + 2 < len(raw_data) else 0
                    linhas.append(f"[CMD: ESC E {negrito} — Negrito: {'ON' if negrito else 'OFF'}]")
                    i += 3
                    continue
            linhas.append(f"[CMD: ESC 0x{raw_data[i+1]:02X}]")
            i += 2
            continue

        # GS (0x1D) — comandos de código de barras / corte de papel
        if byte == 0x1D:
            if buffer_texto:
                linhas.append("".join(buffer_texto))
                buffer_texto = []
            if i + 1 < len(raw_data) and raw_data[i + 1] == ord("V"):
                linhas.append("[CMD: GS V — Corte de papel]")
                i += 3
                continue
            linhas.append(f"[CMD: GS 0x{raw_data[i+1]:02X}]")
            i += 2
            continue

        # LF (0x0A) — nova linha
        if byte == 0x0A:
            linhas.append("".join(buffer_texto))
            buffer_texto = []
            i += 1
            continue

        # CR (0x0D) — ignora
        if byte == 0x0D:
            i += 1
            continue

        # Texto ASCII imprimível
        if 0x20 <= byte <= 0x7E:
            buffer_texto.append(chr(byte))
            i += 1
            continue

        # Byte desconhecido
        if buffer_texto:
            linhas.append("".join(buffer_texto))
            buffer_texto = []
        linhas.append(f"[BYTE: 0x{byte:02X}]")
        i += 1

    if buffer_texto:
        linhas.append("".join(buffer_texto))

    # Exibe no terminal
    separador = "─" * 48
    print(f"\n{separador}")
    print(f"  🖨  IMPRESSORA (simulação): {destino}")
    print(separador)
    for linha in linhas:
        if linha:
            print(f"  {linha}")
    print(f"{separador}\n")


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

class ApiClient:
    """Wrapper de requests com autenticação e tratamento de erros."""

    def __init__(self, base_url: str, token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "User-Agent": "koma-print-agent/1.0",
            }
        )

    def _url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    def next_job(self) -> dict | None:
        """
        GET /api/print-agents/jobs/next
        Retorna o próximo job pendente ou None se não houver.
        """
        try:
            resp = self.session.get(self._url("/api/print-agents/jobs/next"), timeout=8)
            if resp.status_code == 204 or resp.status_code == 404:
                return None
            resp.raise_for_status()
            data = resp.json()
            # Aceita tanto {"job": {...}} quanto o objeto direto
            return data.get("job", data) if isinstance(data, dict) else None
        except requests.exceptions.ConnectionError:
            log.debug("Servidor indisponível — aguardando próximo ciclo.")
            return None
        except requests.exceptions.Timeout:
            log.warning("Timeout ao buscar próximo job.")
            return None
        except Exception as exc:
            log.error("Erro inesperado ao buscar job: %s", exc)
            return None

    def confirm_job(self, job_id: str | int, success: bool, error_msg: str = "") -> bool:
        """
        POST /api/print-agents/jobs/{job_id}/status
        Informa ao backend se a impressão foi bem-sucedida ou falhou.
        """
        payload = {
            "status": "printed" if success else "failed",
            "error": error_msg,
            "printed_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            resp = self.session.post(
                self._url(f"/api/print-agents/jobs/{job_id}/status"),
                json=payload,
                timeout=8,
            )
            resp.raise_for_status()
            return True
        except Exception as exc:
            log.error("Falha ao confirmar job %s: %s", job_id, exc)
            return False

    def heartbeat(self, printer_name: str) -> bool:
        """
        POST /api/print-agents/heartbeat
        Mantém o agente registrado como ativo no backend.
        """
        payload = {
            "printer_name": printer_name or platform.node(),
            "os": platform.system(),
            "hostname": platform.node(),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "version": "1.0.0",
        }
        try:
            resp = self.session.post(
                self._url("/api/print-agents/heartbeat"),
                json=payload,
                timeout=8,
            )
            resp.raise_for_status()
            return True
        except Exception as exc:
            log.warning("Heartbeat falhou: %s", exc)
            return False


# ---------------------------------------------------------------------------
# Loop principal
# ---------------------------------------------------------------------------

def processar_job(job: dict, printer_name: str, api: ApiClient) -> None:
    """
    Processa um único job de impressão:
      1. Extrai os bytes RAW do payload
      2. Chama imprimir_raw()
      3. Confirma o resultado via API
    """
    job_id = job.get("id") or job.get("job_id")
    nome_impressora = job.get("printer_name") or printer_name
    raw_b64 = job.get("raw_data") or job.get("ticket_text") or ""

    if not job_id:
        log.error("Job sem ID recebido — ignorando: %s", job)
        return

    log.info("Job #%s recebido → impressora: '%s'", job_id, nome_impressora or "padrão")

    # Decodifica os dados de impressão
    try:
        if isinstance(raw_b64, bytes):
            raw_bytes = raw_b64
        elif isinstance(raw_b64, str):
            # Tenta base64 primeiro; se falhar, interpreta como texto ESC/POS
            try:
                import base64
                raw_bytes = base64.b64decode(raw_b64)
            except Exception:
                raw_bytes = raw_b64.encode("utf-8", errors="replace")
        else:
            raise ValueError(f"Formato de dados inválido: {type(raw_b64)}")
    except Exception as exc:
        msg = f"Erro ao decodificar dados do job: {exc}"
        log.error(msg)
        api.confirm_job(job_id, success=False, error_msg=msg)
        return

    # Tenta imprimir
    try:
        imprimir_raw(nome_impressora, raw_bytes)
        log.info("Job #%s impresso com sucesso ✓", job_id)
        api.confirm_job(job_id, success=True)
    except Exception as exc:
        msg = f"Falha ao imprimir job #{job_id}: {exc}"
        log.error(msg)
        api.confirm_job(job_id, success=False, error_msg=str(exc))


def main() -> None:
    args = parse_args()

    if not args.token:
        log.error("Token de autenticação não fornecido. Use --token ou KOMA_TOKEN.")
        sys.exit(1)

    api = ApiClient(base_url=args.api_url, token=args.token)
    printer_name = args.printer

    log.info("=" * 56)
    log.info("  Kôma Print Agent iniciando")
    log.info("  API URL  : %s", args.api_url)
    log.info("  Impressora: %s", printer_name or "(usar padrão do SO)")
    log.info("  Polling  : %.1fs | Heartbeat: %.1fs", args.poll_sec, args.hb_sec)
    log.info("  Sistema  : %s %s", platform.system(), platform.release())
    log.info("=" * 56)

    last_heartbeat = 0.0

    # Heartbeat inicial
    if api.heartbeat(printer_name):
        log.info("Heartbeat inicial enviado com sucesso.")
        last_heartbeat = time.monotonic()
    else:
        log.warning("Heartbeat inicial falhou — prosseguindo assim mesmo.")

    # ─── Loop infinito de polling ─────────────────────────────────────────
    while True:
        now = time.monotonic()

        # Heartbeat periódico
        if now - last_heartbeat >= args.hb_sec:
            if api.heartbeat(printer_name):
                log.debug("Heartbeat enviado.")
            last_heartbeat = time.monotonic()

        # Busca próximo job
        job = api.next_job()
        if job:
            processar_job(job, printer_name, api)
        else:
            log.debug("Nenhum job pendente.")

        time.sleep(args.poll_sec)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log.info("Agente encerrado pelo usuário (Ctrl+C).")
        sys.exit(0)

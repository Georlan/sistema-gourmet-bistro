"""
Worker principal do Kôma Print Agent.
Gerencia a execução em loop (polling + heartbeat) com resiliência e idempotência local.
"""

import time
import logging
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from pathlib import Path
from config import AgentConfig, is_automatic_printer_name
from api_client import AgentAuthenticationError, KomaApiClient
from journal import PrintJournal
from adapters import get_adapter
from dispatcher import dispatch_claimed_jobs

log = logging.getLogger("print-agent.worker")

RECONCILIATION_INTERVAL_SECONDS = 5.0
DIAGNOSTIC_REFRESH_INTERVAL_SECONDS = 5.0
NOT_READY_LOG_INTERVAL_SECONDS = 300.0
MAX_DIAGNOSTIC_AGE_SECONDS = 30.0


class AgentMaintenance:
    """One owner for hardware discovery and control HTTP, outside the print lane.

    Sessions are never shared across threads. A short-lived ready snapshot lets
    the spooler accept tickets while Windows runs its slow PnP discovery.
    """

    def __init__(self, config, adapter, hardware_lock):
        self.config = config
        self.adapter = adapter
        self.hardware_lock = hardware_lock
        self.client = KomaApiClient(config.api_url, config.agent_token)
        self.snapshot = ({}, 0.0)
        self.last_heartbeat = 0.0
        self.last_command_id = ""
        self.last_command_result = None
        self.refresh()

    def refresh(self):
        started = time.monotonic()
        try:
            diagnostics = self.adapter.get_diagnostics()
        except Exception:
            log.exception("[DIAGNÓSTICO] Não foi possível verificar as impressoras.")
            diagnostics = {"printers": [], "error": "diagnostics_failed"}
        self.snapshot = (diagnostics, time.monotonic())
        try:
            bind_single_ready_windows_usb(self.config, diagnostics)
        except (OSError, ValueError):
            log.exception("[IMPRESSORA] Não foi possível memorizar a fila USB.")
        log.info("[LATÊNCIA] diagnostico_hardware_ms=%s", round((time.monotonic() - started) * 1000))

    def tick(self):
        now = time.monotonic()
        if now - self.snapshot[1] >= DIAGNOSTIC_REFRESH_INTERVAL_SECONDS:
            self.refresh()
        if now - self.last_heartbeat < self.config.heartbeat_interval_seconds:
            return
        self.last_heartbeat = now
        response = self.client.heartbeat(diagnostics=self.snapshot[0])
        command = response.get("command") if isinstance(response, dict) else None
        if not isinstance(command, dict) or not command.get("id"):
            return
        command_id = str(command["id"])
        if command_id != self.last_command_id:
            # Explicit hardware configuration may pause submission; routine
            # diagnostic/heartbeat calls never hold this lock.
            with self.hardware_lock:
                result = execute_agent_command(self.adapter, command)
                if result.get("success") and result.get("printer_name"):
                    try:
                        self.config.remember_printer(result["printer_name"])
                    except (OSError, ValueError):
                        result = {**result, "success": False, "code": "printer_config_save_failed",
                                  "message": "Não foi possível salvar a impressora neste computador."}
                self.last_command_id, self.last_command_result = command_id, result
                if isinstance(result.get("diagnostics"), dict):
                    self.snapshot = (result["diagnostics"], time.monotonic())
        if self.client.complete_command(command_id, self.last_command_result):
            self.last_command_id, self.last_command_result = "", None


def bind_single_ready_windows_usb(
    config: AgentConfig,
    diagnostics: dict,
) -> str:
    """Seleciona automaticamente uma única fila USB pronta no Windows."""
    if str(diagnostics.get("platform") or "").casefold() != "windows":
        return ""
    current = str(config.printers.get("PADRAO") or "Padrão")
    if not is_automatic_printer_name(current):
        return ""

    ready_usb = [
        printer
        for printer in diagnostics.get("printers") or []
        if (
            isinstance(printer, dict)
            and printer.get("connection") == "usb"
            and printer.get("available") is True
            and printer.get("present") is True
            and printer.get("configured") is True
            and str(printer.get("name") or "").strip()
        )
    ]
    if len(ready_usb) != 1:
        return ""
    printer_name = str(ready_usb[0]["name"]).strip()
    config.remember_printer(printer_name)
    log.info(
        "[IMPRESSORA] Fila USB '%s' selecionada automaticamente sem "
        "alterar a impressora padrão do Windows.",
        printer_name,
    )
    return printer_name


def _diagnostics_have_ready_printer(diagnostics: dict) -> bool:
    printers = diagnostics.get("printers") or []
    return any(
        printer.get("available") is True
        and printer.get("present") is True
        and printer.get("configured") is True
        for printer in printers
        if isinstance(printer, dict)
    )


def execute_agent_command(adapter, command: dict) -> dict:
    """Executa somente comandos locais conhecidos e sempre devolve diagnóstico."""
    action = str(command.get("action") or "")
    if action != "connect_usb":
        return {
            "success": False,
            "code": "unsupported_command",
            "message": "O agente recebeu um comando que não reconhece.",
            "printer_name": None,
            "diagnostics": adapter.get_diagnostics(),
        }
    try:
        return adapter.connect_usb(
            requested_name=str(command.get("printer_name") or ""),
            requested_uri=str(command.get("printer_uri") or ""),
        )
    except Exception:
        log.exception(
            "[COMANDO USB] Falha inesperada ao conectar impressora."
        )
        return {
            "success": False,
            "code": "command_failed",
            "message": (
                "Não foi possível concluir a conexão automática com o USB."
            ),
            "printer_name": None,
            "diagnostics": adapter.get_diagnostics(),
        }


def process_unconfirmed_journal_jobs(client: KomaApiClient, journal: PrintJournal):
    """
    Verifica e reenvia confirmações (complete_job) para o backend de trabalhos
    que já foram aceitos pelo spooler, mas a conexão caiu antes de notificar o servidor.
    """
    unconfirmed = journal.get_unconfirmed_printed_jobs()
    if len(unconfirmed) > 1:
        confirmations = [
            {
                "job_id": item["job_id"],
                "printer_name": item["printer_name"] or "Padrão",
            }
            for item in unconfirmed[:10]
        ]
        confirmed_ids = client.complete_jobs(confirmations)
        for item in confirmations:
            job_id = item["job_id"]
            if job_id in confirmed_ids:
                journal.mark_backend_confirmed(job_id)
                log.info(
                    "[RESILIÊNCIA] Job '%s' re-confirmado em lote com "
                    "SUCESSO no backend!",
                    job_id,
                )
        return

    for item in unconfirmed:
        job_id = item["job_id"]
        printer = item["printer_name"] or "Padrão"
        log.info(f"[RESILIÊNCIA] Tentando re-confirmar no backend o job '{job_id}' (já aceito pelo spooler)...")
        if client.complete_job(job_id, printer_name=printer):
            journal.mark_backend_confirmed(job_id)
            log.info(f"[RESILIÊNCIA] Job '{job_id}' re-confirmado com SUCESSO no backend!")


def run_agent_loop(config: AgentConfig, max_loops: int = None):
    """Drain tickets independently of slow diagnostics and cloud acknowledgments.

    The journal is committed before queuing acknowledgments. On restart its
    unconfirmed records are replayed without submitting the ticket again.
    """
    client = KomaApiClient(config.api_url, config.agent_token)
    ack_client = KomaApiClient(config.api_url, config.agent_token)
    journal = PrintJournal(db_path=str(Path(config.config_path).resolve().with_name("journal.db")))
    adapter = get_adapter(config.adapter, output_dir=config.output_dir)
    hardware_lock = Lock()
    maintenance = AgentMaintenance(config, adapter, hardware_lock)
    pending = {}
    ack_future = maintenance_future = None
    ack_items = []
    next_ack_at = last_reconciliation = 0.0
    loop_count = 0
    log.info("[AGENTE] Transporte independente; polling=%ss, lote=%s", config.poll_interval_seconds, config.claim_batch_size)

    def collect_ack():
        nonlocal ack_future, next_ack_at
        completed_future, ack_future = ack_future, None
        confirmed = completed_future.result()
        for item in ack_items:
            job_id = item["job_id"]
            if job_id in confirmed:
                journal.mark_backend_confirmed(job_id)
                pending.pop(job_id, None)
        next_ack_at = time.monotonic() + (RECONCILIATION_INTERVAL_SECONDS if len(confirmed) < len(ack_items) else 0)

    try:
        with ThreadPoolExecutor(max_workers=1, thread_name_prefix="koma-control") as control, \
             ThreadPoolExecutor(max_workers=1, thread_name_prefix="koma-ack") as acknowledgments:
            try:
                while max_loops is None or loop_count < max_loops:
                    loop_count += 1
                    should_wait = True
                    try:
                        now = time.monotonic()
                        if maintenance_future is not None and maintenance_future.done():
                            completed_maintenance = maintenance_future
                            maintenance_future = None
                            completed_maintenance.result()  # Propagate revoked credentials.
                        if maintenance_future is None:
                            maintenance_future = control.submit(maintenance.tick)
                        if ack_future is not None and ack_future.done():
                            collect_ack()
                        if now - last_reconciliation >= RECONCILIATION_INTERVAL_SECONDS:
                            for item in journal.get_unconfirmed_printed_jobs():
                                pending[item["job_id"]] = {"job_id": item["job_id"], "printer_name": item["printer_name"] or "Padrão"}
                            last_reconciliation = now

                        diagnostics, checked_at = maintenance.snapshot
                        ready = not bool(getattr(adapter, "requires_physical_printer", True)) or (
                            now - checked_at <= MAX_DIAGNOSTIC_AGE_SECONDS
                            and _diagnostics_have_ready_printer(diagnostics)
                        )
                        if ready:
                            started = time.perf_counter()
                            jobs = client.claim_jobs(config.claim_batch_size)
                            claim_ms = round((time.perf_counter() - started) * 1000)
                            if jobs:
                                with hardware_lock:
                                    outcomes = dispatch_claimed_jobs(adapter, journal, jobs, dict(config.printers), config.max_parallel_printers)
                                failures = [item for item in outcomes if item["state"] == "failed"]
                                releases = [item["job"]["id"] for item in outcomes if item["state"] == "release"]
                                for item in outcomes:
                                    if item["state"] == "accepted":
                                        job_id = item["job"]["id"]
                                        pending[job_id] = {"job_id": job_id, "printer_name": item["printer_name"]}
                                        log.info("[LATÊNCIA] job=%s fila_ms=%s reserva_api_ms=%s envio_spooler_ms=%s",
                                                 job_id, item["job"].get("queue_latency_ms"), claim_ms, item["submit_ms"])
                                for item in failures:
                                    client.fail_job(item["job"]["id"], error_msg="Falha ao enviar à impressora local.")
                                if releases:
                                    client.release_jobs(releases)
                                if failures:
                                    maintenance.snapshot = ({}, 0.0)
                                should_wait = bool(failures)
                        if ack_future is None and pending and now >= next_ack_at:
                            ack_items = list(pending.values())[:10]
                            ack_future = acknowledgments.submit(ack_client.complete_jobs, ack_items)
                    except AgentAuthenticationError:
                        raise
                    except Exception:
                        log.exception("[AGENTE] Falha transitória; a fila local será reconciliada.")
                    if max_loops is not None and loop_count >= max_loops:
                        break
                    if should_wait:
                        time.sleep(config.poll_interval_seconds)
            finally:
                # Bounded HTTP timeouts; leave unacknowledged jobs durable on
                # disk. Never clear credentials or the journal during shutdown.
                if ack_future is not None:
                    collect_ack()
                if maintenance_future is not None:
                    maintenance_future.result()
    except KeyboardInterrupt:
        log.info("[AGENTE] Encerrado; confirmações pendentes permanecem no diário local.")
    finally:
        client.session.close()
        ack_client.session.close()
        maintenance.client.session.close()

"""
Worker principal do Kôma Print Agent.
Gerencia a execução em loop (polling + heartbeat) com resiliência, idempotência local
e notificações push instantâneas via WSS Outbound.
"""

import time
import logging
import threading
from config import AgentConfig
from api_client import KomaApiClient
from journal import PrintJournal
from adapters import get_adapter
from wss_client import WssWakeupClient

log = logging.getLogger("print-agent.worker")

RECONCILIATION_INTERVAL_SECONDS = 5.0
DIAGNOSTIC_REFRESH_INTERVAL_SECONDS = 5.0
NOT_READY_LOG_INTERVAL_SECONDS = 30.0


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
    que já saíram fisicamente no papel, mas a conexão caiu antes de notificar o servidor.
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
                    "[RESILIÊNCIA] Job '%s' re-confirmado em lote com SUCESSO no backend!",
                    job_id,
                )
        return

    for item in unconfirmed:
        job_id = item["job_id"]
        printer = item["printer_name"] or "Padrão"
        log.info(f"[RESILIÊNCIA] Tentando re-confirmar no backend o job '{job_id}' (já impresso fisicamente)...")
        if client.complete_job(job_id, printer_name=printer):
            journal.mark_backend_confirmed(job_id)
            log.info(f"[RESILIÊNCIA] Job '{job_id}' re-confirmado com SUCESSO no backend!")


def run_agent_loop(config: AgentConfig, max_loops: int = None):
    """
    Loop principal do agente de impressão.
    Se max_loops for informado, executa essa quantidade de iterações e encerra (útil em testes).
    """
    client = KomaApiClient(config.api_url, config.agent_token)
    journal = PrintJournal(db_path="journal.db")
    adapter = get_adapter(config.adapter, output_dir=config.output_dir)

    wake_event = threading.Event()
    wss_client = WssWakeupClient(config.api_url, config.agent_token, wake_event)
    wss_client.start()

    print("=========================================================")
    print("      KÔMA PRINT AGENT — DAEMON MULTIPLATAFORMA          ")
    print("=========================================================")
    print(f"API Backend: {config.api_url}")
    print(f"Agent ID:    {config.agent_id}")
    print(f"Adaptador:   {adapter.__class__.__name__}")
    print(f"Polling:     {config.poll_interval_seconds}s (com WSS Outbound Push)")
    print(f"Lote:        até {config.claim_batch_size} trabalho(s)")
    print("=========================================================")

    last_heartbeat = 0.0
    last_diagnostics_refresh = 0.0
    last_reconciliation = 0.0
    last_not_ready_log = 0.0
    latest_diagnostics = {
        "adapter": adapter.__class__.__name__,
        "platform": "unknown",
        "printers": [],
        "default_printer": None,
        "error": None,
    }
    last_command_id = ""
    last_command_result = None
    loop_count = 0

    try:
        while True:
            should_wait = True
            try:
                now = time.time()
                diagnostics_changed = False

                should_refresh_diagnostics = (
                    now - last_diagnostics_refresh
                    >= DIAGNOSTIC_REFRESH_INTERVAL_SECONDS
                )
                if should_refresh_diagnostics:
                    try:
                        refreshed_diagnostics = adapter.get_diagnostics()
                    except Exception as exc:
                        log.warning(
                            "[DIAGNÓSTICO] Não foi possível verificar as "
                            "impressoras locais: %s",
                            exc,
                        )
                        refreshed_diagnostics = {
                            "adapter": adapter.__class__.__name__,
                            "platform": "unknown",
                            "printers": [],
                            "default_printer": None,
                            "error": str(exc)[:300],
                        }
                    diagnostics_changed = (
                        refreshed_diagnostics != latest_diagnostics
                    )
                    latest_diagnostics = refreshed_diagnostics
                    last_diagnostics_refresh = now

                # 1. Enviar heartbeat periódico ou imediatamente quando o cabo ou diagnóstico mudar
                if (
                    diagnostics_changed
                    or now - last_heartbeat >= config.heartbeat_interval_seconds
                ):
                    heartbeat_response = client.heartbeat(
                        diagnostics=latest_diagnostics
                    )
                    last_heartbeat = now
                    command = (
                        heartbeat_response.get("command")
                        if isinstance(heartbeat_response, dict)
                        else None
                    )
                    if isinstance(command, dict) and command.get("id"):
                        command_id = str(command["id"])
                        if (
                            command_id == last_command_id
                            and isinstance(last_command_result, dict)
                        ):
                            command_result = last_command_result
                        else:
                            log.info(
                                "[COMANDO USB] Executando solicitação '%s'.",
                                command_id,
                            )
                            command_result = execute_agent_command(
                                adapter,
                                command,
                            )
                            last_command_id = command_id
                            last_command_result = command_result

                        result_diagnostics = command_result.get("diagnostics")
                        if isinstance(result_diagnostics, dict):
                            latest_diagnostics = result_diagnostics
                            last_diagnostics_refresh = now
                        if client.complete_command(
                            command_id,
                            command_result,
                        ):
                            log.info(
                                "[COMANDO USB] Solicitação '%s' concluída: %s",
                                command_id,
                                command_result.get("message"),
                            )
                            last_command_id = ""
                            last_command_result = None
                        else:
                            log.warning(
                                "[COMANDO USB] Resultado de '%s' aguardando "
                                "confirmação no backend.",
                                command_id,
                            )

                # 2. Reconciliar confirmações pendentes em cadência própria
                if now - last_reconciliation >= RECONCILIATION_INTERVAL_SECONDS:
                    process_unconfirmed_journal_jobs(client, journal)
                    last_reconciliation = now

                requires_physical_printer = bool(
                    getattr(adapter, "requires_physical_printer", True)
                )
                printer_ready = (
                    not requires_physical_printer
                    or _diagnostics_have_ready_printer(latest_diagnostics)
                )
                if not printer_ready:
                    if (
                        now - last_not_ready_log
                        >= NOT_READY_LOG_INTERVAL_SECONDS
                    ):
                        log.warning(
                            "[MODO OCIOSO] Nenhuma impressora física pronta "
                            "no adaptador local. O agente enviará heartbeat, "
                            "mas adiará a busca de novos cupons."
                        )
                        last_not_ready_log = now
                    loop_count += 1
                    if max_loops is not None and loop_count >= max_loops:
                        break
                    wake_event.wait(timeout=config.poll_interval_seconds)
                    wake_event.clear()
                    continue

                # 3. Claim de trabalhos
                claimed_jobs = client.claim_jobs(
                    limit=config.claim_batch_size
                )
                if not claimed_jobs:
                    loop_count += 1
                    if max_loops is not None and loop_count >= max_loops:
                        break
                    if should_wait:
                        wake_event.wait(timeout=config.poll_interval_seconds)
                        wake_event.clear()
                    continue

                # 4. Processar lote de trabalhos
                confirmations = []
                printer_failed = False
                claim_api_ms = 0
                latency_by_job = {}

                for job in claimed_jobs:
                    job_id = str(job.get("id") or "")
                    idempotency_key = str(
                        job.get("idempotency_key") or job_id
                    )

                    if journal.is_printed(
                        job_id,
                        idempotency_key=idempotency_key,
                    ):
                        log.warning(
                            "[IDEMPOTÊNCIA PREVENTIVA] Job '%s' (chave '%s') "
                            "já consta como impresso no banco local.",
                            job_id,
                            idempotency_key,
                        )
                        confirmations.append(
                            {"job_id": job_id, "printer_name": "Padrão (Duplicado)"}
                        )
                        continue

                    job_start = time.perf_counter()
                    res = adapter.print_job(job)
                    cups_ms = round((time.perf_counter() - job_start) * 1000)

                    if res.get("success"):
                        p_name = res.get("printer_name") or "Desconhecida"
                        journal.record_print_success(
                            job_id=job_id,
                            idempotency_key=idempotency_key,
                            printer_name=p_name,
                            confirmed=False,
                        )
                        confirmations.append(
                            {"job_id": job_id, "printer_name": p_name}
                        )
                        latency_by_job[job_id] = {
                            "queue": job.get("queue_latency_ms"),
                            "cups_ms": cups_ms,
                        }
                    else:
                        log.error(
                            "[FALHA IMPRESSÃO] Erro físico ao imprimir job '%s': %s",
                            job_id,
                            res.get("error"),
                        )
                        printer_failed = True
                        break

                confirmation_ms = 0
                confirmed_ids = set()
                if confirmations:
                    confirmation_started = time.perf_counter()
                    confirmed_ids = client.complete_jobs(confirmations)
                    confirmation_ms = round(
                        (time.perf_counter() - confirmation_started) * 1000
                    )

                for item in confirmations:
                    job_id = item["job_id"]
                    latency = latency_by_job.get(job_id, {})
                    if job_id in confirmed_ids:
                        journal.mark_backend_confirmed(job_id)
                        log.info(
                            "[SUCESSO] Job '%s' aceito pelo sistema e confirmado no backend.",
                            job_id,
                        )
                    else:
                        log.warning(
                            "[PENDÊNCIA HTTP] Job '%s' foi aceito pelo sistema, mas a confirmação remota falhou.",
                            job_id,
                        )
                    log.info(
                        "[LATÊNCIA] Job '%s': fila=%s, reserva_lote_api=%sms, envio_cups=%sms, confirmacao_lote_api=%sms",
                        job_id,
                        latency.get("queue", "indisponível"),
                        claim_api_ms,
                        latency.get("cups_ms", 0),
                        confirmation_ms,
                    )

                should_wait = printer_failed

            except KeyboardInterrupt:
                print("\n[DAEMON] Encerrando Kôma Print Agent graciosamente...")
                break
            except Exception as e:
                log.error(f"[ERRO WORKER] Exceção no loop principal: {e}")

            loop_count += 1
            if max_loops is not None and loop_count >= max_loops:
                break

            if should_wait:
                wake_event.wait(timeout=config.poll_interval_seconds)
                wake_event.clear()

    finally:
        log.info("[DAEMON] Finalizando conexão WSS do agente graciosamente...")
        wss_client.stop()

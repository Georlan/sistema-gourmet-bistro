"""
Worker principal do Kôma Print Agent.
Gerencia a execução em loop (polling + heartbeat) com resiliência e idempotência local.
"""

import time
import logging
from config import AgentConfig
from api_client import KomaApiClient
from journal import PrintJournal
from adapters import get_adapter

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
                    "[RESILIÊNCIA] Job '%s' re-confirmado em lote com "
                    "SUCESSO no backend!",
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

    print("=========================================================")
    print("      KÔMA PRINT AGENT — DAEMON MULTIPLATAFORMA          ")
    print("=========================================================")
    print(f"API Backend: {config.api_url}")
    print(f"Agent ID:    {config.agent_id}")
    print(f"Adaptador:   {adapter.__class__.__name__}")
    print(f"Polling:     {config.poll_interval_seconds}s")
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
    loop_count = 0

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

            # 1. Enviar heartbeat periódico ou imediatamente quando o cabo,
            # a fila ou a disponibilidade física mudarem.
            if (
                diagnostics_changed
                or now - last_heartbeat
                >= config.heartbeat_interval_seconds
            ):
                client.heartbeat(diagnostics=latest_diagnostics)
                # Evita repetir heartbeat a cada job quando houver uma falha
                # transitória; a próxima tentativa ocorrerá na cadência normal.
                last_heartbeat = now

            # 2. Reconciliar confirmações pendentes em cadência própria. Fazer
            # isso a cada polling abriria o SQLite sem necessidade.
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
                        "[IMPRESSORA AUSENTE] Conector online, mas nenhuma "
                        "impressora física conectada e configurada foi "
                        "detectada. A fila permanecerá intacta."
                    )
                    last_not_ready_log = now
                loop_count += 1
                if max_loops is not None and loop_count >= max_loops:
                    break
                time.sleep(config.poll_interval_seconds)
                continue

            # 3. Reservar um pequeno lote em uma única ida à nuvem. O envio
            # ao CUPS continua sequencial para preservar a ordem física.
            claim_started = time.perf_counter()
            claimed_jobs = client.claim_jobs(config.claim_batch_size)
            claim_api_ms = round(
                (time.perf_counter() - claim_started) * 1000
            )
            if claimed_jobs:
                log.info(
                    "[LOTE RESERVADO] %s trabalho(s) em %sms",
                    len(claimed_jobs),
                    claim_api_ms,
                )
                confirmations = []
                latency_by_job = {}
                printer_failed = False

                for index, next_job in enumerate(claimed_jobs):
                    job_id = next_job["id"]
                    ikey = next_job.get("idempotency_key", job_id)
                    doc_type = next_job.get(
                        "document_type",
                        "producao",
                    ).upper()
                    dest = next_job.get(
                        "destination",
                        "COZINHA",
                    ).upper()
                    payload = next_job.get("payload_text", "")
                    queue_latency_ms = next_job.get("queue_latency_ms")
                    queue_metric = (
                        f"{queue_latency_ms}ms"
                        if queue_latency_ms is not None
                        else "indisponível"
                    )
                    target_printer = (
                        config.printers.get(dest)
                        or config.printers.get("PADRAO")
                        or "Padrão"
                    )

                    log.info(
                        "[JOB RESERVADO] Job ID '%s' (Tipo: %s, "
                        "Destino: %s, Fila: %s)",
                        job_id,
                        doc_type,
                        dest,
                        queue_metric,
                    )

                    if journal.is_printed(job_id, ikey):
                        log.info(
                            "[IDEMPOTÊNCIA] Job '%s' já foi impresso nesta "
                            "máquina. Não vou imprimir novamente.",
                            job_id,
                        )
                        cups_ms = 0
                        confirmations.append(
                            {
                                "job_id": job_id,
                                "printer_name": target_printer,
                            }
                        )
                    else:
                        log.info(
                            "[ENVIO À IMPRESSORA] Enviando job '%s' para "
                            "'%s' (impressora: '%s')...",
                            job_id,
                            adapter.__class__.__name__,
                            target_printer,
                        )
                        print_started = time.perf_counter()
                        success = adapter.print_ticket(
                            payload,
                            target_printer,
                            doc_type,
                        )
                        cups_ms = round(
                            (time.perf_counter() - print_started) * 1000
                        )
                        if success:
                            # O journal local é gravado antes da confirmação
                            # remota: uma queda de rede nunca causa segunda via.
                            journal.record_print_success(
                                job_id,
                                ikey,
                                target_printer,
                                confirmed=False,
                            )
                            confirmations.append(
                                {
                                    "job_id": job_id,
                                    "printer_name": target_printer,
                                }
                            )
                        else:
                            client.fail_job(
                                job_id,
                                error_msg=(
                                    "Falha no adaptador de impressão "
                                    f"'{adapter.__class__.__name__}'"
                                ),
                            )
                            remaining_ids = [
                                pending_job["id"]
                                for pending_job in claimed_jobs[index + 1:]
                            ]
                            released_ids = client.release_jobs(remaining_ids)
                            log.error(
                                "[FALHA] Job '%s' falhou no adaptador após "
                                "%sms. %s trabalho(s) não enviados foram "
                                "devolvidos à fila.",
                                job_id,
                                cups_ms,
                                len(released_ids),
                            )
                            last_diagnostics_refresh = 0.0
                            printer_failed = True
                            break

                    latency_by_job[job_id] = {
                        "queue": queue_metric,
                        "cups_ms": cups_ms,
                    }

                confirmation_ms = 0
                confirmed_ids = set()
                if confirmations:
                    confirmation_started = time.perf_counter()
                    confirmed_ids = client.complete_jobs(confirmations)
                    confirmation_ms = round(
                        (
                            time.perf_counter()
                            - confirmation_started
                        )
                        * 1000
                    )

                for item in confirmations:
                    job_id = item["job_id"]
                    latency = latency_by_job.get(job_id, {})
                    if job_id in confirmed_ids:
                        journal.mark_backend_confirmed(job_id)
                        log.info(
                            "[SUCESSO] Job '%s' aceito pelo sistema e "
                            "confirmado no backend.",
                            job_id,
                        )
                    else:
                        log.warning(
                            "[PENDÊNCIA HTTP] Job '%s' foi aceito pelo "
                            "sistema, mas a confirmação remota falhou. O "
                            "journal impedirá uma segunda impressão.",
                            job_id,
                        )
                    log.info(
                        "[LATÊNCIA] Job '%s': fila=%s, reserva_lote_api=%sms, "
                        "envio_cups=%sms, confirmacao_lote_api=%sms",
                        job_id,
                        latency.get("queue", "indisponível"),
                        claim_api_ms,
                        latency.get("cups_ms", 0),
                        confirmation_ms,
                    )

                # Se o lote terminou normalmente, consulta o próximo sem
                # aguardar o polling ocioso. Em falha física, força diagnóstico.
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
            time.sleep(config.poll_interval_seconds)

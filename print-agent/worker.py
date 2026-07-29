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


def process_unconfirmed_journal_jobs(client: KomaApiClient, journal: PrintJournal):
    """
    Verifica e reenvia confirmações (complete_job) para o backend de trabalhos
    que já saíram fisicamente no papel, mas a conexão caiu antes de notificar o servidor.
    """
    unconfirmed = journal.get_unconfirmed_printed_jobs()
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
    print("=========================================================")

    last_heartbeat = 0.0
    last_reconciliation = 0.0
    loop_count = 0

    while True:
        should_wait = True
        try:
            now = time.time()

            # 1. Enviar Heartbeat periódico
            if now - last_heartbeat >= config.heartbeat_interval_seconds:
                try:
                    diagnostics = adapter.get_diagnostics()
                except Exception as exc:
                    log.warning(
                        "[DIAGNÓSTICO] Não foi possível verificar as "
                        "impressoras locais: %s",
                        exc,
                    )
                    diagnostics = {
                        "adapter": adapter.__class__.__name__,
                        "platform": "unknown",
                        "printers": [],
                        "default_printer": None,
                        "error": str(exc)[:300],
                    }
                client.heartbeat(diagnostics=diagnostics)
                # Evita repetir heartbeat a cada job quando houver uma falha
                # transitória; a próxima tentativa ocorrerá na cadência normal.
                last_heartbeat = now

            # 2. Reconciliar confirmações pendentes em cadência própria. Fazer
            # isso a cada polling abriria o SQLite sem necessidade.
            if now - last_reconciliation >= RECONCILIATION_INTERVAL_SECONDS:
                process_unconfirmed_journal_jobs(client, journal)
                last_reconciliation = now

            # 3. Buscar e reservar o próximo job em uma única ida à nuvem.
            claim_started = time.perf_counter()
            next_job = client.claim_next_job()
            claim_api_ms = round(
                (time.perf_counter() - claim_started) * 1000
            )
            if next_job:
                job_id = next_job["id"]
                ikey = next_job.get("idempotency_key", job_id)
                doc_type = next_job.get("document_type", "producao").upper()
                dest = next_job.get("destination", "COZINHA").upper()
                payload = next_job.get("payload_text", "")
                queue_latency_ms = next_job.get("queue_latency_ms")
                queue_metric = (
                    f"{queue_latency_ms}ms"
                    if queue_latency_ms is not None
                    else "indisponível"
                )

                log.info(
                    f"[JOB RESERVADO] Job ID '{job_id}' "
                    f"(Tipo: {doc_type}, Destino: {dest}, "
                    f"Fila: {queue_metric}, API: {claim_api_ms}ms)"
                )

                # Checar idempotência local no journal SQLite
                if journal.is_printed(job_id, ikey):
                    log.info(
                        f"[IDEMPOTÊNCIA] Job '{job_id}' já foi impresso nesta "
                        "máquina. Não vou imprimir novamente."
                    )
                    target_printer = (
                        config.printers.get(dest)
                        or config.printers.get("PADRAO")
                        or "Padrão"
                    )
                    if client.complete_job(
                        job_id,
                        printer_name=target_printer,
                    ):
                        journal.mark_backend_confirmed(job_id)
                        should_wait = False
                else:
                    target_printer = (
                        config.printers.get(dest)
                        or config.printers.get("PADRAO")
                        or "Padrão"
                    )
                    log.info(
                        f"[ENVIO À IMPRESSORA] Enviando job '{job_id}' "
                        f"para o adaptador '{adapter.__class__.__name__}' "
                        f"(impressora: '{target_printer}')..."
                    )

                    # Executar impressão física via adaptador da plataforma
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
                        # 1. Registrar sucesso no Journal SQLite local primeiro
                        journal.record_print_success(
                            job_id,
                            ikey,
                            target_printer,
                            confirmed=False,
                        )

                        # 2. Tentar confirmar na API em nuvem. Essa chamada
                        # acontece depois que o cupom já foi entregue ao CUPS.
                        confirmation_started = time.perf_counter()
                        confirmed = client.complete_job(
                            job_id,
                            printer_name=target_printer,
                        )
                        confirmation_ms = round(
                            (
                                time.perf_counter()
                                - confirmation_started
                            )
                            * 1000
                        )
                        if confirmed:
                            journal.mark_backend_confirmed(job_id)
                            log.info(
                                f"[SUCESSO] Job '{job_id}' impresso e "
                                "confirmado com SUCESSO!"
                            )
                        else:
                            log.warning(
                                f"[PENDÊNCIA HTTP] Job '{job_id}' impresso "
                                "no papel, mas a confirmação na API falhou. "
                                "Ficará registrado no journal para reconexão."
                            )

                        log.info(
                            f"[LATÊNCIA] Job '{job_id}': "
                            f"fila={queue_metric}, "
                            f"reserva_api={claim_api_ms}ms, "
                            f"envio_cups={cups_ms}ms, "
                            f"confirmacao_api={confirmation_ms}ms"
                        )

                        # Existe trabalho na fila: consulta o próximo
                        # imediatamente, sem a pausa reservada ao estado ocioso.
                        should_wait = False
                    else:
                        client.fail_job(
                            job_id,
                            error_msg=(
                                "Falha no adaptador de impressão "
                                f"'{adapter.__class__.__name__}'"
                            ),
                        )
                        log.error(
                            f"[FALHA] Impressão do job '{job_id}' falhou "
                            f"no adaptador após {cups_ms}ms."
                        )

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

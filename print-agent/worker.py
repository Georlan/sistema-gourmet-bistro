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
    loop_count = 0

    while True:
        try:
            now = time.time()

            # 1. Enviar Heartbeat periódico
            if now - last_heartbeat >= config.heartbeat_interval_seconds:
                if client.heartbeat():
                    last_heartbeat = now

            # 2. Processar reconciliação de impressões locais não confirmadas
            process_unconfirmed_journal_jobs(client, journal)

            # 3. Consultar próximo job na fila
            next_job = client.get_next_job()
            if next_job:
                job_id = next_job["id"]
                ikey = next_job.get("idempotency_key", job_id)
                doc_type = next_job.get("document_type", "producao").upper()
                dest = next_job.get("destination", "COZINHA").upper()
                payload = next_job.get("payload_text", "")

                log.info(f"[JOB DETECTADO] Job ID '{job_id}' (Tipo: {doc_type}, Destino: {dest})")

                # Checar idempotência local no journal SQLite
                if journal.is_printed(job_id, ikey):
                    log.info(f"[IDEMPOTÊNCIA] Job '{job_id}' já foi impresso fisicamente nesta máquina. Pulu papel e confirmo API...")
                    if client.complete_job(job_id):
                        journal.mark_backend_confirmed(job_id)
                else:
                    # Tentar Claim atômico no servidor
                    claimed_data = client.claim_job(job_id)
                    if claimed_data:
                        target_printer = config.printers.get(dest) or config.printers.get("PADRAO") or "Padrão"
                        log.info(f"[CLAIM ACEITO] Enviando job '{job_id}' para o adaptador '{adapter.__class__.__name__}' (impressora: '{target_printer}')...")

                        # Executar impressão física via adaptador da plataforma
                        success = adapter.print_ticket(payload, target_printer, doc_type)

                        if success:
                            # 1. Registrar sucesso no Journal SQLite local primeiro
                            journal.record_print_success(job_id, ikey, target_printer, confirmed=False)

                            # 2. Tentar confirmar na API em nuvem
                            if client.complete_job(job_id, printer_name=target_printer):
                                journal.mark_backend_confirmed(job_id)
                                log.info(f"[SUCESSO] Job '{job_id}' impresso e confirmado com SUCESSO!")
                            else:
                                log.warning(f"[PENDÊNCIA HTTP] Job '{job_id}' impresso no papel, mas confirmação na API falhou. Ficará registrado no journal para reconexão.")
                        else:
                            client.fail_job(job_id, error_msg=f"Falha no adaptador de impressão '{adapter.__class__.__name__}'")
                            log.error(f"[FALHA] Impressão do job '{job_id}' falhou no adaptador.")

        except KeyboardInterrupt:
            print("\n[DAEMON] Encerrando Kôma Print Agent graciosamente...")
            break
        except Exception as e:
            log.error(f"[ERRO WORKER] Exceção no loop principal: {e}")

        loop_count += 1
        if max_loops is not None and loop_count >= max_loops:
            break

        time.sleep(config.poll_interval_seconds)

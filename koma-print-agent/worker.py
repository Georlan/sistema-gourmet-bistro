import time
from config import AgentConfig
from api_client import KomaApiClient
from adapters import get_adapter

def run_agent_loop(config: AgentConfig):
    """
    Loop principal do Kôma Print Agent:
    1. Envia Heartbeat.
    2. Consulta próximo PrintJob pendente via Polling.
    3. Tenta Claim atômico.
    4. Envia payload para a impressora local via adaptador.
    5. Confirma sucesso (Complete) ou informa falha (Fail).
    """
    client = KomaApiClient(config.api_url, config.agent_token)
    adapter = get_adapter(config.adapter)

    print("================================================")
    print("      KÔMA PRINT AGENT - DAEMON INICIADO        ")
    print("================================================")
    print(f"API Backend: {config.api_url}")
    print(f"Agent ID:    {config.agent_id}")
    print(f"Adaptador:   {config.adapter}")
    print(f"Polling:     {config.poll_interval_seconds}s")
    print("------------------------------------------------")

    while True:
        try:
            # 1. Heartbeat
            client.heartbeat()

            # 2. Busca próximo job pendente
            next_job = client.get_next_job()
            if next_job:
                job_id = next_job["id"]
                doc_type = next_job.get("document_type", "").upper()
                dest = next_job.get("destination", "").upper()
                payload = next_job.get("payload_text", "")

                print(f"[WORKER] Novo trabalho detectado: Job ID '{job_id}' (Tipo: {doc_type}, Destino: {dest})")

                # 3. Realiza Claim atômico
                claimed = client.claim_job(job_id)
                if claimed:
                    target_printer = config.printers.get(dest) or config.printers.get("PADRAO") or "Padrão"
                    print(f"[WORKER] Job '{job_id}' assumido. Enviando para impressora '{target_printer}'...")

                    # 4. Impressão via adaptador
                    success = adapter.print_ticket(payload, target_printer, doc_type)

                    if success:
                        client.complete_job(job_id, printer_name=target_printer)
                        print(f"[WORKER] Job '{job_id}' impresso e confirmado com SUCESSO!")
                    else:
                        client.fail_job(job_id, error_msg=f"Falha ao enviar para impressora '{target_printer}'")
                        print(f"[WORKER] Job '{job_id}' falhou na impressão.")

        except KeyboardInterrupt:
            print("[WORKER] Encerrando Kôma Print Agent...")
            break
        except Exception as e:
            print(f"[WORKER ERROR] Erro no loop de execução: {e}")

        time.sleep(config.poll_interval_seconds)

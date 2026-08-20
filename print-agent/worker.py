"""
Worker principal do Kôma Print Agent.
Gerencia a execução em loop (polling + heartbeat) com resiliência e idempotência local.
"""

import time
import logging
from config import AgentConfig, is_automatic_printer_name
from api_client import AgentAuthenticationError, KomaApiClient
from journal import PrintJournal
from adapters import get_adapter
from dispatcher import dispatch_claimed_jobs

log = logging.getLogger("print-agent.worker")

RECONCILIATION_INTERVAL_SECONDS = 5.0
DIAGNOSTIC_REFRESH_INTERVAL_SECONDS = 5.0
NOT_READY_LOG_INTERVAL_SECONDS = 300.0


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
    print(
        "Paralelismo: até "
        f"{config.max_parallel_printers} impressora(s)"
    )
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

                try:
                    if bind_single_ready_windows_usb(
                        config,
                        latest_diagnostics,
                    ):
                        diagnostics_changed = True
                except (OSError, ValueError) as exc:
                    log.warning(
                        "[IMPRESSORA] Não foi possível memorizar a fila "
                        "USB detectada: %s",
                        exc,
                    )

            # 1. Enviar heartbeat periódico ou imediatamente quando o cabo,
            # a fila ou a disponibilidade física mudarem.
            if (
                diagnostics_changed
                or now - last_heartbeat
                >= config.heartbeat_interval_seconds
            ):
                heartbeat_response = client.heartbeat(
                    diagnostics=latest_diagnostics
                )
                # Evita repetir heartbeat a cada job quando houver uma falha
                # transitória; a próxima tentativa ocorrerá na cadência normal.
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
                        selected_printer = str(
                            command_result.get("printer_name") or ""
                        ).strip()
                        if command_result.get("success") and selected_printer:
                            try:
                                config.remember_printer(selected_printer)
                            except (OSError, ValueError) as exc:
                                log.exception(
                                    "[IMPRESSORA] Falha ao memorizar a fila "
                                    "selecionada."
                                )
                                command_result = {
                                    **command_result,
                                    "success": False,
                                    "code": "printer_config_save_failed",
                                    "message": (
                                        "A impressora foi encontrada, mas o "
                                        "Kôma não conseguiu salvar a escolha "
                                        "neste computador."
                                    ),
                                    "error": str(exc)[:200],
                                }
                        last_command_id = command_id
                        last_command_result = command_result

                    result_diagnostics = command_result.get(
                        "diagnostics"
                    )
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
                outcomes = dispatch_claimed_jobs(
                    adapter,
                    journal,
                    claimed_jobs,
                    config.printers,
                    config.max_parallel_printers,
                )
                confirmations = [
                    {
                        "job_id": item["job"]["id"],
                        "printer_name": item["printer_name"],
                    }
                    for item in outcomes
                    if item["state"] == "accepted"
                ]
                failed = [item for item in outcomes if item["state"] == "failed"]
                release_ids = [
                    item["job"]["id"]
                    for item in outcomes
                    if item["state"] == "release"
                ]
                printer_failed = bool(failed)

                for item in failed:
                    client.fail_job(
                        item["job"]["id"],
                        error_msg=(
                            "Falha no adaptador de impressão "
                            f"'{adapter.__class__.__name__}'"
                        ),
                    )
                if release_ids:
                    client.release_jobs(release_ids)
                if printer_failed:
                    last_diagnostics_refresh = 0.0

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
                    outcome = next(
                        item
                        for item in outcomes
                        if item["job"]["id"] == job_id
                    )
                    queue_latency_ms = outcome["job"].get(
                        "queue_latency_ms"
                    )
                    queue_metric = (
                        f"{queue_latency_ms}ms"
                        if queue_latency_ms is not None
                        else "indisponível"
                    )
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
                        queue_metric,
                        claim_api_ms,
                        outcome.get("submit_ms", 0),
                        confirmation_ms,
                    )

                # Se o lote terminou normalmente, consulta o próximo sem
                # aguardar o polling ocioso. Em falha física, força diagnóstico.
                should_wait = printer_failed

        except KeyboardInterrupt:
            print("\n[DAEMON] Encerrando Kôma Print Agent graciosamente...")
            break
        except AgentAuthenticationError:
            # A camada principal limpa apenas a credencial rejeitada e abre o
            # pareamento. Continuar aqui geraria 401 a cada heartbeat.
            raise
        except Exception as e:
            log.error(f"[ERRO WORKER] Exceção no loop principal: {e}")

        loop_count += 1
        if max_loops is not None and loop_count >= max_loops:
            break

        if should_wait:
            time.sleep(config.poll_interval_seconds)

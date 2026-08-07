"""
Suíte de Testes Automatizados para o Kôma Print Agent Multiplataforma.
"""

import os
import shutil
import tempfile
import pytest
from unittest.mock import MagicMock, patch

import sys
current_dir = os.path.dirname(os.path.abspath(__file__))
agent_dir = os.path.abspath(os.path.join(current_dir, ".."))
if agent_dir not in sys.path:
    sys.path.insert(0, agent_dir)

from config import AgentConfig
from api_client import KomaApiClient
from journal import PrintJournal
from adapters.file import FilePrinterAdapter
from adapters.windows import (
    _is_virtual_printer,
    _matches_present_usb_device,
)
from adapters import get_adapter
from worker import (
    execute_agent_command,
    run_agent_loop,
    process_unconfirmed_journal_jobs,
)


@pytest.fixture
def temp_dir():
    dir_path = tempfile.mkdtemp()
    yield dir_path
    shutil.rmtree(dir_path, ignore_errors=True)


def test_file_printer_adapter_generates_readable_ticket(temp_dir):
    """Testa se o adaptador 'file' gera cupons texto legíveis com itens, observações e corte simulado."""
    adapter = FilePrinterAdapter(output_dir=temp_dir)
    payload = "MESA 5 - PEDIDO #102\n1x 001 - Hambúrguer Tradicional\n  Obs: Sem cebola\n1x 007 - Sucos de Laranja"
    
    success = adapter.print_ticket(payload, printer_name="Cozinha Thermal", doc_type="PRODUCAO")
    assert success is True

    files = os.listdir(temp_dir)
    assert len(files) == 1
    assert files[0].startswith("ticket_producao_")

    filepath = os.path.join(temp_dir, files[0])
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    assert "KÔMA BISTRÔ - SIMULADOR DE IMPRESSÃO LOCAL" in content
    assert "Impressora Alvo: Cozinha Thermal" in content
    assert "1x 001 - Hambúrguer Tradicional" in content
    assert "Obs: Sem cebola" in content
    assert "[ === CORTE DE PAPEL SIMULADO === ]" in content


def test_print_journal_idempotency(temp_dir):
    """Testa idempotência e registro de trabalhos no diário SQLite local."""
    db_path = os.path.join(temp_dir, "test_journal.db")
    journal = PrintJournal(db_path=db_path)

    assert journal.is_printed("job-123") is False

    # Registra impressão concluída no papel (mas ainda não confirmada na API)
    journal.record_print_success("job-123", idempotency_key="ikey-123", printer_name="EPSON TM-T20", confirmed=False)

    assert journal.is_printed("job-123") is True
    assert journal.is_printed("other-job", idempotency_key="ikey-123") is True
    assert journal.is_confirmed("job-123") is False

    # Valida busca de jobs pendentes de confirmação HTTP
    unconfirmed = journal.get_unconfirmed_printed_jobs()
    assert len(unconfirmed) == 1
    assert unconfirmed[0]["job_id"] == "job-123"

    # Marca como confirmado no backend
    journal.mark_backend_confirmed("job-123")
    assert journal.is_confirmed("job-123") is True
    assert len(journal.get_unconfirmed_printed_jobs()) == 0


def test_offline_resilience_reconfirms_without_reprinting(temp_dir):
    """
    Cenário Crítico: Impressão física ocorreu, mas a conexão caiu antes da confirmação HTTP.
    Valida se na reconexão o agente re-envia a confirmação para a API SEM reimprimir no papel.
    """
    db_path = os.path.join(temp_dir, "resilience.db")
    journal = PrintJournal(db_path=db_path)
    
    mock_client = MagicMock(spec=KomaApiClient)
    mock_client.complete_job.return_value = True

    # Registra job impresso localmente mas não confirmado
    journal.record_print_success("job-offline-01", "ikey-offline-01", "Cozinha", confirmed=False)

    # Executa conciliação de resiliência
    process_unconfirmed_journal_jobs(mock_client, journal)

    # Verifica que o client tentou confirmar o job e o journal atualizou para confirmado
    mock_client.complete_job.assert_called_once_with("job-offline-01", printer_name="Cozinha")
    assert journal.is_confirmed("job-offline-01") is True


def test_linux_adapter_does_not_fake_print_success(temp_dir):
    """Falha real de CUPS não pode ser registrada como impressão concluída."""
    file_adapter = get_adapter("file", output_dir=temp_dir)
    assert isinstance(file_adapter, FilePrinterAdapter)

    linux_adapter = get_adapter("linux", output_dir=temp_dir)
    failed_process = MagicMock(returncode=1, stdout=b"", stderr=b"fila ausente")
    with patch("adapters.linux.subprocess.run", return_value=failed_process):
        result = linux_adapter.print_ticket(
            "Teste Linux",
            "Impressora_Inexistente",
            "PRODUCAO",
        )

    assert result is False
    assert not [
        name for name in os.listdir(temp_dir)
        if name.startswith("ticket_")
    ]


def test_linux_adapter_reports_cups_usb_printer(temp_dir):
    linux_adapter = get_adapter("linux", output_dir=temp_dir)
    default_probe = MagicMock(
        returncode=0,
        stdout=b"destino padrao do sistema: G250\n",
        stderr=b"",
    )
    devices_probe = MagicMock(
        returncode=0,
        stdout=b"dispositivo para G250: usb://GERTEC/G250\n",
        stderr=b"",
    )
    live_devices_probe = MagicMock(
        returncode=0,
        stdout=b"direct usb://GERTEC/G250\n",
        stderr=b"",
    )

    with (
        patch(
            "adapters.linux._run_cups_command",
            side_effect=[
                default_probe,
                live_devices_probe,
                devices_probe,
            ],
        ),
        patch("adapters.linux.glob.glob", return_value=[]),
    ):
        diagnostics = linux_adapter.get_diagnostics()

    assert diagnostics["default_printer"] == "G250"
    assert diagnostics["printers"] == [
        {
            "name": "G250",
            "connection": "usb",
            "uri": "usb://GERTEC/G250",
            "is_default": True,
            "available": True,
            "present": True,
            "configured": True,
        }
    ]


def test_linux_adapter_reconnects_ready_usb_and_sets_default(temp_dir):
    linux_adapter = get_adapter("linux", output_dir=temp_dir)
    default_probe = MagicMock(
        returncode=0,
        stdout=b"destino padrao do sistema: G250\n",
        stderr=b"",
    )
    live_devices_probe = MagicMock(
        returncode=0,
        stdout=b"direct usb://GERTEC/G250\n",
        stderr=b"",
    )
    devices_probe = MagicMock(
        returncode=0,
        stdout=b"dispositivo para G250: usb://GERTEC/G250\n",
        stderr=b"",
    )
    set_default = MagicMock(returncode=0, stdout=b"", stderr=b"")

    with (
        patch(
            "adapters.linux._run_cups_command",
            side_effect=[
                default_probe,
                live_devices_probe,
                devices_probe,
                set_default,
                default_probe,
                live_devices_probe,
                devices_probe,
            ],
        ) as command,
        patch("adapters.linux.glob.glob", return_value=[]),
    ):
        result = linux_adapter.connect_usb(
            requested_name="G250",
            requested_uri="usb://GERTEC/G250",
        )

    assert result["success"] is True
    assert result["code"] == "usb_connected"
    assert result["printer_name"] == "G250"
    assert ["lpoptions", "-d", "G250"] in [
        call.args[0]
        for call in command.call_args_list
    ]


def test_linux_adapter_finishes_with_error_when_usb_is_absent(temp_dir):
    linux_adapter = get_adapter("linux", output_dir=temp_dir)
    unavailable = MagicMock(returncode=1, stdout=b"", stderr=b"")

    with (
        patch(
            "adapters.linux._run_cups_command",
            return_value=unavailable,
        ),
        patch("adapters.linux.glob.glob", return_value=[]),
    ):
        result = linux_adapter.connect_usb()

    assert result["success"] is False
    assert result["code"] == "usb_not_found"
    assert "Nenhuma impressora física" in result["message"]


def test_linux_adapter_does_not_treat_stale_cups_queue_as_connected(
    temp_dir,
):
    linux_adapter = get_adapter("linux", output_dir=temp_dir)
    default_probe = MagicMock(
        returncode=0,
        stdout=b"destino padrao do sistema: G250\n",
        stderr=b"",
    )
    live_devices_probe = MagicMock(
        returncode=0,
        stdout=b"network socket\n",
        stderr=b"",
    )
    devices_probe = MagicMock(
        returncode=0,
        stdout=b"dispositivo para G250: usb://GERTEC/G250\n",
        stderr=b"",
    )

    with (
        patch(
            "adapters.linux._run_cups_command",
            side_effect=[
                default_probe,
                live_devices_probe,
                devices_probe,
            ],
        ),
        patch("adapters.linux.glob.glob", return_value=[]),
    ):
        diagnostics = linux_adapter.get_diagnostics()

    assert diagnostics["printers"] == [
        {
            "name": "G250",
            "connection": "usb",
            "uri": "usb://GERTEC/G250",
            "is_default": True,
            "available": False,
            "present": False,
            "configured": True,
        }
    ]


def test_linux_adapter_does_not_match_an_unrelated_usb_printer(
    temp_dir,
):
    linux_adapter = get_adapter("linux", output_dir=temp_dir)
    default_probe = MagicMock(
        returncode=0,
        stdout=b"destino padrao do sistema: G250\n",
        stderr=b"",
    )
    live_devices_probe = MagicMock(
        returncode=0,
        stdout=b"network socket\n",
        stderr=b"",
    )
    devices_probe = MagicMock(
        returncode=0,
        stdout=b"dispositivo para G250: usb://GERTEC/G250\n",
        stderr=b"",
    )
    unrelated_usb = {
        "name": "EPSON TM-T20",
        "connection": "usb",
        "uri": "sysfs://usb/1-2",
        "is_default": False,
        "available": False,
        "present": True,
        "configured": False,
        "hardware_id": "1:2",
        "serial": "EPSON-123",
    }

    with (
        patch(
            "adapters.linux._run_cups_command",
            side_effect=[
                default_probe,
                live_devices_probe,
                devices_probe,
            ],
        ),
        patch(
            "adapters.linux._discover_sysfs_usb_printers",
            return_value=[unrelated_usb],
        ),
        patch("adapters.linux.glob.glob", return_value=[]),
    ):
        diagnostics = linux_adapter.get_diagnostics()

    assert diagnostics["printers"] == [
        {
            "name": "G250",
            "connection": "usb",
            "uri": "usb://GERTEC/G250",
            "is_default": True,
            "available": False,
            "present": False,
            "configured": True,
        },
        {
            "name": "EPSON TM-T20",
            "connection": "usb",
            "uri": "sysfs://usb/1-2",
            "is_default": False,
            "available": False,
            "present": True,
            "configured": False,
        },
    ]


def test_linux_adapter_deduplicates_sysfs_and_direct_usb_port(temp_dir):
    linux_adapter = get_adapter("linux", output_dir=temp_dir)
    unavailable = MagicMock(returncode=1, stdout=b"", stderr=b"")
    physical_device = {
        "name": "EPSON TM-T20",
        "connection": "usb",
        "uri": "sysfs://usb/1-2",
        "is_default": False,
        "available": False,
        "present": True,
        "configured": False,
        "hardware_id": "1:2",
        "serial": "EPSON-123",
    }

    with (
        patch(
            "adapters.linux._run_cups_command",
            side_effect=[unavailable, unavailable, unavailable],
        ),
        patch(
            "adapters.linux._discover_sysfs_usb_printers",
            return_value=[physical_device],
        ),
        patch(
            "adapters.linux.glob.glob",
            return_value=["/dev/usb/lp0"],
        ),
        patch("adapters.linux.os.access", return_value=True),
    ):
        diagnostics = linux_adapter.get_diagnostics()

    assert diagnostics["printers"] == [
        {
            "name": "EPSON TM-T20",
            "connection": "usb",
            "uri": "/dev/usb/lp0",
            "is_default": False,
            "available": True,
            "present": True,
            "configured": True,
        }
    ]


def test_windows_usb_queue_does_not_match_unrelated_single_device():
    devices = [
        {
            "name": "EPSON TM-T20",
            "instance_id": r"USBPRINT\EPSON_TM-T20\123",
            "status": "OK",
        }
    ]

    assert _matches_present_usb_device("G250", devices) is False
    assert _matches_present_usb_device("EPSON TM-T20 Receipt", devices) is True


def test_windows_virtual_printers_are_filtered():
    assert _is_virtual_printer(
        "Microsoft Print to PDF",
        "PORTPROMPT:",
    ) is True
    assert _is_virtual_printer("OneNote", "nul:") is True
    assert _is_virtual_printer("G250", "USB001") is False


def test_api_client_reuses_http_session():
    """Polling e heartbeat devem compartilhar a mesma conexão HTTP."""
    job = {"id": "job-session"}

    with patch("api_client.requests.Session") as SessionClass:
        session = SessionClass.return_value
        claim_response = MagicMock(status_code=200)
        claim_response.json.return_value = job
        heartbeat_response = MagicMock(status_code=200)
        heartbeat_response.json.return_value = {
            "status": "ok",
            "command": None,
        }
        session.post.side_effect = [
            claim_response,
            heartbeat_response,
        ]

        client = KomaApiClient("https://api.koma.test", "agent-token")

        assert client.claim_next_job() == job
        diagnostics = {
            "adapter": "linux",
            "platform": "linux",
            "printers": [],
        }
        assert client.heartbeat(diagnostics=diagnostics) == {
            "status": "ok",
            "command": None,
        }
        SessionClass.assert_called_once_with()
        assert session.post.call_count == 2
        assert session.post.call_args.kwargs["json"] == {
            "diagnostics": {
                **diagnostics,
                "capabilities": ["connect_usb"],
            }
        }


def test_agent_executes_connect_usb_command():
    adapter = MagicMock()
    adapter.connect_usb.return_value = {
        "success": True,
        "code": "usb_connected",
        "message": "Impressora USB conectada e pronta para uso.",
        "printer_name": "G250",
        "diagnostics": {
            "adapter": "linux",
            "platform": "linux",
            "printers": [],
        },
    }

    result = execute_agent_command(
        adapter,
        {
            "id": "usb-command-1",
            "action": "connect_usb",
            "printer_name": "G250",
            "printer_uri": "usb://GERTEC/G250",
        },
    )

    assert result["success"] is True
    adapter.connect_usb.assert_called_once_with(
        requested_name="G250",
        requested_uri="usb://GERTEC/G250",
    )


def test_api_client_completes_usb_command():
    with patch("api_client.requests.Session") as SessionClass:
        session = SessionClass.return_value
        session.post.return_value.status_code = 200
        client = KomaApiClient("https://api.koma.test", "agent-token")
        result = {
            "success": True,
            "code": "usb_connected",
            "message": "Pronta.",
            "printer_name": "G250",
            "diagnostics": {
                "adapter": "linux",
                "platform": "linux",
                "printers": [],
            },
        }

        assert client.complete_command("usb-command-1", result) is True
        assert session.post.call_args.args[0].endswith(
            "/api/print-agents/actions/usb-command-1/complete"
        )
        assert session.post.call_args.kwargs["json"]["code"] == (
            "usb_connected"
        )
        assert session.post.call_args.kwargs["json"][
            "diagnostics"
        ]["capabilities"] == ["connect_usb"]


def test_api_client_falls_back_during_backend_rollout():
    """Agente novo continua funcional enquanto o backend antigo é atualizado."""
    job = {"id": "job-legacy"}

    with patch("api_client.requests.Session") as SessionClass:
        session = SessionClass.return_value
        claim_next_response = MagicMock(status_code=404)
        claim_response = MagicMock(status_code=200)
        claim_response.json.return_value = job
        session.post.side_effect = [claim_next_response, claim_response]
        session.get.return_value.status_code = 200
        session.get.return_value.json.return_value = job

        client = KomaApiClient("https://api.koma.test", "agent-token")

        assert client.claim_next_job() == job
        session.get.assert_called_once()
        assert session.post.call_count == 2


def test_api_client_claims_and_completes_a_batch():
    jobs = [
        {"id": "job-batch-1"},
        {"id": "job-batch-2"},
    ]

    with patch("api_client.requests.Session") as SessionClass:
        session = SessionClass.return_value
        claim_response = MagicMock(status_code=200)
        claim_response.json.return_value = jobs
        complete_response = MagicMock(status_code=200)
        complete_response.json.return_value = {
            "confirmed_job_ids": ["job-batch-1", "job-batch-2"],
            "rejected_job_ids": [],
        }
        session.post.side_effect = [claim_response, complete_response]

        client = KomaApiClient("https://api.koma.test", "agent-token")

        assert client.claim_jobs(limit=10) == jobs
        assert client.complete_jobs(
            [
                {"job_id": "job-batch-1", "printer_name": "Cozinha"},
                {"job_id": "job-batch-2", "printer_name": "Cozinha"},
            ]
        ) == {"job-batch-1", "job-batch-2"}
        assert session.post.call_count == 2


def test_worker_end_to_end_flow(temp_dir):
    """Testa fluxo completo de execução do worker (heartbeat, claim, print, complete)."""
    db_path = os.path.join(temp_dir, "journal.db")
    
    config = AgentConfig(
        api_url="http://localhost:8000",
        agent_token="koma_ag_test_token",
        agent_id="test-agent-01",
        adapter="file",
        output_dir=temp_dir,
        poll_interval_seconds=0.01,
        heartbeat_interval_seconds=0.01
    )

    mock_job = {
        "id": "job-test-999",
        "document_type": "producao",
        "destination": "COZINHA",
        "source_type": "comanda",
        "source_id": "c-10",
        "payload_text": "MESA 10\n1x Cheese Burguer",
        "idempotency_key": "ikey-999"
    }

    with patch("worker.KomaApiClient") as MockClientClass, patch("worker.PrintJournal") as MockJournalClass:
        client_instance = MockClientClass.return_value
        journal_instance = PrintJournal(db_path=db_path)
        MockJournalClass.return_value = journal_instance

        client_instance.heartbeat.return_value = True
        client_instance.claim_jobs.side_effect = [[mock_job], []]
        client_instance.complete_jobs.return_value = {"job-test-999"}

        run_agent_loop(config, max_loops=2)

        client_instance.heartbeat.assert_called()
        client_instance.claim_jobs.assert_called_with(10)
        client_instance.complete_jobs.assert_called_once_with(
            [
                {
                    "job_id": "job-test-999",
                    "printer_name": "Padrão",
                }
            ]
        )

        # Verifica se o arquivo físico foi gravado no diretório
        files = os.listdir(temp_dir)
        printed_files = [f for f in files if f.startswith("ticket_")]
        assert len(printed_files) == 1


def test_worker_drains_backlog_without_polling_delay(temp_dir):
    """Dois jobs acumulados são processados em sequência, sem sleep entre eles."""
    config = AgentConfig(
        api_url="http://localhost:8000",
        agent_token="koma_ag_test_token",
        adapter="file",
        output_dir=temp_dir,
        poll_interval_seconds=0.5,
    )
    first_job = {
        "id": "job-backlog-1",
        "document_type": "producao",
        "destination": "COZINHA",
        "source_type": "comanda",
        "source_id": "c-1",
        "payload_text": "1x Pedido 1",
        "idempotency_key": "ikey-backlog-1",
    }
    second_job = {
        **first_job,
        "id": "job-backlog-2",
        "source_id": "c-2",
        "payload_text": "1x Pedido 2",
        "idempotency_key": "ikey-backlog-2",
    }

    with (
        patch("worker.KomaApiClient") as ClientClass,
        patch("worker.PrintJournal") as JournalClass,
        patch("worker.get_adapter") as get_adapter_mock,
        patch("worker.time.sleep") as sleep_mock,
    ):
        client = ClientClass.return_value
        journal = JournalClass.return_value
        adapter = get_adapter_mock.return_value
        adapter.requires_physical_printer = False

        client.heartbeat.return_value = True
        client.claim_jobs.return_value = [first_job, second_job]
        client.complete_jobs.return_value = {
            "job-backlog-1",
            "job-backlog-2",
        }
        journal.get_unconfirmed_printed_jobs.return_value = []
        journal.is_printed.return_value = False
        adapter.print_ticket.return_value = True

        run_agent_loop(config, max_loops=1)

        assert adapter.print_ticket.call_count == 2
        assert [
            call.args[0]
            for call in adapter.print_ticket.call_args_list
        ] == ["1x Pedido 1", "1x Pedido 2"]
        client.complete_jobs.assert_called_once_with(
            [
                {
                    "job_id": "job-backlog-1",
                    "printer_name": "Padrão",
                },
                {
                    "job_id": "job-backlog-2",
                    "printer_name": "Padrão",
                },
            ]
        )
        assert journal.record_print_success.call_count == 2
        assert journal.mark_backend_confirmed.call_count == 2
        sleep_mock.assert_not_called()


def test_worker_reclaims_locally_printed_job_without_reprinting(temp_dir):
    """Após recuperação do servidor, o journal impede uma segunda via física."""
    config = AgentConfig(
        api_url="http://localhost:8000",
        agent_token="koma_ag_test_token",
        adapter="file",
        output_dir=temp_dir,
    )
    job = {
        "id": "job-recovered",
        "document_type": "producao",
        "destination": "COZINHA",
        "source_type": "comanda",
        "source_id": "c-recovered",
        "payload_text": "1x Pedido já impresso",
        "idempotency_key": "ikey-recovered",
    }

    with (
        patch("worker.KomaApiClient") as ClientClass,
        patch("worker.PrintJournal") as JournalClass,
        patch("worker.get_adapter") as get_adapter_mock,
    ):
        client = ClientClass.return_value
        journal = JournalClass.return_value
        get_adapter_mock.return_value.requires_physical_printer = False

        client.heartbeat.return_value = True
        client.claim_jobs.return_value = [job]
        client.complete_jobs.return_value = {"job-recovered"}
        journal.get_unconfirmed_printed_jobs.return_value = []
        journal.is_printed.return_value = True

        run_agent_loop(config, max_loops=1)

        client.complete_jobs.assert_called_once_with(
            [
                {
                    "job_id": "job-recovered",
                    "printer_name": "Padrão",
                }
            ]
        )
        journal.mark_backend_confirmed.assert_called_once_with("job-recovered")
        get_adapter_mock.return_value.print_ticket.assert_not_called()


def test_worker_returns_unprinted_tail_when_printer_fails_mid_batch(
    temp_dir,
):
    """Falha física não perde nem confirma os trabalhos seguintes do lote."""
    config = AgentConfig(
        api_url="http://localhost:8000",
        agent_token="koma_ag_test_token",
        adapter="file",
        output_dir=temp_dir,
    )
    jobs = [
        {
            "id": f"job-failure-{index}",
            "document_type": "producao",
            "destination": "COZINHA",
            "source_type": "comanda",
            "source_id": f"c-{index}",
            "payload_text": f"Pedido {index}",
            "idempotency_key": f"ikey-failure-{index}",
        }
        for index in range(1, 4)
    ]

    with (
        patch("worker.KomaApiClient") as ClientClass,
        patch("worker.PrintJournal") as JournalClass,
        patch("worker.get_adapter") as get_adapter_mock,
    ):
        client = ClientClass.return_value
        journal = JournalClass.return_value
        adapter = get_adapter_mock.return_value
        adapter.requires_physical_printer = False

        client.heartbeat.return_value = True
        client.claim_jobs.return_value = jobs
        client.complete_jobs.return_value = {"job-failure-1"}
        client.release_jobs.return_value = {"job-failure-3"}
        journal.get_unconfirmed_printed_jobs.return_value = []
        journal.is_printed.return_value = False
        adapter.print_ticket.side_effect = [True, False]

        run_agent_loop(config, max_loops=1)

        assert adapter.print_ticket.call_count == 2
        client.fail_job.assert_called_once()
        client.release_jobs.assert_called_once_with(["job-failure-3"])
        client.complete_jobs.assert_called_once_with(
            [
                {
                    "job_id": "job-failure-1",
                    "printer_name": "Padrão",
                }
            ]
        )
        journal.mark_backend_confirmed.assert_called_once_with(
            "job-failure-1"
        )


def test_worker_does_not_claim_jobs_without_physical_printer(temp_dir):
    config = AgentConfig(
        api_url="http://localhost:8000",
        agent_token="koma_ag_test_token",
        adapter="linux",
        output_dir=temp_dir,
        poll_interval_seconds=0.01,
        heartbeat_interval_seconds=0.01,
    )
    diagnostics = {
        "adapter": "linux",
        "platform": "linux",
        "printers": [
            {
                "name": "G250",
                "connection": "usb",
                "uri": "usb://GERTEC/G250",
                "is_default": True,
                "available": False,
                "present": False,
                "configured": True,
            }
        ],
        "default_printer": "G250",
        "error": None,
    }

    with (
        patch("worker.KomaApiClient") as ClientClass,
        patch("worker.PrintJournal") as JournalClass,
        patch("worker.get_adapter") as get_adapter_mock,
        patch("worker.time.sleep") as sleep_mock,
    ):
        client = ClientClass.return_value
        journal = JournalClass.return_value
        adapter = get_adapter_mock.return_value
        adapter.requires_physical_printer = True
        adapter.get_diagnostics.return_value = diagnostics
        journal.get_unconfirmed_printed_jobs.return_value = []

        run_agent_loop(config, max_loops=1)

        client.heartbeat.assert_called_once_with(diagnostics=diagnostics)
        client.claim_jobs.assert_not_called()
        adapter.print_ticket.assert_not_called()
        sleep_mock.assert_not_called()


def test_worker_processes_real_mocked_print_job_success(temp_dir):
    """1. Claim retorna job + print_ticket True: print_ticket chamado, journal atualizado, complete_jobs chamado."""
    config = AgentConfig(
        api_url="http://localhost:8000",
        agent_token="test-token-1",
        adapter="file",
        output_dir=temp_dir,
        poll_interval_seconds=0.01,
    )
    job = {
        "id": "job-success-100",
        "idempotency_key": "ikey-success-100",
        "document_type": "producao",
        "destination": "COZINHA",
        "payload_text": "1x HAMBÚRGUER TRADICIONAL",
        "queue_latency_ms": 15,
    }

    db_path = os.path.join(temp_dir, "test_proc.db")
    journal = PrintJournal(db_path=db_path)

    with patch("worker.KomaApiClient") as ClientClass, \
         patch("worker.PrintJournal", return_value=journal), \
         patch("worker.get_adapter") as get_adapter_mock, \
         patch("worker.WssWakeupClient") as WssClass:
        
        client = ClientClass.return_value
        client.heartbeat.return_value = {"command": None}
        client.claim_jobs.return_value = [job]
        client.complete_jobs.return_value = {"job-success-100"}

        adapter = get_adapter_mock.return_value
        adapter.requires_physical_printer = False
        adapter.get_diagnostics.return_value = {"printers": []}
        adapter.print_ticket.return_value = True

        run_agent_loop(config, max_loops=1)

        adapter.print_ticket.assert_called_once_with(
            "1x HAMBÚRGUER TRADICIONAL",
            "Padrão",
            "PRODUCAO"
        )
        assert journal.is_printed("job-success-100", "ikey-success-100") is True
        client.complete_jobs.assert_called_once()
        assert client.complete_jobs.call_args[0][0] == [{"job_id": "job-success-100", "printer_name": "Padrão"}]


def test_worker_processes_real_mocked_print_job_failure(temp_dir):
    """2. print_ticket False: fail_job chamado no cliente."""
    config = AgentConfig(
        api_url="http://localhost:8000",
        agent_token="test-token-2",
        adapter="file",
        output_dir=temp_dir,
        poll_interval_seconds=0.01,
    )
    job = {
        "id": "job-fail-200",
        "idempotency_key": "ikey-fail-200",
        "document_type": "producao",
        "destination": "COZINHA",
        "payload_text": "1x PIZZA CALABRESA",
    }

    db_path = os.path.join(temp_dir, "test_fail.db")
    journal = PrintJournal(db_path=db_path)

    with patch("worker.KomaApiClient") as ClientClass, \
         patch("worker.PrintJournal", return_value=journal), \
         patch("worker.get_adapter") as get_adapter_mock, \
         patch("worker.WssWakeupClient"):

        client = ClientClass.return_value
        client.heartbeat.return_value = {"command": None}
        client.claim_jobs.return_value = [job]
        client.release_jobs.return_value = []

        adapter = get_adapter_mock.return_value
        adapter.requires_physical_printer = False
        adapter.get_diagnostics.return_value = {"printers": []}
        adapter.print_ticket.return_value = False

        run_agent_loop(config, max_loops=1)

        adapter.print_ticket.assert_called_once()
        client.fail_job.assert_called_once()
        assert client.fail_job.call_args[0][0] == "job-fail-200"


def test_worker_mid_batch_failure_releases_unprocessed_jobs(temp_dir):
    """3. Falha no meio do lote: jobs não processados retornam via release_jobs."""
    config = AgentConfig(
        api_url="http://localhost:8000",
        agent_token="test-token-3",
        adapter="file",
        output_dir=temp_dir,
        poll_interval_seconds=0.01,
        claim_batch_size=3,
    )
    job1 = {"id": "j1", "idempotency_key": "k1", "payload_text": "Item 1"}
    job2 = {"id": "j2", "idempotency_key": "k2", "payload_text": "Item 2"}
    job3 = {"id": "j3", "idempotency_key": "k3", "payload_text": "Item 3"}

    db_path = os.path.join(temp_dir, "test_batch_fail.db")
    journal = PrintJournal(db_path=db_path)

    with patch("worker.KomaApiClient") as ClientClass, \
         patch("worker.PrintJournal", return_value=journal), \
         patch("worker.get_adapter") as get_adapter_mock, \
         patch("worker.WssWakeupClient"):

        client = ClientClass.return_value
        client.heartbeat.return_value = {"command": None}
        client.claim_jobs.return_value = [job1, job2, job3]
        client.complete_jobs.return_value = {"j1"}
        client.release_jobs.return_value = ["j3"]

        adapter = get_adapter_mock.return_value
        adapter.requires_physical_printer = False
        adapter.get_diagnostics.return_value = {"printers": []}
        adapter.print_ticket.side_effect = [True, False]

        run_agent_loop(config, max_loops=1)

        assert adapter.print_ticket.call_count == 2
        client.fail_job.assert_called_once_with("j2", error_msg="Falha no adaptador de impressão 'MagicMock'")
        client.release_jobs.assert_called_once_with(["j3"])


def test_worker_preventive_idempotency_skip_reprint(temp_dir):
    """4. Job já no journal: print_ticket NÃO é chamado novamente."""
    config = AgentConfig(
        api_url="http://localhost:8000",
        agent_token="test-token-4",
        adapter="file",
        output_dir=temp_dir,
        poll_interval_seconds=0.01,
    )
    job = {"id": "j-dup-10", "idempotency_key": "k-dup-10", "payload_text": "Item Re-enviado"}

    db_path = os.path.join(temp_dir, "test_idemp.db")
    journal = PrintJournal(db_path=db_path)
    journal.record_print_success("j-dup-10", "k-dup-10", "Padrão", confirmed=True)

    with patch("worker.KomaApiClient") as ClientClass, \
         patch("worker.PrintJournal", return_value=journal), \
         patch("worker.get_adapter") as get_adapter_mock, \
         patch("worker.WssWakeupClient"):

        client = ClientClass.return_value
        client.heartbeat.return_value = {"command": None}
        client.claim_jobs.return_value = [job]
        client.complete_jobs.return_value = {"j-dup-10"}

        adapter = get_adapter_mock.return_value
        adapter.requires_physical_printer = False

        run_agent_loop(config, max_loops=1)

        adapter.print_ticket.assert_not_called()
        client.complete_jobs.assert_called_once_with([{"job_id": "j-dup-10", "printer_name": "Padrão"}])

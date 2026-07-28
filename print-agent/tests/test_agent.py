"""
Suíte de Testes Automatizados para o Kôma Print Agent Multiplataforma.
"""

import os
import shutil
import tempfile
import time
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
from adapters import get_adapter
from worker import run_agent_loop, process_unconfirmed_journal_jobs


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


def test_api_client_reuses_http_session():
    """Polling e heartbeat devem compartilhar a mesma conexão HTTP."""
    job = {"id": "job-session"}

    with patch("api_client.requests.Session") as SessionClass:
        session = SessionClass.return_value
        session.post.return_value.status_code = 200
        session.post.return_value.json.return_value = job

        client = KomaApiClient("https://api.koma.test", "agent-token")

        assert client.claim_next_job() == job
        assert client.heartbeat() is True
        SessionClass.assert_called_once_with()
        assert session.post.call_count == 2


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
        client_instance.claim_next_job.side_effect = [mock_job, None]
        client_instance.complete_job.return_value = True

        run_agent_loop(config, max_loops=2)

        client_instance.heartbeat.assert_called()
        client_instance.claim_next_job.assert_called()
        client_instance.complete_job.assert_called_with("job-test-999", printer_name="Padrão")

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

        client.heartbeat.return_value = True
        client.claim_next_job.side_effect = [first_job, second_job]
        client.complete_job.return_value = True
        journal.get_unconfirmed_printed_jobs.return_value = []
        journal.is_printed.return_value = False
        adapter.print_ticket.return_value = True

        run_agent_loop(config, max_loops=2)

        assert adapter.print_ticket.call_count == 2
        assert client.complete_job.call_count == 2
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

        client.heartbeat.return_value = True
        client.claim_next_job.return_value = job
        client.complete_job.return_value = True
        journal.get_unconfirmed_printed_jobs.return_value = []
        journal.is_printed.return_value = True

        run_agent_loop(config, max_loops=1)

        client.complete_job.assert_called_once_with(
            "job-recovered",
            printer_name="Padrão",
        )
        journal.mark_backend_confirmed.assert_called_once_with("job-recovered")
        get_adapter_mock.return_value.print_ticket.assert_not_called()

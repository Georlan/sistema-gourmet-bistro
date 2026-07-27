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


def test_adapter_factory_fallback(temp_dir):
    """Testa seleção de adaptadores via get_adapter."""
    file_adapter = get_adapter("file", output_dir=temp_dir)
    assert isinstance(file_adapter, FilePrinterAdapter)

    linux_adapter = get_adapter("linux", output_dir=temp_dir)
    # Se CUPS/device não existir, linux adapter faz fallback gracioso para FilePrinterAdapter
    res = linux_adapter.print_ticket("Teste Linux", "Impressora_Inexistente", "PRODUCAO")
    assert res is True  # Fallback para arquivo bem-sucedido


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
        client_instance.get_next_job.side_effect = [mock_job, None]
        client_instance.claim_job.return_value = mock_job
        client_instance.complete_job.return_value = True

        run_agent_loop(config, max_loops=2)

        client_instance.heartbeat.assert_called()
        client_instance.claim_job.assert_called_with("job-test-999")
        client_instance.complete_job.assert_called_with("job-test-999", printer_name="Padrão")

        # Verifica se o arquivo físico foi gravado no diretório
        files = os.listdir(temp_dir)
        printed_files = [f for f in files if f.startswith("ticket_")]
        assert len(printed_files) == 1

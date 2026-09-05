import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from agent_runtime import AgentAlreadyRunning, single_instance
from config import AgentConfig
from journal import PrintJournal


def test_duplicate_process_rejected_and_lock_reusable_after_exit(tmp_path):
    lock = tmp_path / "agent.lock"
    with single_instance(lock):
        with pytest.raises(AgentAlreadyRunning):
            with single_instance(lock):
                pytest.fail("A second connector must not start")
    with single_instance(lock):
        assert lock.exists()


def test_existing_manual_journal_keeps_its_location(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    journal = PrintJournal(str(tmp_path / "journal.db"))
    journal.record_print_success("legacy", "legacy", "G250")
    config = AgentConfig.load()
    resolved = Path(config.config_path).resolve().with_name("journal.db")
    assert PrintJournal(str(resolved)).is_printed("legacy")


def test_confirmations_persist_even_when_cleanup_is_throttled(tmp_path):
    journal = PrintJournal(str(tmp_path / "journal.db"))
    for job in ("one", "two"):
        journal.record_print_success(job, job, "G250")
        journal.mark_backend_confirmed(job)
    reopened = PrintJournal(str(tmp_path / "journal.db"))
    assert reopened.is_confirmed("one") and reopened.is_confirmed("two")

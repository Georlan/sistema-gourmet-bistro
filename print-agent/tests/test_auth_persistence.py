"""Regressões de identidade/credencial local e confirmações recusadas.

Todos os tokens são fictícios; nenhum teste toca rede ou impressora real.
"""

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main as agent_main
import pairing
import worker
from api_client import AckResult, AgentAuthenticationError, KomaApiClient
from config import AgentConfig
from journal import PrintJournal

STALE = "koma_ag_fake_stale_config_token"
PAIRED = "koma_ag_fake_new_paired_token"


@pytest.fixture
def isolated(tmp_path, monkeypatch):
    credentials = tmp_path / "credentials.json"
    config_file = tmp_path / "config.json"
    monkeypatch.setattr(pairing, "credentials_path", lambda: credentials)
    for name in ("KOMA_AGENT_TOKEN", "KOMA_TOKEN", "KOMA_AGENT_ID", "KOMA_CONFIG_FILE"):
        monkeypatch.delenv(name, raising=False)
    return credentials, config_file


def _write(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_paired_credential_wins_over_stale_config_token(isolated):
    """H2/H8: antes, config.json sombreava o token novo e o agent_id vinha de outro par."""
    credentials, config_file = isolated
    _write(config_file, {"agent_token": STALE, "agent_id": "agent-local"})
    _write(credentials, {"agent_token": PAIRED, "agent_id": "desktop-new"})

    config = AgentConfig.load(str(config_file))

    assert config.agent_token == PAIRED
    assert config.agent_id == "desktop-new"
    assert config.agent_token_source == "credentials"


def test_legacy_config_token_still_used_without_pairing(isolated):
    """Compatibilidade: instalações antigas só com config.json continuam funcionando."""
    _, config_file = isolated
    _write(config_file, {"agent_token": STALE, "agent_id": "agent-local"})

    config = AgentConfig.load(str(config_file))

    assert config.agent_token == STALE
    assert config.agent_token_source == "config"


def test_explicit_env_token_overrides_paired_credential(isolated, monkeypatch):
    credentials, config_file = isolated
    _write(credentials, {"agent_token": PAIRED, "agent_id": "desktop-new"})
    monkeypatch.setenv("KOMA_AGENT_TOKEN", "koma_ag_fake_env_token")

    config = AgentConfig.load(str(config_file))

    assert config.agent_token == "koma_ag_fake_env_token"
    assert config.agent_token_source == "env"


def test_rejected_config_token_is_not_resurrected_after_restart(isolated):
    credentials, config_file = isolated
    _write(config_file, {"agent_token": STALE, "api_url": "https://example.invalid"})

    pairing.clear_stored_token(STALE, str(config_file))

    data = json.loads(config_file.read_text(encoding="utf-8"))
    assert "agent_token" not in data
    assert data["api_url"] == "https://example.invalid"
    assert AgentConfig.load(str(config_file)).agent_token == ""


def test_rejection_preserves_a_different_newer_pairing(isolated):
    """Uma recusa do token antigo não pode apagar um pareamento novo e válido."""
    credentials, config_file = isolated
    _write(credentials, {"agent_token": PAIRED, "agent_id": "desktop-new"})

    pairing.clear_stored_token(STALE, str(config_file))

    assert pairing.load_stored_token() == PAIRED


def test_rejection_removes_the_rejected_paired_credential(isolated):
    credentials, _ = isolated
    _write(credentials, {"agent_token": PAIRED, "agent_id": "desktop-new"})

    pairing.clear_stored_token(PAIRED)

    assert not credentials.exists()


def test_run_scrubs_rejected_token_source_and_stops_without_polling(isolated, monkeypatch):
    credentials, config_file = isolated
    _write(config_file, {"agent_token": STALE})
    config = AgentConfig.load(str(config_file))
    calls = []

    class RejectingClient:
        def __init__(self, *_args):
            self.session = MagicMock()

        def heartbeat(self):
            calls.append("heartbeat")
            raise AgentAuthenticationError("revoked")

    monkeypatch.setattr(agent_main, "KomaApiClient", RejectingClient)
    monkeypatch.setattr(agent_main, "run_agent_loop", lambda _c: pytest.fail("must not poll"))

    assert agent_main.run(config) == agent_main.PAIRING_REQUIRED_EXIT
    assert calls == ["heartbeat"]
    assert AgentConfig.load(str(config_file)).agent_token == ""


def test_complete_jobs_exposes_definitive_rejections():
    client = KomaApiClient("https://example.invalid", "koma_ag_fake")
    response = MagicMock(status_code=200)
    response.json.return_value = {
        "confirmed_job_ids": ["job-ok"],
        "rejected_job_ids": ["job-gone", "job-not-requested"],
    }
    client.session.post = MagicMock(return_value=response)

    result = client.complete_jobs([{"job_id": "job-ok"}, {"job_id": "job-gone"}])

    assert result == {"job-ok"}
    assert result.rejected == {"job-gone"}


def test_rejected_ack_is_settled_once_and_never_reprinted(tmp_path):
    """Antes: job impresso sob o pareamento anterior gerava complete-batch eterno."""
    journal = PrintJournal(db_path=str(tmp_path / "journal.db"))
    journal.record_print_success("job-old-pairing", "idem-old", "KA-1445", confirmed=False)
    journal.record_print_success("job-a", "idem-a", "KA-1445", confirmed=False)
    client = MagicMock()
    client.complete_jobs.return_value = AckResult(["job-a"], rejected=["job-old-pairing"])

    worker.process_unconfirmed_journal_jobs(client, journal)
    assert journal.get_unconfirmed_printed_jobs() == []

    client.complete_jobs.reset_mock()
    worker.process_unconfirmed_journal_jobs(client, journal)
    client.complete_jobs.assert_not_called()
    # Proteção anti-duplicação preservada: o registro impresso continua.
    assert journal.is_printed("job-old-pairing", "idem-old")


def test_transient_ack_failure_keeps_job_for_retry(tmp_path):
    journal = PrintJournal(db_path=str(tmp_path / "journal.db"))
    journal.record_print_success("job-a", "idem-a", "P", confirmed=False)
    journal.record_print_success("job-b", "idem-b", "P", confirmed=False)
    client = MagicMock()
    client.complete_jobs.return_value = set()  # rede/5xx: nada recusado

    worker.process_unconfirmed_journal_jobs(client, journal)

    assert {item["job_id"] for item in journal.get_unconfirmed_printed_jobs()} == {"job-a", "job-b"}

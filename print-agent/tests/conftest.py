"""Global test configuration and fixtures for print-agent test suite."""

import sys
from pathlib import Path
import pytest

# Ensure print-agent directory is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pairing


@pytest.fixture(autouse=True)
def isolate_agent_environment(tmp_path, monkeypatch):
    """Ensure tests run in complete isolation from local machine credentials and env."""
    isolated_creds = tmp_path / "credentials.json"
    monkeypatch.setattr(pairing, "credentials_path", lambda: isolated_creds)
    monkeypatch.delenv("KOMA_AGENT_TOKEN", raising=False)
    monkeypatch.delenv("KOMA_TOKEN", raising=False)
    monkeypatch.delenv("KOMA_AGENT_ID", raising=False)

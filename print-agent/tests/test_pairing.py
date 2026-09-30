import json
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main as agent_main
import pairing
from config import AgentConfig


def test_pair_agent_accepts_browser_callback_and_rejects_bad_requests(tmp_path, monkeypatch):
    credentials = tmp_path / "credentials.json"
    monkeypatch.setattr(pairing, "credentials_path", lambda: credentials)

    token = "koma_ag_test_pairing_token"

    def open_pairing_url(url: str) -> bool:
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        nonce = params["pair_print_agent"][0]
        port = int(params["agent_port"][0])
        endpoint = f"http://127.0.0.1:{port}/pair"

        preflight = Request(
            endpoint,
            method="OPTIONS",
            headers={
                "Origin": pairing.ALLOWED_ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
                "Access-Control-Request-Private-Network": "true",
            },
        )
        with urlopen(preflight, timeout=2) as response:
            assert response.status == 204
            assert response.headers["Access-Control-Allow-Origin"] == pairing.ALLOWED_ORIGIN
            assert response.headers["Access-Control-Allow-Private-Network"] == "true"

        untrusted = Request(
            endpoint,
            method="POST",
            headers={"Origin": "https://example.invalid", "Content-Type": "application/json"},
            data=json.dumps({"nonce": nonce, "token": token}).encode(),
        )
        with pytest.raises(HTTPError) as error:
            urlopen(untrusted, timeout=2)
        assert error.value.code == 403

        wrong_nonce = Request(
            endpoint,
            method="POST",
            headers={"Origin": pairing.ALLOWED_ORIGIN, "Content-Type": "application/json"},
            data=json.dumps({"nonce": "wrong", "token": token}).encode(),
        )
        with pytest.raises(HTTPError) as error:
            urlopen(wrong_nonce, timeout=2)
        assert error.value.code == 403

        callback = Request(
            endpoint,
            method="POST",
            headers={"Origin": pairing.ALLOWED_ORIGIN, "Content-Type": "application/json"},
            data=json.dumps({"nonce": nonce, "token": token}).encode(),
        )
        with urlopen(callback, timeout=2) as response:
            assert response.status == 204
        return True

    monkeypatch.setattr(pairing.webbrowser, "open", open_pairing_url)

    assert pairing.pair_agent(timeout_seconds=2) == token
    assert pairing.load_stored_token() == token
    assert credentials.stat().st_mode & 0o777 == 0o600


def test_service_timeout_uses_non_restarting_exit_code(monkeypatch):
    monkeypatch.setattr(pairing, "pair_agent", lambda: None)

    service_config = AgentConfig(agent_token="", pair_only=False)
    installer_config = AgentConfig(agent_token="", pair_only=True)

    assert agent_main.run(service_config) == agent_main.PAIRING_NOT_COMPLETED_EXIT == 75
    assert agent_main.run(installer_config) == 1

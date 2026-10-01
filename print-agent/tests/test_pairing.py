import json
import os
import sys
from pathlib import Path
from http.client import HTTPConnection
from urllib.parse import parse_qs, urlparse


import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main as agent_main
import pairing
from config import AgentConfig


def test_pair_agent_accepts_browser_callback_and_rejects_bad_requests(tmp_path, monkeypatch):
    credentials = tmp_path / "credentials.json"
    monkeypatch.setattr(pairing, "credentials_path", lambda: credentials)

    token = "koma_ag_test_pairing_token"
    agent_id = "desktop-test-agent"

    def open_pairing_url(url: str) -> bool:
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        nonce = params["pair_print_agent"][0]
        port = int(params["agent_port"][0])
        def request(method: str, *, origin: str, payload: dict | None = None, headers: dict | None = None):
            connection = HTTPConnection("127.0.0.1", port, timeout=2)
            request_headers = {"Origin": origin, **(headers or {})}
            body = None
            if payload is not None:
                body = json.dumps(payload)
                request_headers["Content-Type"] = "application/json"
            connection.request(method, "/pair", body=body, headers=request_headers)
            response = connection.getresponse()
            response.read()
            response_headers = dict(response.headers.items())
            status = response.status
            connection.close()
            return status, response_headers

        status, headers = request(
            "OPTIONS",
            origin=pairing.ALLOWED_ORIGIN,
            headers={
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
                "Access-Control-Request-Private-Network": "true",
            },
        )
        assert status == 204
        assert headers["Access-Control-Allow-Origin"] == pairing.ALLOWED_ORIGIN
        assert headers["Access-Control-Allow-Private-Network"] == "true"
        assert "Authorization" in headers["Access-Control-Allow-Headers"]
        assert "X-Requested-With" in headers["Access-Control-Allow-Headers"]

        status, _ = request(
            "POST",
            origin="https://example.invalid",
            payload={"nonce": nonce, "token": token, "agent_id": agent_id},
        )
        assert status == 403

        status, _ = request(
            "POST",
            origin=pairing.ALLOWED_ORIGIN,
            payload={"nonce": "wrong", "token": token, "agent_id": agent_id},
        )
        assert status == 403

        status, _ = request(
            "POST",
            origin=pairing.ALLOWED_ORIGIN,
            payload={"nonce": nonce, "token": token, "agent_id": agent_id},
        )
        assert status == 204
        return True

    monkeypatch.setattr(pairing.webbrowser, "open", open_pairing_url)

    assert pairing.pair_agent(timeout_seconds=2) == token
    assert pairing.load_stored_token() == token
    assert pairing.load_stored_agent_id() == agent_id
    if os.name != "nt":
        assert credentials.stat().st_mode & 0o777 == 0o600


def test_service_without_credentials_waits_for_explicit_pairing(monkeypatch):
    pairing_calls = 0

    def fake_pair_agent():
        nonlocal pairing_calls
        pairing_calls += 1
        return None

    monkeypatch.setattr(pairing, "pair_agent", fake_pair_agent)

    service_config = AgentConfig(agent_token="", pair_only=False)
    installer_config = AgentConfig(agent_token="", pair_only=True)

    assert agent_main.run(service_config) == agent_main.PAIRING_REQUIRED_EXIT == 2
    assert pairing_calls == 0

    assert agent_main.run(installer_config) == 1
    assert pairing_calls == 1


@pytest.mark.skipif(os.name == "nt", reason="flock é proteção específica do launcher Linux")
def test_pairing_lock_is_single_flight(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_RUNTIME_DIR", str(tmp_path))
    monkeypatch.delenv(pairing.PAIRING_LOCK_HELD_ENV, raising=False)

    with pairing.pairing_lock() as first:
        assert first is True
        with pairing.pairing_lock() as second:
            assert second is False

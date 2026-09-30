import json
import os
import sys
from pathlib import Path
from http.client import HTTPConnection
from urllib.parse import parse_qs, urlparse


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

        status, _ = request(
            "POST",
            origin="https://example.invalid",
            payload={"nonce": nonce, "token": token},
        )
        assert status == 403

        status, _ = request(
            "POST",
            origin=pairing.ALLOWED_ORIGIN,
            payload={"nonce": "wrong", "token": token},
        )
        assert status == 403

        status, _ = request(
            "POST",
            origin=pairing.ALLOWED_ORIGIN,
            payload={"nonce": nonce, "token": token},
        )
        assert status == 204
        return True

    monkeypatch.setattr(pairing.webbrowser, "open", open_pairing_url)

    assert pairing.pair_agent(timeout_seconds=2) == token
    assert pairing.load_stored_token() == token
    if os.name != "nt":
        assert credentials.stat().st_mode & 0o777 == 0o600


def test_service_timeout_uses_non_restarting_exit_code(monkeypatch):
    monkeypatch.setattr(pairing, "pair_agent", lambda: None)

    service_config = AgentConfig(agent_token="", pair_only=False)
    installer_config = AgentConfig(agent_token="", pair_only=True)

    assert agent_main.run(service_config) == agent_main.PAIRING_NOT_COMPLETED_EXIT == 75
    assert agent_main.run(installer_config) == 1

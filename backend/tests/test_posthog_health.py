import asyncio
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.integrations.posthog_client import PostHogClient


@pytest.mark.parametrize("token", ["", "project-token"])
def test_links_without_private_api_do_not_probe_or_claim_ingestion(monkeypatch, token):
    monkeypatch.delenv("POSTHOG_API_KEY", raising=False)
    monkeypatch.delenv("POSTHOG_PROJECT_TOKEN", raising=False)
    client = PostHogClient(project_token=token)
    with patch("httpx.AsyncClient") as network:
        health = asyncio.run(client.check_health())
    network.assert_not_called()
    assert health["status"] == "unverified"
    assert health["checked_at"] is None
    assert health["latency_ms"] is None
    assert health["configured"] is bool(token)
    assert "/project/648305/" in client.get_dashboard_url()


def test_private_project_api_failure_does_not_leak_credentials():
    client = PostHogClient(api_key="private-test-key")
    with patch("httpx.AsyncClient.get", new=AsyncMock(side_effect=httpx.ConnectError("private-test-key"))):
        health = asyncio.run(client.check_health())
    assert health["status"] == "disconnected"
    assert "private-test-key" not in str(health)


def test_private_project_access_is_separate_from_ingestion():
    response = httpx.Response(200, json={"name": "Production"})
    with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=response)):
        health = asyncio.run(PostHogClient(api_key="private-test-key").check_health())
    assert health["status"] == "connected"
    assert "Ingestão de eventos não verificada" in health["detail"]

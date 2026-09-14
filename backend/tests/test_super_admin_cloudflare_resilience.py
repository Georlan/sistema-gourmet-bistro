import httpx
import pytest

from app.routes.super_admin_services import CloudflareService


@pytest.mark.anyio
async def test_cloudflare_dns_list_normalizes_transport_errors(monkeypatch):
    async def fail_get(self, *args, **kwargs):
        request = httpx.Request("GET", "https://api.cloudflare.com/client/v4/zones/test/dns_records")
        raise httpx.TimeoutException("synthetic timeout", request=request)

    monkeypatch.setattr(httpx.AsyncClient, "get", fail_get)

    service = CloudflareService(api_token="test-token", zone_id="test-zone")

    with pytest.raises(RuntimeError, match="Cloudflare indisponível \\(TimeoutException\\)"):
        await service.list_dns_records()
